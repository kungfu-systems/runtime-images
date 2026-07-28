// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { bootstrapInstallSecrets } from '../src/bootstrap-secrets.mjs';

test('install bootstrap creates private random secrets and reuses them', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'course-hub-bootstrap-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const first = bootstrapInstallSecrets(root);
  assert.equal(statSync(root).mode & 0o777, 0o755);
  const values = Object.values(first.results).map(({ path, created }) => {
    assert.equal(created, true);
    assert.equal(statSync(path).mode & 0o777, 0o444);
    const value = readFileSync(path, 'utf8').trim();
    assert.match(value, /^[0-9a-f]{64}$/u);
    return value;
  });
  assert.notEqual(values[0], values[1]);

  const second = bootstrapInstallSecrets(root);
  for (const metadata of Object.values(second.results)) {
    assert.equal(metadata.created, false);
  }
  assert.deepEqual(
    Object.values(second.results).map(({ path }) => readFileSync(path, 'utf8').trim()),
    values,
  );
});

test('install bootstrap fails closed instead of replacing malformed state', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'course-hub-bootstrap-invalid-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'database-migration-password'), 'not-a-secret\n', {
    mode: 0o444,
  });
  assert.throws(
    () => bootstrapInstallSecrets(root),
    /must contain exactly 64 lowercase hexadecimal characters/u,
  );
});
