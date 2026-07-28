// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises';
import { validateComposeText, validateImageReference } from '../src/policy.mjs';

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');
const compose = await read('../compose.yaml');
const dockerfile = await read('../Dockerfile');
const smoke = await read('./smoke-image.sh');
const contractText = await read('../contracts/hub-starter-runtime.contract.json');
const lockText = await read('../release/runtime.lock.json');
const imageWorkflow = await read('../.github/workflows/image.yml');
const packageStageWorkflow = await read('../.github/workflows/package-stage.yml');
const browser = await read('../course-business-reference/web/app.js');
const server = await read('../course-business-reference/src/server.mjs');
const workControl = await read('../course-business-reference/src/kungfu-course-work-control.mjs');
const modelCatalog = await read('../course-business-reference/src/model-catalog.mjs');
const contract = JSON.parse(contractText);
const lock = JSON.parse(lockText);

validateComposeText(compose);
JSON.parse(await read('../package.json'));

for (const required of [
  'FROM ${RUNTIME_IMAGE} AS dependencies',
  'FROM ${RUNTIME_IMAGE} AS package',
  'FROM ${LLAMA_IMAGE} AS llama',
  'FROM ${RUNTIME_IMAGE} AS runtime',
  'ARG TARGETARCH',
  'kungfu-episodes-cli-linux-arm64.tar.gz',
  'sha256sum -c -',
  'COPY --from=llama --chown=root:root /app /opt/llama',
  'course-business-reference/migrations',
  'COURSE_LOCAL_MODEL_MANAGEMENT=true',
  'KUNGFU_INSTALL_SOURCE=archive',
  'KUNGFU_UPGRADE_MANIFEST=/opt/kungfu/upgrade/kungfu-release-manifest.json',
  'ln -s /opt/kungfu/kungfu /usr/local/bin/kungfu',
  'ln -s /opt/llama/llama-server /usr/local/bin/llama-server',
  'USER node',
]) {
  if (!dockerfile.includes(required)) throw new Error(`Dockerfile invariant missing: ${required}`);
}
for (const forbidden of ['COPY . ', 'git clone', 'npm install', 'pnpm install']) {
  if (dockerfile.includes(forbidden)) {
    throw new Error(`final build boundary contains forbidden source/toolchain action: ${forbidden}`);
  }
}
if (/COPY[^\n]*\.gguf/iu.test(dockerfile)) {
  throw new Error('first-party image must not copy model weights');
}
for (const required of [
  'course-postgres:/var/lib/postgresql/data',
  'course-models:/models',
  '${HUB_BIND_ADDRESS:-127.0.0.1}:${HUB_PORT:-8080}:8080',
  'read_only: true',
  'no-new-privileges:true',
  'cap_drop:',
]) {
  if (!compose.includes(required)) throw new Error(`unified Compose invariant missing: ${required}`);
}
if (/^  llama:/mu.test(compose)) throw new Error('unified delivery must not require a llama sidecar');

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
  'validate_run "${KUNGFU_RUN_ID_AMD64}" Build',
  "validate_run \"${KUNGFU_RUN_ID_ARM64}\" 'Linux ARM64 Alpha Qualification'",
  'package_sha256_amd64=$(sha256sum stage/kungfu-episodes-cli-linux-x64.tar.gz',
  'package_sha256_arm64=$(sha256sum stage/kungfu-episodes-cli-linux-arm64.tar.gz',
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
validateImageReference(lock.image);
if (!compose.includes(`image: ${'${KUNGFU_HUB_IMAGE:-'}${lock.image}}`)) {
  throw new Error('Compose does not default to the qualified exact image');
}

for (const required of [
  '/api/runtime/local-models/',
  'data-runtime-model-install',
  'data-runtime-model-activate',
  'Work control · current truth',
  'KUNGFU',
]) {
  if (!`${server}\n${browser}`.includes(required)) {
    throw new Error(`unified product surface missing: ${required}`);
  }
}
for (const command of [
  "'work', 'capture'",
  "'work', 'admit'",
  "'work', 'claim'",
  "'work', 'claim-completion'",
  "'work', 'review'",
  "'work', 'decide'",
  "'work', 'seal'",
  "'storage', 'episode', 'attach-payload'",
]) {
  if (!workControl.includes(command)) throw new Error(`Kungfu adapter command missing: ${command}`);
}
if ((modelCatalog.match(/id: 'qwen3-/gu) ?? []).length < 3) {
  throw new Error('model catalog must expose at least three pinned Qwen choices');
}
for (const required of ['revision:', 'sha256:', 'bytes:', 'memoryBytes:']) {
  if (!modelCatalog.includes(required)) throw new Error(`model catalog identity missing: ${required}`);
}
if (/docker\s+volume\s+rm|docker\s+compose\s+down\s+-v|docker\s+system\s+prune/u.test(smoke)) {
  throw new Error('image smoke must retain named state and avoid destructive cleanup');
}

console.log('[verify] unified image, Compose, model catalog, Kungfu adapter, and identity contracts passed');
