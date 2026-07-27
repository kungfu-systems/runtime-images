// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { AGENT_WORK_CONTRACT, COMMANDS, assertCommand } from '../src/agent-work-port.mjs';

test('AgentWorkPort v1 exposes only the bounded course commands', () => {
  assert.equal(AGENT_WORK_CONTRACT, 'course.agent-work-port/v1');
  assert.deepEqual([...COMMANDS], [
    'provision',
    'run_first_submission',
    'submit_evidence',
    'request_review',
    'seal',
  ]);
});

test('AgentWorkPort fails closed on unknown contracts and commands', () => {
  const base = {
    contract: AGENT_WORK_CONTRACT,
    idempotencyKey: 'test:delivery:1',
    sourceIdentity: 'course-homework:test',
  };
  assert.doesNotThrow(() => assertCommand({ ...base, type: 'provision' }));
  assert.throws(() => assertCommand({ ...base, contract: 'other/v1', type: 'provision' }));
  assert.throws(() => assertCommand({ ...base, type: 'run-arbitrary-agent' }));
});
