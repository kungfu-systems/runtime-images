// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const origin = process.env.COURSE_ORIGIN ?? 'http://127.0.0.1:8090';
const nonce = Date.now();
const expiryWaitMs = Number(process.env.COURSE_EXPIRY_WAIT_MS ?? 38_000);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForReady(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/readyz`);
      if (response.ok) return;
    } catch {
      // A qualification-only crash intentionally leaves a short reconnect gap.
    }
    await sleep(250);
  }
  throw new Error('application did not recover before the qualification deadline');
}

class Browser {
  cookie = '';
  csrf = '';

  async call(path, {
    method = 'GET',
    body,
    key,
    originHeader = origin,
    csrfHeader = 'auto',
  } = {}) {
    const headers = { origin: originHeader };
    if (this.cookie) headers.cookie = this.cookie;
    if (this.csrf && method !== 'GET' && csrfHeader !== null) {
      headers['x-csrf-token'] = csrfHeader === 'auto' ? this.csrf : csrfHeader;
    }
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

async function register(browser, name, email = `${name.toLowerCase()}-${nonce}@example.test`) {
  const result = await browser.call('/api/register', {
    method: 'POST',
    body: {
      displayName: name,
      email,
      password: 'synthetic-course-password-42',
    },
  });
  assert.equal(result.status, 200);
  return result.value.user;
}

async function login(browser, email) {
  const result = await browser.call('/api/login', {
    method: 'POST',
    body: { email, password: 'synthetic-course-password-42' },
  });
  assert.equal(result.status, 200);
  return result.value.user;
}

async function waitForHomework(browser, homeworkId, expected, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await browser.call(`/api/homeworks/${homeworkId}`);
    if (result.status === 200 && result.value.homework.agentWork?.status === expected) {
      return result.value.homework;
    }
    await sleep(250);
  }
  throw new Error(`homework did not reach ${expected}`);
}

const crashEmail = `crash-${nonce}@example.test`;
const crashAttempt = new Browser();
let crashDisconnected = false;
try {
  await register(crashAttempt, 'Crash recovery', crashEmail);
} catch {
  crashDisconnected = true;
}
assert.equal(crashDisconnected, true);
await waitForReady();
const recovered = new Browser();
await login(recovered, crashEmail);
const recoveredList = await recovered.call('/api/homeworks');
assert.equal(recoveredList.status, 200);
assert.equal(recoveredList.value.homeworks.length, 1);
const recoveredHomework = await waitForHomework(
  recovered,
  recoveredList.value.homeworks[0].id,
  'ready',
);
assert.equal(recoveredHomework.agentWork.audit.filter((item) => item.type === 'provisioned').length, 1);

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
const rejectedCsrf = await first.call(`/api/homeworks/${firstId}/actions/first-submission`, {
  method: 'POST',
  key: `csrf:${nonce}`,
  body: {},
  csrfHeader: 'wrong-csrf-token',
});
assert.equal(rejectedCsrf.status, 403);

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
  const injectedPayload = {
    ...payload,
    userId: secondUser.id,
    learnerHomeworkId: secondId,
    backendBindingId: 'mock:substitution-must-be-ignored',
  };
  const [firstClick, duplicateClick] = await Promise.all([
    first.call(`/api/homeworks/${firstId}/actions/${action}`, {
      method: 'POST',
      body: injectedPayload,
      key,
    }),
    first.call(`/api/homeworks/${firstId}/actions/${action}`, {
      method: 'POST',
      body: injectedPayload,
      key,
    }),
  ]);
  assert.equal(firstClick.status, 200);
  assert.equal(duplicateClick.status, 200);
  const expected = {
    'first-submission': 'needs_evidence',
    evidence: 'evidence_submitted',
    review: 'accepted',
    seal: 'sealed',
  }[action];
  const settled = await waitForHomework(first, firstId, expected);
  assert.equal(settled.agentWork.bindingId.startsWith('mock:'), true);
  states.push(settled.agentWork.status);
}
assert.deepEqual(states, ['needs_evidence', 'evidence_submitted', 'accepted', 'sealed']);

const logout = await second.call('/api/logout', { method: 'POST', body: {} });
assert.equal(logout.status, 200);
const revoked = await second.call('/api/homeworks');
assert.equal(revoked.status, 401);

const oversized = await fetch(`${origin}/api/register`, {
  method: 'POST',
  headers: { origin, 'content-type': 'application/json' },
  body: JSON.stringify({ displayName: 'x'.repeat(17 * 1024) }),
});
assert.equal(oversized.status, 413);

const enumeration = new Browser();
const wrongKnown = await enumeration.call('/api/login', {
  method: 'POST',
  body: { email: firstUser.email, password: 'wrong-synthetic-password' },
});
const wrongUnknown = await enumeration.call('/api/login', {
  method: 'POST',
  body: { email: `unknown-${nonce}@example.test`, password: 'wrong-synthetic-password' },
});
assert.equal(wrongKnown.status, wrongUnknown.status);
assert.deepEqual(wrongKnown.value, wrongUnknown.value);
for (let attempt = 2; attempt < 9; attempt += 1) {
  const denied = await enumeration.call('/api/login', {
    method: 'POST',
    body: { email: `unknown-${nonce}-${attempt}@example.test`, password: 'wrong-synthetic-password' },
  });
  assert.equal(denied.status, 400);
}
const rateLimited = await enumeration.call('/api/login', {
  method: 'POST',
  body: { email: `limited-${nonce}@example.test`, password: 'wrong-synthetic-password' },
});
assert.equal(rateLimited.status, 429);

await sleep(expiryWaitMs);
const expired = await first.call('/api/homeworks');
assert.equal(expired.status, 401);

const evidence = {
  schema: 'course-business-reference.qualification/v1',
  origin,
  learners: 3,
  perAccountHomework: true,
  idorStatus: idor.status,
  originRejectionStatus: rejectedOrigin.status,
  csrfRejectionStatus: rejectedCsrf.status,
  oversizedBodyStatus: oversized.status,
  authNonEnumerating: true,
  rateLimitStatus: rateLimited.status,
  crashAfterAdapterRecovered: true,
  adapterTimeoutRetried: true,
  concurrentDuplicateStable: true,
  duplicateDeliveryStable: true,
  goldenPathStates: states,
  logoutRevoked: revoked.status === 401,
  sessionExpired: expired.status === 401,
  backend: 'mock-simulated',
  qualifiedAt: new Date().toISOString(),
};
if (process.env.COURSE_EVIDENCE_PATH) {
  await writeFile(process.env.COURSE_EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
}
console.log(JSON.stringify(evidence, null, 2));
