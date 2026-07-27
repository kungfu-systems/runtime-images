// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUuid } from '../web/random-uuid.js';

test('browser UUID uses the native secure-context implementation when available', () => {
  const expected = '019fa134-09f9-7ac0-b996-044baae1c45b';
  assert.equal(randomUuid({ randomUUID: () => expected }), expected);
});

test('browser UUID falls back to secure random bytes on plain LAN HTTP', () => {
  const cryptoApi = {
    getRandomValues(bytes) {
      bytes.set(Array.from({ length: 16 }, (_, index) => index));
      return bytes;
    },
  };

  assert.equal(randomUuid(cryptoApi), '00010203-0405-4607-8809-0a0b0c0d0e0f');
});

test('browser UUID fails closed without a secure random source', () => {
  assert.throws(
    () => randomUuid({}),
    /Secure random source unavailable/u,
  );
});
