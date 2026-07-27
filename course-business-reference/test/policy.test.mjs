// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('business routes do not import mock implementation details', async () => {
  const [server, domain, outbox] = await Promise.all([
    read('../src/server.mjs'),
    read('../src/domain.mjs'),
    read('../src/outbox.mjs'),
  ]);
  assert.equal(domain.includes('mock-agent-work-adapter'), false);
  assert.equal(outbox.includes('mock-agent-work-adapter'), false);
  assert.equal(server.includes('MockAgentWorkAdapter'), true);
});

test('mock namespace, business-owned versions, and UI remain explicitly bounded', async () => {
  const [adapter, migration, projectsMigration, html] = await Promise.all([
    read('../src/mock-agent-work-adapter.mjs'),
    read('../migrations/001_initial.sql'),
    read('../migrations/003_course_projects.sql'),
    read('../web/index.html'),
  ]);
  assert.match(adapter, /simulated/u);
  assert.match(adapter, /Not Kungfu evidence/u);
  assert.match(migration, /mock_agent_work/u);
  assert.match(projectsMigration, /course_outline_versions/u);
  assert.match(projectsMigration, /FORCE ROW LEVEL SECURITY/u);
  assert.match(html, /Visible Mock Agent/u);
  assert.equal(adapter.includes('sha256:'), false);
});

test('qualification faults are explicit and absent without a run id', async () => {
  const { createQualificationFaults } = await import('../src/qualification-faults.mjs');
  const hooks = createQualificationFaults({
    qualificationRunId: '',
    outboxProcessingStaleSeconds: 30,
  });
  assert.equal(hooks.processingStaleSeconds, 30);
  assert.equal(hooks.beforeExecute, undefined);
  assert.equal(hooks.afterExecute, undefined);
});

test('course UI keeps event objects out of messages and only disables workspace controls', async () => {
  const browser = await read('../web/app.js');
  assert.match(browser, /addEventListener\('click', \(\) => showNewCourse\(\)\)/u);
  assert.match(browser, /app\.querySelectorAll\('button, textarea'\)/u);
  assert.equal(browser.includes("addEventListener('click', showNewCourse)"), false);
  assert.equal(browser.includes("document.querySelectorAll('button, textarea')"), false);
});
