// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { imageRepository, sha256 } from './oci-compose-candidate.mjs';
import { verifyPublicationSource } from './publication-source.mjs';

const directory = '.artifacts/public-release';
const read = (name) => JSON.parse(fs.readFileSync(path.join(directory, name)));
const write = (name, value) => fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
const check = (value, message) => { if (!value) throw new Error(message); };
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' });
const repository = 'kungfu-systems/runtime-images';

if (process.argv[2] === 'prepare') {
  const tag = process.env.GITHUB_REF_NAME;
  check(process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' && /^v1\.0\.0-alpha\.[1-9][0-9]*$/u.test(tag), 'qualification requires an exact protected alpha tag');
  check(process.env.GITHUB_REPOSITORY === repository, 'wrong qualification repository');
  const release = JSON.parse(gh('api', `repos/${repository}/releases/tags/${tag}`));
  check(release.prerelease && !release.draft, 'public alpha release required');
  const sourceSha = JSON.parse(gh('api', `repos/${repository}/commits/${tag}`)).sha;
  check(sourceSha === process.env.GITHUB_SHA, 'qualification source is not the exact published tag');
  check(!fs.existsSync(directory), 'qualification output already exists');
  fs.mkdirSync(directory, { recursive: true });
  for (const name of ['oci-family.json', 'oci-publication-readback.json', 'buildchain-publication-settlement.json', 'buildchain.release.json']) {
    check(release.assets.filter((asset) => asset.name === name).length === 1, `missing unique public evidence: ${name}`);
    gh('release', 'download', tag, '--repo', repository, '--pattern', name, '--dir', directory);
  }
  const family = read('oci-family.json');
  const settlement = read('buildchain-publication-settlement.json').documents;
  const readback = read('oci-publication-readback.json');
  check(family.repository === repository && family.version === tag.slice(1), 'family identity mismatch');
  verifyPublicationSource({ documents: settlement, family, readback, sourceSha });
  const image = family.images.find((entry) => entry.name === 'hub-starter');
  const application = family.images.find((entry) => entry.name === 'hub-starter-compose');
  for (const entry of [image, application]) {
    check(entry?.repository === imageRepository && /^sha256:[0-9a-f]{64}$/u.test(entry.digest), 'unsafe publication coordinate');
    check(readback.familyRoot === family.root && readback.images.some((observed) => observed.digest === entry.digest && observed.repository === imageRepository && observed.anonymous === true), 'missing public OCI readback');
  }
  check(application.preview.qualificationWorkflow === '.github/workflows/qualify-release.yml', 'undeclared qualification workflow');
  check(/^sha256:[0-9a-f]{64}$/u.test(application.preview.previousDigest), 'previous preview required');
  write('context.json', { repository, tag, sourceSha, candidateSourceSha: family.sourceSha, familyRoot: family.root,
    imageDigest: image.digest, applicationDigest: application.digest, previousDigest: application.preview.previousDigest,
    kungfuSourceSha: JSON.parse(fs.readFileSync('release/runtime.lock.json')).kungfuSourceSha });
} else if (process.argv[2] === 'finish') {
  const context = read('context.json');
  const amd64 = read('hub-image-smoke-linux-amd64.json');
  const arm64 = read('hub-image-smoke-linux-arm64.json');
  const fresh = read('hub-application-fresh-install.json');
  const upgrade = read('hub-application-upgrade.json');
  for (const evidence of [amd64, arm64]) {
    check(evidence.freshInstall && evidence.restartPersistence && evidence.accountIsolation, 'platform persistence/account checks failed');
    check(evidence.security?.nonRoot && evidence.security.readOnlyRoot && evidence.security.privileged === false && evidence.security.capabilityAdditions === false, 'runtime hardening checks failed');
  }
  check(arm64.kungfuAgentVerified && arm64.nodeArchitecture === 'arm64', 'arm64 execution identity missing');
  check(fresh.freshInstall && fresh.accountIsolation && upgrade.upgradePersistence && upgrade.rollbackPersistence, 'public Compose persistence checks failed');
  const evidenceNames = ['hub-image-smoke-linux-amd64.json', 'hub-image-smoke-linux-arm64.json',
    'hub-image-smoke-linux-arm64-agent.json', 'hub-application-readiness.json', 'hub-application-fresh-install.json', 'hub-application-upgrade.json'];
  const artifactDirectory = path.join(directory, 'qualification');
  fs.mkdirSync(artifactDirectory);
  const evidence = evidenceNames.map((name) => {
    const bytes = fs.readFileSync(path.join(directory, name));
    fs.writeFileSync(path.join(artifactDirectory, name), bytes);
    return { path: name, sha256: sha256(bytes) };
  });
  const receipt = { schema: 'kungfu-buildchain-compose-qualification/v1', repository, tag: context.tag,
    sourceSha: context.sourceSha, familyRoot: context.familyRoot, runId: process.env.GITHUB_RUN_ID,
    runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT), image: `${imageRepository}@${context.imageDigest}`,
    application: `${imageRepository}@${context.applicationDigest}`, previousDigest: context.previousDigest, passed: true,
    checks: { freshInstall: true, restartPersistence: true, upgradePersistence: true, rollbackPersistence: true, accountIsolation: true, hardenedRuntime: true },
    platforms: { 'linux/amd64': { passed: true, policy: 'native-full-lifecycle' }, 'linux/arm64': { passed: true, policy: 'qemu-platform-contract' } }, evidence };
  fs.writeFileSync(path.join(artifactDirectory, 'qualification.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`Qualified exact public Compose ${receipt.application}`);
} else {
  throw new Error('usage: release-qualification.mjs prepare|finish');
}
