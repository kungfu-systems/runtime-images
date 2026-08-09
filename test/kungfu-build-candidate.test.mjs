// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  contentRoot,
  prepareKungfuBuildCandidate,
} from '../scripts/prepare-kungfu-build-candidate.mjs';

const sourceSha = 'a'.repeat(40);
const version = '4.0.0-alpha.1';
const runId = '31320000000';

const fileRoot = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hub-build-candidate-'));
  const roots = {
    admissionRoot: path.join(root, 'admission'),
    amd64Root: path.join(root, 'amd64'),
    arm64Root: path.join(root, 'arm64'),
    outputDir: path.join(root, 'stage'),
  };
  await Promise.all([
    roots.admissionRoot,
    roots.amd64Root,
    roots.arm64Root,
  ].map((directory) => mkdir(directory, { recursive: true })));
  const cliArtifacts = [];
  for (const item of [
    { architecture: 'x64', archive: 'kungfu-episodes-cli-linux-x64.tar.gz', root: roots.amd64Root },
    { architecture: 'arm64', archive: 'kungfu-episodes-cli-linux-arm64.tar.gz', root: roots.arm64Root },
  ]) {
    const archiveBytes = Buffer.from(`archive-${item.architecture}`);
    const archiveSha256 = fileRoot(archiveBytes);
    const qualificationName = item.archive.replace('.tar.gz', '.qualification.json');
    const qualification = {
      schema: 'kungfu.cli-installed-product-qualification/v1',
      qualified: true,
      label: 'cli-archive',
      identity: { archive: item.archive, archiveSha256, sourceCommit: sourceSha },
      platform: `linux-${item.architecture}`,
      architecture: item.architecture,
      version,
      claims: { installedProduct: true, qualifiedPlatform: `linux-${item.architecture}` },
      productIdentity: { verifiedFromInstalledCommand: true },
      checks: {
        kfd3: { linkedApiCount: 1 },
        mutationPlanReceipt: { planReplayStable: true, receiptVerified: true },
      },
      isolation: { sourceCheckoutRequired: false, guiPrivateStateRequired: false },
      nonClaims: [
        'macOS is not qualified by this receipt.',
        'Windows is not qualified by this receipt.',
        'Availability metadata does not activate a KFX contribution.',
      ],
    };
    qualification.qualificationRoot = contentRoot(qualification);
    await writeFile(path.join(item.root, item.archive), archiveBytes);
    await writeFile(
      path.join(item.root, qualificationName),
      `${JSON.stringify(qualification, null, 2)}\n`,
    );
    cliArtifacts.push({
      platform: 'linux',
      architecture: item.architecture,
      platformId: `linux-${item.architecture}`,
      archive: { name: item.archive, digest: archiveSha256 },
      qualification: { root: qualification.qualificationRoot },
      version,
      sourceCommit: sourceSha,
    });
  }
  const receipt = {
    schema: 'kungfu.product-upgrade.publication-admission/v1',
    status: 'admitted',
    identity: { version, sources: [sourceSha] },
    roots: { candidate: fileRoot('candidate'), artifact: fileRoot('artifact'), passport: fileRoot('passport') },
    admission: { cliArtifacts },
  };
  receipt.receiptRoot = contentRoot(receipt);
  const receiptBytes = `${JSON.stringify(receipt, null, 2)}\n`;
  await writeFile(path.join(roots.admissionRoot, 'product-upgrade-publication-admission.json'), receiptBytes);
  const capsule = {
    schema: 'kungfu.product-upgrade.publication-candidate-capsule/v1',
    candidateRoot: receipt.roots.candidate,
    artifactRoot: receipt.roots.artifact,
    passportRoot: receipt.roots.passport,
    admission: {
      path: 'product-upgrade-publication-admission.json',
      receiptRoot: receipt.receiptRoot,
      fileRoot: fileRoot(receiptBytes),
    },
  };
  capsule.capsuleRoot = contentRoot(capsule);
  await writeFile(
    path.join(roots.admissionRoot, 'product-upgrade-publication-capsule.json'),
    `${JSON.stringify(capsule, null, 2)}\n`,
  );
  return { root, roots };
}

test('one Build candidate produces exact multi-platform lock and contract inputs', async () => {
  const { roots } = await fixture();
  const result = await prepareKungfuBuildCandidate({ ...roots, packageVersion: version, runId, sourceSha });
  assert.equal(result.qualification.buildRun.id, runId);
  assert.deepEqual(Object.keys(result.qualification.packages), ['linux/amd64', 'linux/arm64']);
  assert.equal(result.proposal.status, 'qualified-input');
  assert.equal(result.proposal.contractSourceBuild.kungfuBuildRun, result.qualification.buildRun.url);
  assert.equal(result.proposal.runtimeLock.kungfuBuildRun, result.qualification.buildRun.url);
  assert.deepEqual(result.proposal.remainingRequiredFields, [
    'runtimeLock.packageRelease',
    'runtimeLock.image',
    'runtimeLock.imageSourceRevision',
    'runtimeLock.qualificationRun',
  ]);
  const sums = await readFile(path.join(roots.outputDir, 'SHA256SUMS'), 'utf8');
  assert.match(sums, /kungfu-episodes-cli-linux-x64\.tar\.gz/u);
  assert.match(sums, /kungfu-episodes-cli-linux-arm64\.tar\.gz/u);
});

test('candidate preparation fails closed on a tampered ARM64 archive', async () => {
  const { roots } = await fixture();
  await writeFile(
    path.join(roots.arm64Root, 'kungfu-episodes-cli-linux-arm64.tar.gz'),
    'tampered',
  );
  await assert.rejects(
    prepareKungfuBuildCandidate({ ...roots, packageVersion: version, runId, sourceSha }),
    /qualification identity does not match/u,
  );
});

test('candidate preparation rejects a split or stale source identity', async () => {
  const { roots } = await fixture();
  await assert.rejects(
    prepareKungfuBuildCandidate({
      ...roots,
      packageVersion: version,
      runId,
      sourceSha: 'b'.repeat(40),
    }),
    /qualification identity does not match|admission identity does not match/u,
  );
});

test('candidate preparation rejects an admission receipt with root drift', async () => {
  const { roots } = await fixture();
  const receiptPath = path.join(
    roots.admissionRoot,
    'product-upgrade-publication-admission.json',
  );
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  receipt.roots.candidate = fileRoot('different-candidate');
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  await assert.rejects(
    prepareKungfuBuildCandidate({ ...roots, packageVersion: version, runId, sourceSha }),
    /receipt root drift/u,
  );
});

test('candidate preparation rejects a capsule bound to another candidate', async () => {
  const { roots } = await fixture();
  const capsulePath = path.join(
    roots.admissionRoot,
    'product-upgrade-publication-capsule.json',
  );
  const capsule = JSON.parse(await readFile(capsulePath, 'utf8'));
  capsule.candidateRoot = fileRoot('another-candidate');
  delete capsule.capsuleRoot;
  capsule.capsuleRoot = contentRoot(capsule);
  await writeFile(capsulePath, `${JSON.stringify(capsule, null, 2)}\n`);
  await assert.rejects(
    prepareKungfuBuildCandidate({ ...roots, packageVersion: version, runId, sourceSha }),
    /capsule does not seal its receipt/u,
  );
});

test('candidate preparation rejects duplicate package identities', async () => {
  const { roots } = await fixture();
  const duplicateRoot = path.join(roots.amd64Root, 'duplicate');
  await mkdir(duplicateRoot, { recursive: true });
  const archive = 'kungfu-episodes-cli-linux-x64.tar.gz';
  await writeFile(
    path.join(duplicateRoot, archive),
    await readFile(path.join(roots.amd64Root, archive)),
  );
  await assert.rejects(
    prepareKungfuBuildCandidate({ ...roots, packageVersion: version, runId, sourceSha }),
    /must occur exactly once; found 2/u,
  );
});

test('candidate preparation requires both Linux architectures', async () => {
  const { roots } = await fixture();
  await assert.rejects(
    prepareKungfuBuildCandidate({
      ...roots,
      arm64Root: path.join(roots.arm64Root, 'missing'),
      packageVersion: version,
      runId,
      sourceSha,
    }),
    /ENOENT/u,
  );
});
