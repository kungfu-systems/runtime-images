// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises';
import { validateComposeText, validateImageReference } from '../src/policy.mjs';

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');
const compose = await read('../compose.yaml');
const dockerfile = await read('../Dockerfile');
const developerCompose = await read('../compose.dev.yaml');
const developerDockerfile = await read('../Dockerfile.dev');
const smoke = await read('./smoke-image.sh');
const smokeCourseApi = await read('./smoke-course-api.mjs');
const prepareBuildCandidate = await read('./prepare-kungfu-build-candidate.mjs');
const stagePackageRelease = await read('./stage-kungfu-package-release.sh');
const contractText = await read('../contracts/hub-starter-runtime.contract.json');
const lockText = await read('../release/runtime.lock.json');
const imageWorkflow = await read('../.github/workflows/image.yml');
const packageStageWorkflow = await read('../.github/workflows/package-stage.yml');
const applicationWorkflow = await read('../.github/workflows/application.yml');
const verifyWorkflow = await read('../.github/workflows/verify.yml');
const promotionWorkflow = await read('../.github/workflows/buildchain-ref-promotion.yml');
const buildchainConfig = await read('../buildchain.toml');
const publishRuntime = await read('./publish-runtime-release.sh');
const publishEvidence = await read('./write-runtime-publish-evidence.mjs');
const requiredArtifacts = await read('./required-publish-artifacts.mjs');
const releaseImpactText = await read('../.buildchain/release-impact.json');
const browser = await read('../apps/course-hub/web/app.js');
const server = await read('../apps/course-hub/src/server.mjs');
const workControl = await read('../apps/course-hub/src/kungfu-course-work-control.mjs');
const modelCatalog = await read('../apps/course-hub/src/model-catalog.mjs');
const readme = await read('../README.md');
const agentGuide = await read('../AGENTS.md');
const projectMap = await read('../docs/MAP.md');
const upgradeGuide = await read('../docs/UPGRADING.md');
const packageManifest = JSON.parse(await read('../package.json'));
const contract = JSON.parse(contractText);
const lock = JSON.parse(lockText);
const releaseImpact = JSON.parse(releaseImpactText);

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
  'host_ip: "127.0.0.1"',
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

for (const stagingInvariant of [
  'kungfu-build-run-id',
  'KUNGFU_BUILD_RUN_ID',
  '--jq \'[.status, .conclusion, .head_sha, .name] | @tsv\'',
  '| grep -Fx',
  "$'\\tBuild'",
  'pattern: kungfu-linux-x64-*',
  'pattern: kungfu-linux-arm64-*',
  'pattern: kungfu-product-upgrade-publication-admission-*',
  'node scripts/prepare-kungfu-build-candidate.mjs',
  'actions/upload-artifact@',
]) {
  if (!packageStageWorkflow.includes(stagingInvariant)) {
    throw new Error(`package qualification workflow invariant missing: ${stagingInvariant}`);
  }
}
for (const forbidden of [
  'kungfu-run-id-amd64',
  'kungfu-run-id-arm64',
  'Linux ARM64 Alpha Qualification',
]) {
  if (packageStageWorkflow.includes(forbidden)) {
    throw new Error(`package qualification workflow retains split-run input: ${forbidden}`);
  }
}
if ((packageStageWorkflow.match(/run-id: \$\{\{ inputs\.kungfu-build-run-id \}\}/gu) ?? []).length !== 3) {
  throw new Error('all three package candidate artifacts must come from one exact Build run');
}
for (const invariant of [
  'kungfu.hub-starter.package-input-qualification/v2',
  'kungfu.hub-starter.runtime-input-proposal/v1',
  'kungfu.product-upgrade.publication-admission/v1',
  'kungfu.product-upgrade.publication-candidate-capsule/v1',
  "'linux/amd64'",
  "'linux/arm64'",
  'contractSourceBuild',
  'kungfuBuildHeadSha',
  'kungfuBuildRun',
  'qualificationRoot',
  'kungfuAdmission',
  'remainingRequiredFields',
  "'runtimeLock.packageRelease'",
  "'runtimeLock.imageSourceRevision'",
]) {
  if (!prepareBuildCandidate.includes(invariant)) {
    throw new Error(`unified Build candidate verifier invariant missing: ${invariant}`);
  }
}

for (const [name, workflow] of [
  ['image candidate', imageWorkflow],
  ['package input', packageStageWorkflow],
  ['Compose application', applicationWorkflow],
]) {
  for (const forbidden of [
    'packages: write',
    'docker/login-action@',
    'docker compose publish',
    'docker buildx imagetools create',
    'gh release create',
    'push: true',
  ]) {
    if (workflow.includes(forbidden)) {
      throw new Error(`${name} manual workflow retains publication authority: ${forbidden}`);
    }
  }
}

for (const invariant of [
  'kungfu-systems/buildchain/actions/validate-config@v3',
  'require-version-state: "true"',
  'require-lifecycle-stages: "verify,publish"',
  'name: check',
  'npm run check',
]) {
  if (!verifyWorkflow.includes(invariant)) {
    throw new Error(`Buildchain Verify workflow invariant missing: ${invariant}`);
  }
}

for (const invariant of [
  'workflow_run:',
  'workflows: ["Verify"]',
  'Reject manual apply',
  "inputs['dry-run'] != 'true'",
  'kungfu-systems/buildchain/actions/promote-buildchain-ref@v3-alpha',
  'kungfu-systems/buildchain/actions/promote-buildchain-ref@v3',
  'generated-status-check-token: ${{ github.token }}',
  'generated-pull-request-token: ${{ secrets.BUILDCHAIN_PROMOTION_TOKEN || github.token }}',
  'generated-ref-update-token: ${{ github.token }}',
  'required-status-check: "check"',
  'publish-transaction: "true"',
  'publish-required-artifacts-json:',
  'release-passport: "true"',
  'release-passport-impact-json: ".buildchain/release-impact.json"',
  'github-release: "true"',
  'actions: read',
  'bash scripts/stage-kungfu-package-release.sh',
  'docker/setup-qemu-action@v3',
  'version: v5.1.2',
]) {
  if (!promotionWorkflow.includes(invariant)) {
    throw new Error(`Buildchain promotion workflow invariant missing: ${invariant}`);
  }
}

for (const invariant of [
  'packageQualificationRun',
  'packageQualificationArtifact',
  'kungfuBuildHeadSha',
  'kungfuBuildRun',
  'qualificationRoot',
  'kungfuAdmission',
  'gh run download',
  'gh release create',
  'sha256sum -c -',
]) {
  if (!stagePackageRelease.includes(invariant)) {
    throw new Error(`protected package release staging invariant missing: ${invariant}`);
  }
}

for (const invariant of [
  'path = "package.json"',
  'path = ".buildchain/release-impact.json"',
  '[lifecycle.verify]',
  '"npm run check"',
  '[lifecycle.publish]',
  '"bash scripts/publish-runtime-release.sh"',
]) {
  if (!buildchainConfig.includes(invariant)) {
    throw new Error(`Buildchain consumer configuration invariant missing: ${invariant}`);
  }
}

for (const invariant of [
  'linux/amd64,linux/arm64',
  '--provenance mode=max',
  '--sbom=true',
  'platform_digest()',
  '"${image_name}@${image_digest_arm64}"',
  'COURSE_SMOKE_PORT=18082',
  'qemu-full-course-contract',
  'agent verify --json',
  'scripts/smoke-image.sh',
  'compose-v${BUILDCHAIN_VERSION}',
  'compose_config_with_retry',
  'compose_up_with_retry',
  'compose_config_has_exact_image',
  'max_attempts=12',
  'for digest in "${image_digest}" "${image_digest_amd64}" "${image_digest_arm64}"',
  'application_source_path',
  'application_source_config_path',
  'index($0, "image: ${KUNGFU_HUB_IMAGE:-")',
  'grep -Fq \'${HUB_PORT:-8080}\'',
  'docker compose -f "${application_source_path}" config',
  'docker compose -f "${application_source_path}" publish',
  'NetworkSettings.Ports["5432/tcp"] == null',
  'hub-application-fresh-install.json',
  ".freshInstall == true",
  'hub-application-upgrade.json',
  'scripts/smoke-course-api.mjs',
  'test "${upgrade_database_id_after}" = "${upgrade_database_id_before}"',
  'test "${rollback_database_id}" = "${upgrade_database_id_before}"',
  'COURSE_SMOKE_PHASE=upgrade',
  'COURSE_SMOKE_PHASE=rollback',
  ".upgradePersistence == true and .rollbackPersistence == true",
  'scripts/write-runtime-publish-evidence.mjs',
  '--prefer-index=false',
  'compose-preview',
  'test "${promoted_preview_digest}" = "${application_digest}"',
]) {
  if (!publishRuntime.includes(invariant)) {
    throw new Error(`Buildchain publish lifecycle invariant missing: ${invariant}`);
  }
}
if (/down\s+-v/u.test(publishRuntime)) {
  throw new Error('Buildchain publish lifecycle must not delete named volumes');
}
if ((publishRuntime.match(/scripts\/smoke-image\.sh/gu) ?? []).length !== 2) {
  throw new Error('both amd64 and arm64 images require the full Course Hub smoke');
}
const exactApplicationSmoke = publishRuntime.indexOf(
  'compose_up_with_retry "${application_ref}" "${smoke_project}" 18083',
);
const freshApplicationCourse = publishRuntime.indexOf(
  'initial "${application_fresh_state_path}" "${application_fresh_path}"',
);
const evidenceWrite = publishRuntime.indexOf(
  'node "${repo_root}/scripts/write-runtime-publish-evidence.mjs"',
);
const upgradeSmoke = publishRuntime.indexOf(
  'test "${upgrade_database_id_after}" = "${upgrade_database_id_before}"',
);
const rollbackSmoke = publishRuntime.indexOf(
  'test "${rollback_database_id}" = "${upgrade_database_id_before}"',
);
const previewPromotion = publishRuntime.indexOf(
  'docker buildx imagetools create',
);
if (
  exactApplicationSmoke < 0
  || freshApplicationCourse <= exactApplicationSmoke
  || upgradeSmoke <= freshApplicationCourse
  || rollbackSmoke <= upgradeSmoke
  || evidenceWrite <= rollbackSmoke
  || previewPromotion <= evidenceWrite
) {
  throw new Error(
    'exact application smoke, preserved-database upgrade and rollback smoke, and evidence validation '
    + 'must precede preview promotion',
  );
}

for (const invariant of [
  "const phase = process.env.COURSE_SMOKE_PHASE ?? 'restart'",
  '/^(restart|upgrade|rollback)$/u',
  'evidence[`${phase}Persistence`] = true',
  'evidence[`${phase}Image`] = process.env.IMAGE_REF',
]) {
  if (!smokeCourseApi.includes(invariant)) {
    throw new Error(`course persistence evidence invariant missing: ${invariant}`);
  }
}

for (const refTemplate of ['v{version}', 'compose-v{version}']) {
  if (!requiredArtifacts.includes(refTemplate)) {
    throw new Error(`required release artifact template missing: ${refTemplate}`);
  }
}
for (const field of [
  'source_sha: sourceSha',
  'release_sha: releaseSha',
  'release_material_sha: releaseMaterialSha',
  'publish_tooling_sha: publishToolingSha',
  'BUILDCHAIN_REQUIRED_ARTIFACTS',
]) {
  if (!publishEvidence.includes(field)) {
    throw new Error(`publish evidence binding missing: ${field}`);
  }
}
if (
  releaseImpact.release.line !== 'v1.0'
  || releaseImpact.versionImpact.final !== 'major'
  || releaseImpact.surfaceImpacts.length < 3
) {
  throw new Error('release impact ledger does not describe the governed v1.0 alpha surface');
}

if (contract.sourceBuild.kungfuSourceSha !== lock.kungfuSourceSha) {
  throw new Error('contract and runtime lock disagree on Kungfu source');
}
if (contract.sourceBuild.kungfuBuildRun !== lock.kungfuBuildRun) {
  throw new Error('contract and runtime lock disagree on the exact Kungfu Build run');
}
if (JSON.stringify(contract.sourceBuild.admission) !== JSON.stringify(lock.kungfuAdmission)) {
  throw new Error('contract and runtime lock disagree on Kungfu publication admission roots');
}
if (contract.runtime.baseImage !== lock.runtimeBaseImage) {
  throw new Error('contract and runtime lock disagree on the multi-platform runtime base');
}
for (const platform of ['linux/amd64', 'linux/arm64']) {
  const contractPackage = contract.sourceBuild.packages[platform];
  const lockedPackage = lock.kungfuPackages[platform];
  if (
    contractPackage.name !== lockedPackage.name
    || contractPackage.sha256 !== lockedPackage.sha256
    || contractPackage.qualificationRoot !== lockedPackage.qualificationRoot
  ) {
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
  'up --pull always --wait',
  'compose-${VERSION}',
  'COMPOSE_PROJECT_NAME',
  'docker compose down -v',
]) {
  if (!upgradeGuide.includes(required)) {
    throw new Error(`upgrade guide invariant missing: ${required}`);
  }
}
if (!readme.includes('[Upgrade and rollback](docs/UPGRADING.md)')) {
  throw new Error('README onboarding must link the upgrade and rollback guide');
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
