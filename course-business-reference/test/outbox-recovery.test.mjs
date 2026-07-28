// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { projectedStatusAfterDeliveryFailure } from '../src/outbox-recovery.mjs';

test('transient failures leave the current binding projection unchanged', () => {
  assert.equal(projectedStatusAfterDeliveryFailure({
    commandType: 'generate_outline',
    attempts: 4,
    backendBindingId: 'openai:synthetic',
  }), null);
});

test('final inference failures preserve a usable established binding', () => {
  for (const commandType of ['generate_outline', 'revise_outline']) {
    assert.equal(projectedStatusAfterDeliveryFailure({
      commandType,
      attempts: 5,
      backendBindingId: 'openai:synthetic',
    }), 'ready');
  }
});

test('final provision failures still fail closed', () => {
  assert.equal(projectedStatusAfterDeliveryFailure({
    commandType: 'provision',
    attempts: 5,
    backendBindingId: null,
  }), 'failed');
});
