// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCE_PATTERN = /^[0-9a-f]{40}$/u;
const ROOT_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RUN_ID_PATTERN = /^[1-9][0-9]*$/u;
const ADMISSION_SCHEMA = 'kungfu.product-upgrade.publication-admission/v1';
const CAPSULE_SCHEMA = 'kungfu.product-upgrade.publication-candidate-capsule/v1';
const QUALIFICATION_SCHEMA = 'kungfu.cli-installed-product-qualification/v1';
const OUTPUT_SCHEMA = 'kungfu.hub-starter.package-input-qualification/v2';
const PROPOSAL_SCHEMA = 'kungfu.hub-starter.runtime-input-proposal/v1';
const ADMISSION_FILE = 'product-upgrade-publication-admission.json';
const CAPSULE_FILE = 'product-upgrade-publication-capsule.json';
const PLATFORMS = [
  {
    architecture: 'x64',
    archive: 'kungfu-episodes-cli-linux-x64.tar.gz',
    key: 'linux/amd64',
    platform: 'linux-x64',
    rootOption: 'amd64Root',
  },
  {
    architecture: 'arm64',
    archive: 'kungfu-episodes-cli-linux-arm64.tar.gz',
    key: 'linux/arm64',
    platform: 'linux-arm64',
    rootOption: 'arm64Root',
  },
];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

export function contentRoot(value) {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')}`;
}

async function fileRoot(filePath) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return `sha256:${digest.digest('hex')}`;
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read ${label}: ${error.message}`);
  }
}

function exactRoot(value, label) {
  if (!ROOT_PATTERN.test(value || '')) throw new Error(`${label} is not an exact SHA-256 root`);
  return value;
}

async function filesNamed(root, name) {
  const matches = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const filePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`candidate input contains a symbolic link: ${filePath}`);
      }
      if (entry.isDirectory()) await visit(filePath);
      else if (entry.isFile() && entry.name === name) matches.push(filePath);
    }
  }
  await visit(path.resolve(root));
  return matches;
}

async function exactlyOne(root, name, label) {
  const matches = await filesNamed(root, name);
  if (matches.length !== 1) {
    throw new Error(`${label} must occur exactly once; found ${matches.length}`);
  }
  return matches[0];
}

function expectedNonClaims(platform) {
  const system = platform.split('-')[0];
  return [
    ...[
      { id: 'darwin', label: 'macOS' },
      { id: 'linux', label: 'Linux' },
      { id: 'windows', label: 'Windows' },
    ]
      .filter(({ id }) => id !== system)
      .map(({ label }) => `${label} is not qualified by this receipt.`),
    'Availability metadata does not activate a KFX contribution.',
  ];
}

async function verifyQualification({ archivePath, qualificationPath, expected, sourceSha, version }) {
  const archiveRoot = await fileRoot(archivePath);
  const report = await readJson(qualificationPath, `${expected.platform} qualification`);
  const { qualificationRoot, ...subject } = report;
  if (report.schema !== QUALIFICATION_SCHEMA || report.qualified !== true || report.label !== 'cli-archive') {
    throw new Error(`${expected.platform} qualification contract is unsupported`);
  }
  if (
    report.platform !== expected.platform
    || report.architecture !== expected.architecture
    || report.version !== version
    || report.identity?.sourceCommit !== sourceSha
    || report.identity?.archive !== expected.archive
    || report.identity?.archiveSha256 !== archiveRoot
  ) {
    throw new Error(`${expected.platform} qualification identity does not match the Build candidate`);
  }
  if (
    report.productIdentity?.verifiedFromInstalledCommand !== true
    || report.claims?.installedProduct !== true
    || report.claims?.qualifiedPlatform !== expected.platform
    || JSON.stringify(report.nonClaims) !== JSON.stringify(expectedNonClaims(expected.platform))
    || !(report.checks?.kfd3?.linkedApiCount > 0)
    || report.checks?.mutationPlanReceipt?.planReplayStable !== true
    || report.checks?.mutationPlanReceipt?.receiptVerified !== true
    || report.isolation?.sourceCheckoutRequired !== false
    || report.isolation?.guiPrivateStateRequired !== false
  ) {
    throw new Error(`${expected.platform} qualification omitted required installed-product proof`);
  }
  if (exactRoot(qualificationRoot, `${expected.platform} qualification root`) !== contentRoot(subject)) {
    throw new Error(`${expected.platform} qualification semantic root drift`);
  }
  return {
    archivePath,
    archiveRoot,
    qualificationPath,
    qualificationRoot,
  };
}

async function verifyAdmission({ admissionRoot, packages, sourceSha, version }) {
  const receiptPath = await exactlyOne(admissionRoot, ADMISSION_FILE, 'product admission receipt');
  const capsulePath = await exactlyOne(admissionRoot, CAPSULE_FILE, 'product admission capsule');
  const receipt = await readJson(receiptPath, 'product admission receipt');
  const capsule = await readJson(capsulePath, 'product admission capsule');
  const { receiptRoot, ...receiptBody } = receipt;
  const { capsuleRoot, ...capsuleBody } = capsule;
  if (receipt.schema !== ADMISSION_SCHEMA || receipt.status !== 'admitted') {
    throw new Error('product admission receipt contract is unsupported');
  }
  if (receipt.identity?.version !== version || !receipt.identity?.sources?.includes(sourceSha)) {
    throw new Error('product admission identity does not match the Build candidate');
  }
  if (exactRoot(receiptRoot, 'product admission receipt root') !== contentRoot(receiptBody)) {
    throw new Error('product admission receipt root drift');
  }
  if (capsule.schema !== CAPSULE_SCHEMA) {
    throw new Error('product admission capsule contract is unsupported');
  }
  if (exactRoot(capsuleRoot, 'product admission capsule root') !== contentRoot(capsuleBody)) {
    throw new Error('product admission capsule root drift');
  }
  if (
    capsule.candidateRoot !== receipt.roots?.candidate
    || capsule.artifactRoot !== receipt.roots?.artifact
    || capsule.passportRoot !== receipt.roots?.passport
    || capsule.admission?.path !== ADMISSION_FILE
    || capsule.admission?.receiptRoot !== receiptRoot
    || capsule.admission?.fileRoot !== await fileRoot(receiptPath)
  ) {
    throw new Error('product admission capsule does not seal its receipt');
  }
  const admittedCli = receipt.admission?.cliArtifacts;
  if (!Array.isArray(admittedCli)) throw new Error('product admission omitted CLI artifacts');
  for (const [key, value] of Object.entries(packages)) {
    const matches = admittedCli.filter((item) => item.platformId === value.platform);
    if (matches.length !== 1) {
      throw new Error(`product admission requires exactly one ${value.platform} CLI artifact`);
    }
    const admitted = matches[0];
    if (
      admitted.version !== version
      || admitted.sourceCommit !== sourceSha
      || admitted.archive?.name !== value.name
      || admitted.archive?.digest !== `sha256:${value.sha256}`
      || admitted.qualification?.root !== value.qualificationRoot
    ) {
      throw new Error(`product admission does not bind the qualified ${key} package`);
    }
  }
  return { capsule, capsulePath, receipt, receiptPath };
}

export async function prepareKungfuBuildCandidate({
  admissionRoot,
  amd64Root,
  arm64Root,
  outputDir,
  packageVersion,
  runId,
  sourceSha,
}) {
  if (!RUN_ID_PATTERN.test(runId || '')) throw new Error('Build run id is invalid');
  if (!SOURCE_PATTERN.test(sourceSha || '')) throw new Error('Kungfu source SHA is invalid');
  if (!packageVersion) throw new Error('package version is required');
  const resolvedOutput = path.resolve(outputDir);
  await mkdir(resolvedOutput, { recursive: true });

  const packages = {};
  const verified = [];
  for (const expected of PLATFORMS) {
    const root = { amd64Root, arm64Root }[expected.rootOption];
    const qualificationName = expected.archive.replace('.tar.gz', '.qualification.json');
    const archivePath = await exactlyOne(root, expected.archive, `${expected.platform} archive`);
    const qualificationPath = await exactlyOne(
      root,
      qualificationName,
      `${expected.platform} qualification`,
    );
    const result = await verifyQualification({
      archivePath,
      expected,
      qualificationPath,
      sourceSha,
      version: packageVersion,
    });
    packages[expected.key] = {
      name: expected.archive,
      platform: expected.platform,
      qualificationRoot: result.qualificationRoot,
      sha256: result.archiveRoot.slice('sha256:'.length),
    };
    verified.push({ expected, ...result });
  }

  const admission = await verifyAdmission({
    admissionRoot,
    packages,
    sourceSha,
    version: packageVersion,
  });
  for (const item of verified) {
    await copyFile(item.archivePath, path.join(resolvedOutput, item.expected.archive));
    await copyFile(
      item.qualificationPath,
      path.join(resolvedOutput, path.basename(item.qualificationPath)),
    );
  }
  await copyFile(admission.receiptPath, path.join(resolvedOutput, ADMISSION_FILE));
  await copyFile(admission.capsulePath, path.join(resolvedOutput, CAPSULE_FILE));

  const runUrl = `https://github.com/kungfu-systems/kungfu/actions/runs/${runId}`;
  const qualification = {
    schema: OUTPUT_SCHEMA,
    authority: 'qualification-only',
    repository: 'kungfu-systems/kungfu',
    buildRun: { id: runId, url: runUrl, workflow: 'Build', sourceSha },
    packageVersion,
    packages,
    admission: {
      receiptRoot: admission.receipt.receiptRoot,
      capsuleRoot: admission.capsule.capsuleRoot,
      candidateRoot: admission.capsule.candidateRoot,
    },
  };
  const proposal = {
    schema: PROPOSAL_SCHEMA,
    status: 'qualified-input',
    contractSourceBuild: {
      kungfuSourceSha: sourceSha,
      kungfuBuildRun: runUrl,
      packages: Object.fromEntries(
        Object.entries(packages).map(([key, value]) => [key, { name: value.name, sha256: value.sha256 }]),
      ),
    },
    runtimeLock: {
      kungfuSourceSha: sourceSha,
      kungfuBuildRun: runUrl,
      kungfuPackages: Object.fromEntries(
        Object.entries(packages).map(([key, value]) => [key, { name: value.name, sha256: value.sha256 }]),
      ),
      kungfuPackageVersion: packageVersion,
    },
    admission: qualification.admission,
    remainingRequiredFields: [
      'runtimeLock.packageRelease',
      'runtimeLock.image',
      'runtimeLock.imageSourceRevision',
      'runtimeLock.qualificationRun',
    ],
  };
  await writeFile(
    path.join(resolvedOutput, 'qualification.json'),
    `${JSON.stringify(qualification, null, 2)}\n`,
  );
  await writeFile(
    path.join(resolvedOutput, 'runtime-input-proposal.json'),
    `${JSON.stringify(proposal, null, 2)}\n`,
  );
  await writeFile(
    path.join(resolvedOutput, 'SHA256SUMS'),
    `${PLATFORMS.map(({ archive, key }) => `${packages[key].sha256}  ${archive}`).join('\n')}\n`,
  );
  return { proposal, qualification };
}

function options(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || value === undefined) throw new Error(`invalid option: ${name || '<empty>'}`);
    parsed[name.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = value;
  }
  return parsed;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  prepareKungfuBuildCandidate(options(process.argv.slice(2))).catch((error) => {
    process.stderr.write(`[prepare-kungfu-build-candidate] ${error.message}\n`);
    process.exitCode = 1;
  });
}
