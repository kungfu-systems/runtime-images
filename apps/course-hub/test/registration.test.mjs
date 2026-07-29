// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { mapRegistrationError, registrationLogReason } from '../src/domain.mjs';

test('duplicate registration returns an actionable public conflict', () => {
  const error = mapRegistrationError(Object.assign(new Error('duplicate key'), {
    code: '23505',
  }));

  assert.equal(error.status, 409);
  assert.equal(error.publicCode, 'email_exists');
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

test('registration input failures return bounded actionable messages', () => {
  const cases = [
    ['invalid email', 'email_invalid', 'Enter a valid email address.'],
    [
      'password must be 12-128 UTF-8 bytes',
      'password_invalid',
      'Use a password between 12 and 128 UTF-8 bytes.',
    ],
    [
      'invalid registration',
      'display_name_invalid',
      'Enter a name between 1 and 80 characters.',
    ],
  ];

  for (const [message, publicCode, publicMessage] of cases) {
    const error = mapRegistrationError(new Error(message));
    assert.equal(error.status, 400);
    assert.equal(error.publicCode, publicCode);
    assert.equal(error.publicMessage, publicMessage);
  }
});

test('registration logging exposes only bounded public reason codes', () => {
  assert.equal(
    registrationLogReason({ publicCode: 'password_invalid', message: 'private input' }),
    'password_invalid',
  );
  assert.equal(
    registrationLogReason({ publicCode: 'email=user@example.invalid', message: 'private input' }),
    'unclassified',
  );
  assert.equal(
    registrationLogReason({ message: 'database failed for user@example.invalid' }),
    'unclassified',
  );
});
