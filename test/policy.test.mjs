// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { validateComposeText, validateImageReference } from '../src/policy.mjs';
import { HubStarterClient } from '../src/client.mjs';
import { projectCoursework } from '../src/runtime.mjs';

const compose = await readFile(new URL('../compose.yaml', import.meta.url), 'utf8');

test('compose preserves the localhost, non-root, read-only boundary', () => {
  assert.equal(validateComposeText(compose), true);
});

test('policy rejects a host-disconnected network for the localhost Web service', () => {
  const candidate = compose.replace('driver: bridge', 'internal: true');
  assert.throws(() => validateComposeText(candidate), /host-disconnected/u);
});

for (const [name, mutation, expected] of [
  ['privileged', '\n    privileged: true', /privileged/u],
  ['host network', '\n    network_mode: host', /host networking/u],
  ['Docker socket', '\n      - /var/run/docker.sock:/var/run/docker.sock', /Docker socket/u],
  ['capability addition', '\n    cap_add: [SYS_ADMIN]', /capability/u],
  ['public ingress', '0.0.0.0:${HUB_PORT', /non-loopback/u],
  ['root user', '\n    user: root', /root runtime/u],
]) {
  test(`policy rejects ${name}`, () => {
    const candidate = name === 'public ingress'
      ? compose.replace('${HUB_BIND_ADDRESS:-127.0.0.1}:${HUB_PORT', mutation)
      : compose.replace('    restart: unless-stopped', `    restart: unless-stopped${mutation}`);
    assert.throws(() => validateComposeText(candidate), expected);
  });
}

test('image references reject tags, missing digests, and uppercase material', () => {
  assert.throws(() => validateImageReference('ghcr.io/kungfu/hub:latest'));
  assert.throws(() => validateImageReference('ghcr.io/Kungfu/hub@sha256:' + 'a'.repeat(64)));
  assert.equal(
    validateImageReference('ghcr.io/kungfu-systems/runtime-images/hub-starter@sha256:' + 'a'.repeat(64)),
    'ghcr.io/kungfu-systems/runtime-images/hub-starter@sha256:' + 'a'.repeat(64),
  );
});

test('Node client stays a bounded HTTP adapter', async () => {
  const calls = [];
  const client = new HubStarterClient({
    baseUrl: 'http://127.0.0.1:9999/',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  assert.deepEqual(await client.state(), { ok: true });
  assert.deepEqual(await client.submitClaim(), { ok: true });
  assert.deepEqual(await client.submitEvidence(), { ok: true });
  assert.deepEqual(await client.settleDemo(), { ok: true });
  assert.deepEqual(calls.map((row) => [row.url, row.init.method || 'GET']), [
    ['http://127.0.0.1:9999/api/state', 'GET'],
    ['http://127.0.0.1:9999/api/coursework/claim', 'POST'],
    ['http://127.0.0.1:9999/api/coursework/evidence', 'POST'],
    ['http://127.0.0.1:9999/api/settle', 'POST'],
  ]);
});

test('coursework projection distinguishes claim, evidence request, and accepted re-review', () => {
  const status = {
    assignment_id: 'homework-1',
    phase: 'continuation-decided',
    query_proof_root: `sha256:${'a'.repeat(64)}`,
    assignment: { work_definition: { title: 'Agent/Kungfu Course' } },
    completion_claims: [
      { claim_id: 'claim-1', statement: 'Done', evidence_episodes: [] },
    ],
    independent_reviews: [
      { review_id: 'review-1', claim_id: 'claim-1', verdict: 'insufficient' },
    ],
    continuation_decisions: [
      { decision_id: 'decision-1', review_id: 'review-1', action: 'request-evidence' },
    ],
  };
  const first = projectCoursework(status);
  assert.equal(first.outcome.state, 'needs-evidence');
  assert.equal(first.evidence.state, 'missing');
  assert.equal(first.primaryAction.id, 'add-evidence');

  status.completion_claims.push({
    claim_id: 'claim-2',
    statement: 'Done with evidence',
    evidence_episodes: [{ episode_id: '42' }],
  });
  status.independent_reviews.push({ review_id: 'review-2', claim_id: 'claim-2', verdict: 'fit' });
  status.continuation_decisions.push({ decision_id: 'decision-2', review_id: 'review-2', action: 'close' });
  const second = projectCoursework(status, {
    title: 'Course outline',
    sections: [{ objective: 'A' }, { objective: 'B' }, { objective: 'C' }],
    artifactRoot: `sha256:${'b'.repeat(64)}`,
  }, { stateRoot: `sha256:${'c'.repeat(64)}` });
  assert.equal(second.outcome.state, 'accepted');
  assert.equal(second.evidence.state, 'satisfied');
  assert.equal(second.submission.round, 2);
  assert.equal(second.primaryAction, null);
  assert.deepEqual(second.audit.evidenceEpisodeIds, ['42']);
});
