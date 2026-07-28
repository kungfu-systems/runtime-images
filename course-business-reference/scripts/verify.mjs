// SPDX-License-Identifier: Apache-2.0
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const [
  compose,
  dockerfile,
  initialMigration,
  workMigration,
  hostedMigration,
  server,
  browser,
  workControl,
  modelCatalog,
  modelManager,
  interactiveOverlay,
  offlineOverlay,
] = await Promise.all([
  read('compose.yaml'),
  read('Dockerfile'),
  read('apps/course-hub/migrations/001_initial.sql'),
  read('apps/course-hub/migrations/007_kungfu_course_work_control.sql'),
  read('apps/course-hub/migrations/008_hosted_inference_backend.sql'),
  read('apps/course-hub/src/server.mjs'),
  read('apps/course-hub/web/app.js'),
  read('apps/course-hub/src/kungfu-course-work-control.mjs'),
  read('apps/course-hub/src/model-catalog.mjs'),
  read('apps/course-hub/src/local-model-manager.mjs'),
  read('course-business-reference/compose.interactive-local.yaml'),
  read('course-business-reference/compose.offline.yaml'),
]);

for (const required of [
  'postgres:17.6-bookworm@sha256:',
  '${HUB_BIND_ADDRESS:-127.0.0.1}:${HUB_PORT:-8080}:8080',
  'course-postgres:/var/lib/postgresql/data',
  'course-models:/models',
  'COURSE_DB_APP_PASSWORD',
  'read_only: true',
  'no-new-privileges:true',
]) {
  if (!compose.includes(required)) throw new Error(`Compose invariant missing: ${required}`);
}
for (const forbidden of ['docker.sock', 'network_mode: host', '/Users/', '/home/']) {
  if (compose.includes(forbidden)) throw new Error(`Compose contains forbidden boundary: ${forbidden}`);
}
for (const required of [
  'FROM ${LLAMA_IMAGE} AS llama',
  'COPY --from=llama',
  'COPY --from=package',
  'USER node',
  'apps/course-hub/migrations',
]) {
  if (!dockerfile.includes(required)) throw new Error(`Dockerfile invariant missing: ${required}`);
}
for (const required of [
  'ENABLE ROW LEVEL SECURITY',
  'FORCE ROW LEVEL SECURITY',
  "current_setting('app.user_id'",
  'mock_agent_work',
]) {
  if (!initialMigration.includes(required)) throw new Error(`isolation invariant missing: ${required}`);
}
for (const required of [
  'kungfu_binding_id',
  'work_control_state',
  'course.kungfu-work-control/v1',
  'legacy-unmanaged',
]) {
  if (!workMigration.includes(required)) throw new Error(`work-control migration missing: ${required}`);
}
if (!hostedMigration.includes("'hosted'")) throw new Error('hosted backend migration is missing');
for (const route of ['local-models', 'install', 'activate']) {
  if (!server.includes(route)) throw new Error(`model route missing: ${route}`);
}
for (const required of [
  'data-runtime-model-install',
  'data-runtime-model-activate',
  'data-runtime-select="mock"',
  'data-runtime-select="hosted"',
  'backendKind: selectedBackend',
  'Stable course binding',
  'Portable seal',
]) {
  if (!browser.includes(required)) throw new Error(`browser boundary missing: ${required}`);
}
for (const required of [
  "'work', 'capture'",
  "'work', 'admit'",
  "'work', 'claim'",
  "'work', 'kickoff'",
  "'work', 'stage'",
  "'storage', 'episode', 'begin'",
  "'storage', 'episode', 'attach-payload'",
  "'work', 'claim-completion'",
  "'work', 'review'",
  "'work', 'decide'",
  "'work', 'seal'",
]) {
  if (!workControl.includes(required)) throw new Error(`public Kungfu lifecycle missing: ${required}`);
}
if ((modelCatalog.match(/id: 'qwen3-/gu) ?? []).length !== 3) {
  throw new Error('the starter model catalog must contain exactly three Qwen choices');
}
for (const required of ['.part', 'headers.range', 'sha256', 'rename(partial, path)']) {
  if (!modelManager.includes(required)) throw new Error(`verified model delivery missing: ${required}`);
}
if (modelManager.includes('fallback') || server.includes('fallback')) {
  throw new Error('selected inference must not silently fall back to Mock');
}
for (const overlay of [interactiveOverlay, offlineOverlay]) {
  if (/^  (llama|model-init):/mu.test(overlay) || overlay.includes('wget ')) {
    throw new Error('compatibility overlays must not restore sidecars or automatic model downloads');
  }
}

console.log('[course-hub verify] business, inference, model, and Kungfu authority boundaries passed');
