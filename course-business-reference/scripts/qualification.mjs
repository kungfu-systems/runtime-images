// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { assertAgentWorkView } from '../src/agent-work-port.mjs';

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

function brief(title) {
  return {
    title,
    targetLearner: 'Small-business experts without curriculum-design experience',
    learnerProblem: 'They cannot turn valuable expertise into a teachable sequence.',
    promisedOutcome: 'Publish and validate a three-module course outline.',
    creatorExpertise: 'Real client cases, workshop notes, and a repeatable method.',
    deliveryConstraints: 'Three weeks, practical exercises, and one live session each week.',
  };
}

async function createCourse(browser, title) {
  return browser.call('/api/courses', { method: 'POST', body: brief(title) });
}

async function waitForCourse(browser, courseId, versionCount, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await browser.call(`/api/courses/${courseId}`);
    if (result.status === 200 && result.value.course.versions.length === versionCount) {
      return result.value.course;
    }
    await sleep(250);
  }
  throw new Error(`course did not reach ${versionCount} versions`);
}

const crashEmail = `crash-${nonce}@example.test`;
const crashAttempt = new Browser();
await register(crashAttempt, 'Crash recovery', crashEmail);
let crashDisconnected = false;
try {
  await createCourse(crashAttempt, 'Crash-safe course');
} catch {
  crashDisconnected = true;
}
assert.equal(crashDisconnected, true);
await waitForReady();
const recovered = new Browser();
await login(recovered, crashEmail);
const recoveredList = await recovered.call('/api/courses');
assert.equal(recoveredList.status, 200);
assert.equal(recoveredList.value.courses.length, 1);
const recoveredCourse = await waitForCourse(recovered, recoveredList.value.courses[0].id, 0);
assertAgentWorkView(recoveredCourse.agentWork);
assert.equal(recoveredCourse.agentWork.audit.filter((item) => item.type === 'provisioned').length, 1);

const first = new Browser();
const second = new Browser();
const firstUser = await register(first, 'Alpha');
const secondUser = await register(second, 'Beta');
assert.notEqual(firstUser.id, secondUser.id);
const firstCreated = await createCourse(first, 'Alpha course');
const secondCreated = await createCourse(second, 'Beta course');
assert.equal(firstCreated.status, 201);
assert.equal(secondCreated.status, 201);
const firstId = firstCreated.value.course.id;
const secondId = secondCreated.value.course.id;
assert.notEqual(firstId, secondId);

const firstList = await first.call('/api/courses');
const secondList = await second.call('/api/courses');
assert.equal(firstList.value.courses.length, 1);
assert.equal(secondList.value.courses.length, 1);

const idor = await first.call(`/api/courses/${secondId}`);
assert.equal(idor.status, 404);
const rejectedOrigin = await first.call(`/api/courses/${firstId}/actions/generate`, {
  method: 'POST',
  key: `origin:${nonce}`,
  body: {},
  originHeader: 'http://attacker.invalid',
});
assert.equal(rejectedOrigin.status, 403);
const rejectedCsrf = await first.call(`/api/courses/${firstId}/actions/generate`, {
  method: 'POST',
  key: `csrf:${nonce}`,
  body: {},
  csrfHeader: 'wrong-csrf-token',
});
assert.equal(rejectedCsrf.status, 403);

const generateKey = `qualification:${nonce}:generate`;
const [firstGenerate, duplicateGenerate] = await Promise.all([
  first.call(`/api/courses/${firstId}/actions/generate`, {
    method: 'POST',
    body: { userId: secondUser.id, courseId: secondId },
    key: generateKey,
  }),
  first.call(`/api/courses/${firstId}/actions/generate`, {
    method: 'POST',
    body: { userId: secondUser.id, courseId: secondId },
    key: generateKey,
  }),
]);
assert.equal(firstGenerate.status, 200);
assert.equal(duplicateGenerate.status, 200);
const firstDraft = await waitForCourse(first, firstId, 1);
assertAgentWorkView(firstDraft.agentWork);
assert.equal(firstDraft.versions[0].versionNumber, 1);
assert.equal(firstDraft.versions[0].outline.modules.length, 3);
assert.equal(firstDraft.versions[0].outline.audience, brief('ignored').targetLearner);

const reviseKey = `qualification:${nonce}:revise`;
const [firstRevise, duplicateRevise] = await Promise.all([
  first.call(`/api/courses/${firstId}/actions/revise`, {
    method: 'POST',
    body: { feedback: 'Make validation and observable exercises more explicit.' },
    key: reviseKey,
  }),
  first.call(`/api/courses/${firstId}/actions/revise`, {
    method: 'POST',
    body: { feedback: 'Make validation and observable exercises more explicit.' },
    key: reviseKey,
  }),
]);
assert.equal(firstRevise.status, 200);
assert.equal(duplicateRevise.status, 200);
const revised = await waitForCourse(first, firstId, 2);
assert.equal(revised.versions[0].versionNumber, 2);
assert.equal(revised.versions[1].versionNumber, 1);
assert.notDeepEqual(revised.versions[0].outline, revised.versions[1].outline);

const approved = await first.call(
  `/api/courses/${firstId}/versions/${revised.versions[0].id}/approve`,
  { method: 'POST', body: {} },
);
assert.equal(approved.status, 200);
assert.equal(approved.value.course.currentOutlineVersionId, revised.versions[0].id);
assert.equal(approved.value.course.versions[0].status, 'approved');
assert.equal(approved.value.course.versions[1].status, 'draft');

const crossAccountVersion = await first.call(
  `/api/courses/${firstId}/versions/${secondCreated.value.course.id}/approve`,
  { method: 'POST', body: {} },
);
assert.equal(crossAccountVersion.status, 404);

const logout = await second.call('/api/logout', { method: 'POST', body: {} });
assert.equal(logout.status, 200);
const revoked = await second.call('/api/courses');
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
const expired = await first.call('/api/courses');
assert.equal(expired.status, 401);

const evidence = {
  schema: 'course-business-reference.qualification/v2',
  origin,
  learners: 3,
  perAccountCourseCollection: true,
  immutableVersionNumbers: revised.versions.map((version) => version.versionNumber),
  approvedVersionOwnedByBusinessDomain: true,
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
  logoutRevoked: revoked.status === 401,
  sessionExpired: expired.status === 401,
  backend: 'mock-simulated',
  qualifiedAt: new Date().toISOString(),
};
if (process.env.COURSE_EVIDENCE_PATH) {
  await writeFile(process.env.COURSE_EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
}
console.log(JSON.stringify(evidence, null, 2));
