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
  const model = {
    id: 'synthetic',
    label: 'Synthetic',
    capability: 'Test',
    guidance: 'Test model only.',
    memoryBytes: 64,
    file: 'model.gguf',
    model: 'synthetic-model',
    revision: 'test-revision',
    source: 'test/source',
    url: 'https://models.invalid/model.gguf',
    sha256: createHash('sha256').update(content).digest('hex'),
    bytes: content.length,
  };
  const config = {
    enabled: true,
    modelsRoot: directory,
    catalog: [model],
  };
  const manager = new LocalModelManager(config, async () => new Response(content, {
    status: 200,
    headers: { 'content-length': String(content.length) },
  }));
  try {
    await manager.initialize();
    assert.equal(manager.publicStatus().models[0].state, 'not-installed');
    assert.rejects(readFile(path), { code: 'ENOENT' });
    await manager.install(model.id);
    while (['downloading', 'verifying'].includes(manager.publicStatus().models[0].state)) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(manager.publicStatus().models[0].state, 'installed');
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
  const model = {
    id: 'synthetic-bad',
    label: 'Synthetic bad',
    capability: 'Test',
    guidance: 'Test model only.',
    memoryBytes: 64,
    file: 'model.gguf',
    model: 'synthetic-bad',
    revision: 'test-revision',
    source: 'test/source',
    url: 'https://models.invalid/model.gguf',
    sha256: 'a'.repeat(64),
    bytes: content.length,
  };
  const manager = new LocalModelManager({
    enabled: true,
    modelsRoot: directory,
    catalog: [model],
  }, async () => new Response(content, {
    status: 200,
    headers: { 'content-length': String(content.length) },
  }));
  try {
    await manager.initialize();
    await manager.install(model.id);
    while (['downloading', 'verifying'].includes(manager.publicStatus().models[0].state)) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(manager.publicStatus().models[0].state, 'error');
    assert.rejects(readFile(path), { code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true });
  }
});
