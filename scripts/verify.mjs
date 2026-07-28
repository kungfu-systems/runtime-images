// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises';
import { validateComposeText, validateImageReference } from '../src/policy.mjs';

const compose = await readFile(new URL('../compose.yaml', import.meta.url), 'utf8');
validateComposeText(compose);
const smoke = await readFile(new URL('./smoke-image.sh', import.meta.url), 'utf8');
if (smoke.includes('docker network create --internal')) {
  throw new Error('image smoke uses a host-disconnected network for published localhost ports');
}
if (!smoke.includes('docker network create "${network}"')) {
  throw new Error('image smoke does not create the expected user-defined bridge network');
}

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
const imageWorkflow = await readFile(new URL('../.github/workflows/image.yml', import.meta.url), 'utf8');
const packageStageWorkflow = await readFile(
  new URL('../.github/workflows/package-stage.yml', import.meta.url),
  'utf8',
);
for (const required of [
  'FROM ${RUNTIME_IMAGE} AS package',
  'FROM ${RUNTIME_IMAGE} AS runtime',
  'ARG TARGETARCH',
  'kungfu-episodes-cli-linux-arm64.tar.gz',
  'sha256sum -c -',
  'USER node',
  'tech.kungfu.product.source',
  'tech.kungfu.product.package.amd64.sha256',
  'tech.kungfu.product.package.arm64.sha256',
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

for (const workflowInvariant of [
  'platforms: linux/amd64,linux/arm64',
  'runner: ubuntu-24.04-arm',
  'docker-architecture: arm64',
  'package-sha256-amd64',
  'package-sha256-arm64',
  'kungfu-episodes-cli-linux-arm64.tar.gz',
]) {
  if (!imageWorkflow.includes(workflowInvariant)) {
    throw new Error(`multi-platform image workflow invariant missing: ${workflowInvariant}`);
  }
}
for (const stagingInvariant of [
  'kungfu-run-id-amd64',
  'kungfu-run-id-arm64',
  'for run_id in "${KUNGFU_RUN_ID_AMD64}" "${KUNGFU_RUN_ID_ARM64}"',
  'repos/kungfu-systems/kungfu/actions/runs/${run_id}',
  'completed\\tsuccess\\t',
  'run-id: ${{ inputs.kungfu-run-id-amd64 }}',
  'run-id: ${{ inputs.kungfu-run-id-arm64 }}',
  'pattern: kungfu-linux-x64-*',
  'pattern: kungfu-hub-cli-linux-arm64-*',
  'runs:{"linux/amd64":$runIdAmd64,"linux/arm64":$runIdArm64}',
  'package_sha256_amd64=$(sha256sum stage/kungfu-episodes-cli-linux-x64.tar.gz',
  'package_sha256_arm64=$(sha256sum stage/kungfu-episodes-cli-linux-arm64.tar.gz',
  "'.sourceCommit == $source and .productVersion == $version",
  'gh release create "${release_tag}"',
]) {
  if (!packageStageWorkflow.includes(stagingInvariant)) {
    throw new Error(`package staging workflow invariant missing: ${stagingInvariant}`);
  }
}

if (contract.sourceBuild.kungfuSourceSha !== lock.kungfuSourceSha) {
  throw new Error('contract and runtime lock disagree on Kungfu source');
}
if (contract.runtime.baseImage !== lock.runtimeBaseImage) {
  throw new Error('contract and runtime lock disagree on the multi-platform runtime base');
}
for (const platform of ['linux/amd64', 'linux/arm64']) {
  const contractPackage = contract.sourceBuild.packages[platform];
  const lockedPackage = lock.kungfuPackages[platform];
  if (contractPackage.name !== lockedPackage.name || contractPackage.sha256 !== lockedPackage.sha256) {
    throw new Error(`contract and runtime lock disagree on ${platform} Kungfu package`);
  }
}
if (lock.status === 'qualified-development-candidate') {
  if (!/^[0-9a-f]{40}$/u.test(lock.kungfuSourceSha)) throw new Error('Kungfu source is not an exact commit');
  if (!lock.runtimeBaseImage.endsWith('@sha256:ae91dcc111a68c9d2d81ff2a17bda61be126426176fde6fe7d08ab13b7f50573')) {
    throw new Error('qualified runtime base is not the reviewed multi-platform Node index');
  }
  for (const platform of ['linux/amd64', 'linux/arm64']) {
    if (!/^[0-9a-f]{64}$/u.test(lock.kungfuPackages[platform].sha256)) {
      throw new Error(`${platform} Kungfu package is not exact`);
    }
  }
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
if (!compose.includes('HUB_COURSE_NAME: ${HUB_COURSE_NAME:-Agent/Kungfu Course}')) {
  throw new Error('bounded course-team extension seam is missing');
}
if (/docker\s+volume\s+rm|docker\s+compose\s+down\s+-v/u.test(smoke)) {
  throw new Error('image smoke must retain named development state volumes');
}
for (const route of ['/api/coursework/claim', '/api/coursework/evidence']) {
  if (!smoke.includes(route)) throw new Error(`coursework smoke route missing: ${route}`);
}
const page = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
for (const productCopy of ['Selected homework', 'Agent submission', 'Independent check', 'Audit and developer details']) {
  if (!page.includes(productCopy)) throw new Error(`coursework product copy missing: ${productCopy}`);
}

console.log('[verify] source, Compose, image boundary, and identity contracts passed');
