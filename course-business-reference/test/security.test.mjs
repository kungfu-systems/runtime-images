// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PASSWORD_PARAMETERS,
  hashPassword,
  normalizeEmail,
  randomToken,
  tokenHash,
  verifyPassword,
} from '../src/security.mjs';

test('email identity is normalized and bounded', () => {
  assert.equal(normalizeEmail('  Learner@Example.COM '), 'learner@example.com');
  assert.throws(() => normalizeEmail('not-an-email'));
});

test('scrypt credentials use random salts and constant-length hashes', async () => {
  const first = await hashPassword('correct horse battery staple');
  const second = await hashPassword('correct horse battery staple');
  assert.equal(first.parameters.algorithm, 'scrypt');
  assert.equal(first.parameters.N, PASSWORD_PARAMETERS.N);
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
  assert.equal(await verifyPassword('correct horse battery staple', first.salt, first.hash, first.parameters), true);
  assert.equal(await verifyPassword('wrong password value', first.salt, first.hash, first.parameters), false);
});

test('opaque session tokens are high entropy and only hashes are persisted', () => {
  const token = randomToken(32);
  assert.ok(token.length >= 43);
  assert.match(tokenHash(token), /^[0-9a-f]{64}$/u);
  assert.notEqual(tokenHash(token), token);
});
