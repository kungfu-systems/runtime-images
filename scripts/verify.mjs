// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises';
import { validateComposeText, validateImageReference } from '../src/policy.mjs';

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');
const compose = await read('../compose.yaml');
const dockerfile = await read('../Dockerfile');
const developerCompose = await read('../compose.dev.yaml');
const developerDockerfile = await read('../Dockerfile.dev');
const smoke = await read('./smoke-image.sh');
const contractText = await read('../contracts/hub-starter-runtime.contract.json');
const lockText = await read('../release/runtime.lock.json');
const imageWorkflow = await read('../.github/workflows/image.yml');
const packageStageWorkflow = await read('../.github/workflows/package-stage.yml');
const applicationWorkflow = await read('../.github/workflows/application.yml');
const browser = await read('../apps/course-hub/web/app.js');
const server = await read('../apps/course-hub/src/server.mjs');
const workControl = await read('../apps/course-hub/src/kungfu-course-work-control.mjs');
const modelCatalog = await read('../apps/course-hub/src/model-catalog.mjs');
const readme = await read('../README.md');
const agentGuide = await read('../AGENTS.md');
const projectMap = await read('../docs/MAP.md');
const packageManifest = JSON.parse(await read('../package.json'));
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
  'apps/course-hub/migrations',
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
  'bootstrap:',
  'condition: service_completed_successfully',
  'POSTGRES_PASSWORD_FILE: /install-config/database-migration-password',
  'COURSE_DB_MIGRATION_PASSWORD_FILE: /install-config/database-migration-password',
  'COURSE_DB_APP_PASSWORD_FILE: /install-config/database-app-password',
  'install-config:/install-config',
  'course-postgres:/var/lib/postgresql/data',
  'course-models:/models',
  'published: "${HUB_PORT:-8080}"',
  'host_ip: "${HUB_BIND_ADDRESS:-127.0.0.1}"',
  'read_only: true',
  'no-new-privileges:true',
  'cap_drop:',
]) {
  if (!compose.includes(required)) throw new Error(`unified Compose invariant missing: ${required}`);
}
if (/^  llama:/mu.test(compose)) throw new Error('unified delivery must not require a llama sidecar');
const databaseService = compose.match(/^  database:\n([\s\S]*?)(?=^  hub:)/mu)?.[1] ?? '';
if (/^    ports:/mu.test(databaseService)) {
  throw new Error('PostgreSQL must remain private to the Compose network');
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
for (const applicationInvariant of [
  'docker/setup-compose-action@',
  'docker compose publish -y "${immutable}"',
  'docker compose publish -y "${preview}"',
  'compose-preview',
  'docker compose -f "oci://${APPLICATION_REF}" "$@"',
  'compose_oci up --wait',
  'NetworkSettings.Ports["5432/tcp"] == null',
]) {
  if (!applicationWorkflow.includes(applicationInvariant)) {
    throw new Error(`OCI Compose workflow invariant missing: ${applicationInvariant}`);
  }
}
if (/down\s+-v/u.test(applicationWorkflow)) {
  throw new Error('OCI Compose workflow must not delete named volumes');
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
if (packageManifest.scripts.start !== 'node apps/course-hub/src/server.mjs') {
  throw new Error('npm start must launch the canonical Course Hub application');
}
if (!packageManifest.scripts['start:legacy']?.includes('legacy/hub-starter')) {
  throw new Error('the former Hub Starter entrypoint must remain explicitly available');
}
for (const required of [
  'ARG KUNGFU_HUB_BASE',
  'FROM ${KUNGFU_HUB_BASE}',
  'COPY --chown=root:root apps/course-hub/src /opt/course/src',
  'COPY --chown=root:root apps/course-hub/web /opt/course/web',
  'COPY --chown=root:root apps/course-hub/migrations /opt/course/migrations',
  'USER node',
]) {
  if (!developerDockerfile.includes(required)) {
    throw new Error(`developer Dockerfile invariant missing: ${required}`);
  }
}
if (!developerCompose.includes(`KUNGFU_HUB_BASE: ${'${KUNGFU_HUB_BASE:-'}${lock.image}}`)) {
  throw new Error('developer overlay does not default to the qualified exact image');
}
for (const [label, text] of [
  ['README', readme],
  ['Agent guide', agentGuide],
]) {
  for (const required of [
    'kungfu agent brief',
    'kungfu agent verify --json',
    'docs/ARCHITECTURE.md',
    'docs/EXTENDING.md',
    'apps/course-hub/',
  ]) {
    if (!text.includes(required)) throw new Error(`${label} onboarding missing: ${required}`);
  }
}
if (projectMap.includes('course-business-reference/src/')) {
  throw new Error('project map still presents the compatibility directory as canonical source');
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
