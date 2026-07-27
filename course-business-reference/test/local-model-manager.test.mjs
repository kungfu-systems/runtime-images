// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LocalModelManager } from '../src/local-model-manager.mjs';

test('local model remains absent until an explicit install and then verifies atomically', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'course-model-manager-'));
  const content = Buffer.from('synthetic pinned model bytes');
  const path = join(directory, 'model.gguf');
  const config = {
    enabled: true,
    path,
    url: 'https://models.invalid/model.gguf',
    sha256: createHash('sha256').update(content).digest('hex'),
    bytes: content.length,
    sourceLabel: 'Synthetic test source',
    seedFile: '',
  };
  const manager = new LocalModelManager(config, async () => new Response(content, {
    status: 200,
    headers: { 'content-length': String(content.length) },
  }));
  try {
    await manager.initialize();
    assert.equal(manager.publicStatus().state, 'not-installed');
    assert.rejects(readFile(path), { code: 'ENOENT' });
    await manager.install();
    while (['downloading', 'verifying'].includes(manager.publicStatus().state)) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(manager.publicStatus().state, 'installed');
    assert.deepEqual(await readFile(path), content);
    assert.rejects(readFile(`${path}.part`), { code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('local model refuses bytes that do not match the pinned checksum', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'course-model-manager-bad-'));
  const content = Buffer.from('wrong model bytes');
  const path = join(directory, 'model.gguf');
  const manager = new LocalModelManager({
    enabled: true,
    path,
    url: 'https://models.invalid/model.gguf',
    sha256: 'a'.repeat(64),
    bytes: content.length,
    sourceLabel: 'Synthetic test source',
    seedFile: '',
  }, async () => new Response(content, {
    status: 200,
    headers: { 'content-length': String(content.length) },
  }));
  try {
    await manager.initialize();
    await manager.install();
    while (['downloading', 'verifying'].includes(manager.publicStatus().state)) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(manager.publicStatus().state, 'error');
    assert.rejects(readFile(path), { code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true });
  }
});
