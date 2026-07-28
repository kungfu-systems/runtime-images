// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';

const origin = process.env.COURSE_ORIGIN ?? 'http://127.0.0.1:18083';
const runKey = process.env.COURSE_SMOKE_RUN_KEY ?? `${Date.now()}`;
const expectedModelId = process.env.COURSE_SMOKE_MODEL_ID ?? 'qwen3-0.6b-q4';
const password = 'synthetic-local-model-smoke-password-42';
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

async function runtime() {
  const response = await fetch(`${origin}/api/runtime`);
  assert.equal(response.status, 200);
  return (await response.json()).runtime;
}

async function waitFor(description, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await sleep(1_000);
  }
  throw new Error(`${description} did not complete within ${timeoutMs}ms`);
}

const browser = new Browser();
const registration = await browser.call('/api/register', {
  method: 'POST',
  body: {
    displayName: 'Local Model Builder',
    email: `local-${runKey}@example.test`,
    password,
  },
});
assert.equal(registration.status, 200);

const initial = await runtime();
const initialCatalog = initial.backends['openai-compatible'].modelCatalog;
assert.equal(initialCatalog.models.length >= 3, true);
const selected = initialCatalog.models.find((model) => model.id === expectedModelId);
assert.ok(selected);
assert.equal(selected.state, 'not-installed');
assert.equal(initial.backends['openai-compatible'].ready, false);

const install = await browser.call(
  `/api/runtime/local-models/${expectedModelId}/install`,
  { method: 'POST', body: {} },
);
assert.equal(install.status, 202);
const installed = await waitFor('local model installation', async () => {
  const value = await runtime();
  const model = value.backends['openai-compatible'].modelCatalog.models
    .find((candidate) => candidate.id === expectedModelId);
  return model?.state === 'installed' ? value : null;
}, 5 * 60_000);
assert.equal(installed.backends['openai-compatible'].ready, false);

const activate = await browser.call(
  `/api/runtime/local-models/${expectedModelId}/activate`,
  { method: 'POST', body: {} },
);
assert.equal(activate.status, 200);
const active = await waitFor('local model activation', async () => {
  const value = await runtime();
  const backend = value.backends['openai-compatible'];
  return backend.ready && backend.modelCatalog.activeModelId === expectedModelId
    ? value
    : null;
}, 3 * 60_000);
assert.equal(active.backends['openai-compatible'].simulated, false);
assert.equal(active.backends['openai-compatible'].delivery, 'local');

const created = await browser.call('/api/courses', {
  method: 'POST',
  body: {
    title: '用 Agent 管理课程',
    targetLearner: '需要把个人经验变成可交付课程的小型商业 builder',
    learnerProblem: '经验散落在客户案例和工作坊记录里，无法稳定形成课程。',
    promisedOutcome: '产出并批准一份三模块、可验证、可以销售的课程大纲。',
    creatorExpertise: '真实客户案例、工作坊笔记和一套重复使用的交付方法。',
    deliveryConstraints: '三周完成，每周一次直播课，每节都有可观察练习。',
    backendKind: 'openai-compatible',
  },
});
assert.equal(created.status, 201);
const courseId = created.value.course.id;

const generated = await browser.call(`/api/courses/${courseId}/actions/generate`, {
  method: 'POST',
  key: `local-generate-${runKey}`,
  body: {},
});
assert.equal(generated.status, 200);
const course = await waitFor('local model course generation and Kungfu settlement', async () => {
  const response = await browser.call(`/api/courses/${courseId}`);
  const version = response.value.course?.versions?.[0];
  return response.status === 200 && version?.workControl ? response.value.course : null;
}, 6 * 60_000);
const version = course.versions[0];
assert.equal(version.agentRun.backend, 'openai-compatible');
assert.equal(version.outline.inference.delivery, 'local');
assert.match(version.outline.inference.provider, /^Local Qwen/u);
assert.equal(version.workControl.decision.action, 'close');
assert.match(version.workControl.seal.stateRoot, /^sha256:[0-9a-f]{64}$/u);

console.log(JSON.stringify({
  schema: 'kungfu.course-hub.local-model-smoke/v1',
  modelId: expectedModelId,
  model: version.outline.inference.model,
  provider: version.outline.inference.provider,
  courseId,
  versionId: version.id,
  outlineTitle: version.outline.title,
  moduleTitles: version.outline.modules.map((module) => module.title),
  kungfuBindingId: version.workControl.bindingId,
  stateRoot: version.workControl.seal.stateRoot,
}, null, 2));
