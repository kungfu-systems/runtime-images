// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises';
import { validateComposeText, validateImageReference } from '../src/policy.mjs';

const compose = await readFile(new URL('../compose.yaml', import.meta.url), 'utf8');
validateComposeText(compose);

for (const relative of ['../package.json']) {
  JSON.parse(await readFile(new URL(relative, import.meta.url), 'utf8'));
}

const contractText = await readFile(
  new URL('../contracts/hub-starter-runtime.contract.json', import.meta.url),
  'utf8',
);
const contract = JSON.parse(contractText);
const lockText = await readFile(new URL('../release/runtime.lock.json', import.meta.url), 'utf8');
const lock = JSON.parse(lockText);

const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
for (const required of [
  'FROM ${BUILD_IMAGE} AS package',
  'FROM ${RUNTIME_IMAGE} AS runtime',
  'sha256sum -c -',
  'USER node',
  'tech.kungfu.product.source',
  'tech.kungfu.product.package.sha256',
  'tech.kungfu.build-image.digest',
  'KUNGFU_INSTALL_SOURCE=archive',
  'KUNGFU_DIR=/opt/kungfu',
  'KUNGFU_UPGRADE_MANIFEST=/opt/kungfu/upgrade/kungfu-release-manifest.json',
  'ln -s /opt/kungfu/kungfu /usr/local/bin/kungfu',
]) {
  if (!dockerfile.includes(required)) throw new Error(`Dockerfile invariant missing: ${required}`);
}
for (const forbidden of ['COPY . ', 'git clone', 'npm install', 'pnpm install']) {
  if (dockerfile.includes(forbidden)) throw new Error(`final build boundary contains forbidden source/toolchain action: ${forbidden}`);
}

if (!/^[0-9a-f]{40}$/u.test(lock.kungfuSourceSha)) throw new Error('Kungfu source is not an exact commit');
if (!lock.buildImageDigest.startsWith('sha256:')) throw new Error('build image is not digest-pinned');
if (contract.sourceBuild.kungfuSourceSha !== lock.kungfuSourceSha) {
  throw new Error('contract and runtime lock disagree on Kungfu source');
}
if (contract.sourceBuild.packageSha256 !== lock.kungfuPackageSha256) {
  throw new Error('contract and runtime lock disagree on Kungfu package');
}
if (contract.sourceBuild.buildImagesConsumerSha !== lock.buildImagesConsumerSha) {
  throw new Error('contract and runtime lock disagree on build-images source');
}
if (!contract.sourceBuild.buildImage.endsWith(`@${lock.buildImageDigest}`)) {
  throw new Error('contract and runtime lock disagree on build image digest');
}
if (lock.status === 'qualified-development-candidate') {
  validateImageReference(lock.image);
  if (`${contractText}\n${lockText}`.includes('INPUT_')) {
    throw new Error('qualified identity files retain unresolved inputs');
  }
  if (!/^https:\/\/github\.com\/kungfu-systems\/runtime-images\/actions\/runs\/[0-9]+$/u.test(lock.qualificationRun)) {
    throw new Error('qualification run is not an exact retained runtime-images run');
  }
  if (!compose.includes(`image: ${'${KUNGFU_HUB_IMAGE:-'}${lock.image}}`)) {
    throw new Error('Compose does not default to the qualified exact image');
  }
}
if (!compose.includes('HUB_COURSE_NAME: ${HUB_COURSE_NAME:-AI Teaching Sprint}')) {
  throw new Error('bounded course-team extension seam is missing');
}

console.log('[verify] source, Compose, image boundary, and identity contracts passed');
