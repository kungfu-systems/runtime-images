// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { mapRegistrationError } from '../src/domain.mjs';

test('duplicate registration returns an actionable public conflict', () => {
  const error = mapRegistrationError(Object.assign(new Error('duplicate key'), {
    code: '23505',
  }));

  assert.equal(error.status, 409);
  assert.equal(
    error.publicMessage,
    'A workspace already exists for this email. Log in instead.',
  );
  assert.equal(error.message, 'email is already registered');
});

test('registration preserves unrelated database failures', () => {
  const error = Object.assign(new Error('database unavailable'), { code: '08006' });
  assert.equal(mapRegistrationError(error), error);
});
