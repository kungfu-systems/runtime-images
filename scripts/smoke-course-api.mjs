// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const mode = process.argv[2] ?? 'initial';
const statePath = process.argv[3];
const evidencePath = process.argv[4];
const origin = process.env.COURSE_ORIGIN ?? 'http://127.0.0.1:18081';
const runKey = process.env.COURSE_SMOKE_RUN_KEY ?? 'local';
const password = 'synthetic-course-smoke-password-42';
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class Browser {
  cookie = '';
  csrf = '';

  async call(path, { method = 'GET', body, key } = {}) {
    const headers = { origin };
    if (this.cookie) headers.cookie = this.cookie;
    if (this.csrf && method !== 'GET') headers['x-csrf-token'] = this.csrf;
    if (key) headers['idempotency-key'] = key;
    if (body) headers['content-type'] = 'application/json';
    const response = await fetch(`${origin}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';', 1)[0];
    const value = await response.json();
    if (value.csrfToken) this.csrf = value.csrfToken;
    return { status: response.status, value };
  }
}

const brief = (title) => ({
  title,
  targetLearner: 'Small-business experts who need a teachable learning path',
  learnerProblem: 'Their useful expertise is difficult to sequence and validate.',
  promisedOutcome: 'Create and approve one evidence-backed three-module course outline.',
  creatorExpertise: 'Client cases, workshop notes, and a repeatable method.',
  deliveryConstraints: 'Three weeks, practical exercises, and one live session each week.',
  backendKind: 'mock',
});

async function register(browser, displayName, email) {
  const response = await browser.call('/api/register', {
    method: 'POST',
    body: { displayName, email, password },
  });
  assert.equal(response.status, 200);
  return response.value.user;
}

async function login(browser, email) {
  const response = await browser.call('/api/login', {
    method: 'POST',
    body: { email, password },
  });
  assert.equal(response.status, 200);
  return response.value.user;
}

async function waitForVersion(browser, courseId) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const response = await browser.call(`/api/courses/${courseId}`);
    const version = response.value.course?.versions?.[0];
    if (response.status === 200 && version?.workControl) return response.value.course;
    await sleep(500);
  }
  throw new Error('generated version did not settle through Kungfu within three minutes');
}

if (mode === 'initial') {
  const runtimeResponse = await fetch(`${origin}/api/runtime`);
  assert.equal(runtimeResponse.status, 200);
  const { runtime } = await runtimeResponse.json();
  assert.equal(runtime.workControl.nativeCourseBinding, true);
  assert.equal(runtime.backends['openai-compatible'].modelCatalog.models.length, 3);
  assert.equal(runtime.backends.hosted.available, false);

  const alpha = new Browser();
  const beta = new Browser();
  const alphaEmail = `alpha-${runKey}@example.test`;
  const betaEmail = `beta-${runKey}@example.test`;
  const alphaUser = await register(alpha, 'Alpha Builder', alphaEmail);
  const betaUser = await register(beta, 'Beta Builder', betaEmail);
  assert.notEqual(alphaUser.id, betaUser.id);

  const alphaCreated = await alpha.call('/api/courses', {
    method: 'POST',
    body: brief('Agent-managed course design'),
  });
  const betaCreated = await beta.call('/api/courses', {
    method: 'POST',
    body: brief('Private beta course'),
  });
  assert.equal(alphaCreated.status, 201);
  assert.equal(betaCreated.status, 201);
  const courseId = alphaCreated.value.course.id;
  const betaCourseId = betaCreated.value.course.id;
  assert.equal(alphaCreated.value.course.kungfuBindingId, `kungfu:course:${courseId}`);

  const crossAccount = await alpha.call(`/api/courses/${betaCourseId}`);
  assert.equal(crossAccount.status, 404);

  const generated = await alpha.call(`/api/courses/${courseId}/actions/generate`, {
    method: 'POST',
    key: `generate-${runKey}`,
    body: {},
  });
  assert.equal(generated.status, 200);
  const course = await waitForVersion(alpha, courseId);
  const version = course.versions[0];
  assert.equal(version.versionNumber, 1);
  assert.equal(version.outline.modules.length, 3);
  assert.equal(version.workControl.schema, 'course.kungfu-work-control/v1');
  assert.equal(version.workControl.bindingId, `kungfu:course:${courseId}`);
  assert.equal(version.workControl.decision.action, 'close');
  assert.match(version.workControl.evidence.episodeRoot, /^sha256:[0-9a-f]{64}$/u);
  assert.match(version.workControl.seal.stateRoot, /^sha256:[0-9a-f]{64}$/u);

  const approved = await alpha.call(
    `/api/courses/${courseId}/versions/${version.id}/approve`,
    { method: 'POST', body: {} },
  );
  assert.equal(approved.status, 200);
  assert.equal(approved.value.course.currentOutlineVersionId, version.id);

  const state = {
    schema: 'kungfu.course-hub.smoke-state/v1',
    alphaEmail,
    betaEmail,
    courseId,
    betaCourseId,
    versionId: version.id,
    stateRoot: version.workControl.seal.stateRoot,
  };
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  await writeFile(evidencePath, `${JSON.stringify({
    schema: 'kungfu.course-hub.image-smoke/v1',
    image: process.env.IMAGE_REF ?? '',
    accountIsolation: true,
    modelCatalogChoices: 3,
    kungfuBindingId: version.workControl.bindingId,
    evidenceEpisodeRoot: version.workControl.evidence.episodeRoot,
    decision: version.workControl.decision.action,
    stateRoot: version.workControl.seal.stateRoot,
    approvedVersionId: version.id,
    freshInstall: true,
    restartPersistence: false,
  }, null, 2)}\n`);
} else if (mode === 'verify') {
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  const alpha = new Browser();
  await login(alpha, state.alphaEmail);
  const response = await alpha.call(`/api/courses/${state.courseId}`);
  assert.equal(response.status, 200);
  assert.equal(response.value.course.currentOutlineVersionId, state.versionId);
  assert.equal(response.value.course.versions[0].workControl.seal.stateRoot, state.stateRoot);
  const beta = new Browser();
  await login(beta, state.betaEmail);
  assert.equal((await beta.call(`/api/courses/${state.courseId}`)).status, 404);
  const phase = process.env.COURSE_SMOKE_PHASE ?? 'restart';
  assert.match(phase, /^(restart|upgrade|rollback)$/u);
  evidence[`${phase}Persistence`] = true;
  if (process.env.IMAGE_REF) evidence[`${phase}Image`] = process.env.IMAGE_REF;
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
} else {
  throw new Error(`unsupported smoke mode: ${mode}`);
}
