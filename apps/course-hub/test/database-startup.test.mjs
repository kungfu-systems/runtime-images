// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isTransientDatabaseStartupError,
  retryDatabaseStartup,
} from '../src/db.mjs';

test('database startup retries transient Docker DNS errors and then succeeds', async () => {
  const delays = [];
  const messages = [];
  let attempts = 0;
  const result = await retryDatabaseStartup(
    async () => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error('temporary DNS failure'), { code: 'EAI_AGAIN' });
      return 'connected';
    },
    {
      maxAttempts: 4,
      initialDelayMs: 10,
      maxDelayMs: 20,
      sleep: async (delay) => delays.push(delay),
      log: (message) => messages.push(message),
      label: 'test database',
    },
  );

  assert.equal(result, 'connected');
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [10, 20]);
  assert.equal(messages.length, 2);
  assert.match(messages[0], /EAI_AGAIN.*1\/4.*10ms/u);
});

test('database startup fails immediately for authentication and migration errors', async () => {
  for (const code of ['28P01', '42501']) {
    let attempts = 0;
    const error = Object.assign(new Error(`database error ${code}`), { code });
    await assert.rejects(
      retryDatabaseStartup(
        async () => {
          attempts += 1;
          throw error;
        },
        { sleep: async () => assert.fail('non-transient errors must not sleep') },
      ),
      (observed) => observed === error,
    );
    assert.equal(attempts, 1);
  }
});

test('database startup preserves the final transient failure after the retry bound', async () => {
  let attempts = 0;
  const error = Object.assign(new Error('database is starting'), { code: '57P03' });
  await assert.rejects(
    retryDatabaseStartup(
      async () => {
        attempts += 1;
        throw error;
      },
      {
        maxAttempts: 3,
        initialDelayMs: 1,
        sleep: async () => {},
        log: () => {},
      },
    ),
    (observed) => observed === error,
  );
  assert.equal(attempts, 3);
});

test('transient database startup classification is intentionally narrow', () => {
  for (const code of [
    'EAI_AGAIN',
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ETIMEDOUT',
    '57P03',
  ]) {
    assert.equal(isTransientDatabaseStartupError({ code }), true, code);
  }
  assert.equal(isTransientDatabaseStartupError({ code: '28P01' }), false);
  assert.equal(isTransientDatabaseStartupError(new Error('unknown')), false);
});
