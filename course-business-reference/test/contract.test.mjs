// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_WORK_CONTRACT,
  COMMANDS,
  assertAgentWorkView,
  assertCommand,
} from '../src/agent-work-port.mjs';

test('AgentWorkPort v2 exposes bounded outline generation plus the legacy migration path', () => {
  assert.equal(AGENT_WORK_CONTRACT, 'course.agent-work-port/v2');
  assert.deepEqual([...COMMANDS], [
    'provision',
    'generate_outline',
    'revise_outline',
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

test('AgentWorkPort validates the same read model used by the mock qualification', () => {
  const view = {
    contract: AGENT_WORK_CONTRACT,
    backend: 'mock-agent-work/v1',
    bindingId: 'mock:contract-test',
    transitionId: 'mock-transition:contract-test:1',
    status: 'ready',
    allowedActions: ['generate_outline'],
    nextAction: 'Generate the first visible course outline.',
    evidence: [],
    audit: [],
    simulated: true,
  };
  assert.equal(assertAgentWorkView(view), view);
  assert.throws(() => assertAgentWorkView({ ...view, status: 'real-seal' }));
  assert.throws(() => assertAgentWorkView({ ...view, allowedActions: ['provision'] }));
  assert.throws(() => assertAgentWorkView({ ...view, allowedActions: ['run-arbitrary-agent'] }));
});
