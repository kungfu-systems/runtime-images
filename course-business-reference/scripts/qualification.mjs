// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const origin = process.env.COURSE_ORIGIN ?? 'http://127.0.0.1:8090';
const nonce = Date.now();

class Browser {
  cookie = '';
  csrf = '';

  async call(path, { method = 'GET', body, key, originHeader = origin } = {}) {
    const headers = { origin: originHeader };
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

async function register(browser, name) {
  const result = await browser.call('/api/register', {
    method: 'POST',
    body: {
      displayName: name,
      email: `${name.toLowerCase()}-${nonce}@example.test`,
      password: 'synthetic-course-password-42',
    },
  });
  assert.equal(result.status, 200);
  return result.value.user;
}

const first = new Browser();
const second = new Browser();
const firstUser = await register(first, 'Alpha');
const secondUser = await register(second, 'Beta');
assert.notEqual(firstUser.id, secondUser.id);

const firstList = await first.call('/api/homeworks');
const secondList = await second.call('/api/homeworks');
assert.equal(firstList.value.homeworks.length, 1);
assert.equal(secondList.value.homeworks.length, 1);
const firstId = firstList.value.homeworks[0].id;
const secondId = secondList.value.homeworks[0].id;
assert.notEqual(firstId, secondId);

const idor = await first.call(`/api/homeworks/${secondId}`);
assert.equal(idor.status, 404);
const rejectedOrigin = await first.call(`/api/homeworks/${firstId}/actions/first-submission`, {
  method: 'POST',
  key: `origin:${nonce}`,
  body: {},
  originHeader: 'http://attacker.invalid',
});
assert.equal(rejectedOrigin.status, 403);

const actions = [
  ['first-submission', {}],
  ['evidence', {
    title: 'Qualified course outline',
    content: 'Audience: builders\nOutcome: tested course\nModule 1: audience\nModule 2: curriculum\nModule 3: validation\nExercise: review one outline',
  }],
  ['review', {}],
  ['seal', {}],
];
const states = [];
for (const [action, payload] of actions) {
  const key = `qualification:${nonce}:${action}`;
  const result = await first.call(`/api/homeworks/${firstId}/actions/${action}`, {
    method: 'POST',
    body: payload,
    key,
  });
  assert.equal(result.status, 200);
  states.push(result.value.homework.agentWork.status);
  const duplicate = await first.call(`/api/homeworks/${firstId}/actions/${action}`, {
    method: 'POST',
    body: payload,
    key,
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.value.homework.agentWork.status, result.value.homework.agentWork.status);
}
assert.deepEqual(states, ['needs_evidence', 'evidence_submitted', 'accepted', 'sealed']);

const logout = await second.call('/api/logout', { method: 'POST', body: {} });
assert.equal(logout.status, 200);
const revoked = await second.call('/api/homeworks');
assert.equal(revoked.status, 401);

const evidence = {
  schema: 'course-business-reference.qualification/v1',
  origin,
  learners: 2,
  perAccountHomework: true,
  idorStatus: idor.status,
  originRejectionStatus: rejectedOrigin.status,
  duplicateDeliveryStable: true,
  goldenPathStates: states,
  logoutRevoked: revoked.status === 401,
  backend: 'mock-simulated',
  qualifiedAt: new Date().toISOString(),
};
if (process.env.COURSE_EVIDENCE_PATH) {
  await writeFile(process.env.COURSE_EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
}
console.log(JSON.stringify(evidence, null, 2));
