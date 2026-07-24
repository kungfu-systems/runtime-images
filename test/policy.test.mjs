// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { validateComposeText, validateImageReference } from '../src/policy.mjs';
import { HubStarterClient } from '../src/client.mjs';

const compose = await readFile(new URL('../compose.yaml', import.meta.url), 'utf8');

test('compose preserves the localhost, non-root, read-only boundary', () => {
  assert.equal(validateComposeText(compose), true);
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
      ? compose.replace('127.0.0.1:${HUB_PORT', mutation)
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
  assert.deepEqual(await client.settleDemo(), { ok: true });
  assert.deepEqual(calls.map((row) => [row.url, row.init.method || 'GET']), [
    ['http://127.0.0.1:9999/api/state', 'GET'],
    ['http://127.0.0.1:9999/api/settle', 'POST'],
  ]);
});
