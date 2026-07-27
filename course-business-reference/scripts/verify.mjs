// SPDX-License-Identifier: Apache-2.0
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const [compose, dockerfile, migration, contract, server] = await Promise.all([
  read('compose.yaml'),
  read('Dockerfile'),
  read('migrations/001_initial.sql'),
  read('contracts/agent-work-port.v2.json'),
  read('src/server.mjs'),
]);
JSON.parse(contract);

for (const required of [
  '127.0.0.1:${COURSE_PORT:-8090}:8090',
  'cap_drop:',
  'read_only: true',
  'no-new-privileges:true',
  'postgres:17.6-bookworm@sha256:',
  'COURSE_DB_APP_PASSWORD',
]) {
  if (!compose.includes(required)) throw new Error(`Compose invariant missing: ${required}`);
}
for (const forbidden of ['docker.sock', 'network_mode: host', '/Users/', '/home/']) {
  if (compose.includes(forbidden)) throw new Error(`Compose contains forbidden boundary: ${forbidden}`);
}
const databaseService = compose.match(/^  database:\n([\s\S]*?)(?=^  app:)/mu)?.[0] ?? '';
if (!databaseService || /^\s{4}ports:/mu.test(databaseService)) {
  throw new Error('PostgreSQL must exist without publishing a host port');
}
for (const required of ['USER node', 'course.agent-work-port/v2', 'ENTRYPOINT']) {
  if (!dockerfile.includes(required)) throw new Error(`Dockerfile invariant missing: ${required}`);
}
for (const required of ['ENABLE ROW LEVEL SECURITY', 'FORCE ROW LEVEL SECURITY', "current_setting('app.user_id'", 'mock_agent_work']) {
  if (!migration.includes(required)) throw new Error(`Migration invariant missing: ${required}`);
}
if (server.includes('kungfu') || server.includes('KUNGFU_')) {
  throw new Error('course server must not integrate Kungfu in the mock-backed phase');
}
console.log('[course-reference verify] boundaries and contracts passed');
