// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  createReadStream,
  createWriteStream,
} from 'node:fs';
import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MODEL_CATALOG_SCHEMA } from './model-catalog.mjs';

const publicModel = (model, state, active) => ({
  id: model.id,
  label: model.label,
  capability: model.capability,
  guidance: model.guidance,
  bytes: model.bytes,
  memoryBytes: model.memoryBytes,
  source: model.source,
  revision: model.revision,
  state: state.state,
  downloadedBytes: state.bytes,
  progress: model.bytes ? Math.min(100, Math.floor((state.bytes / model.bytes) * 100)) : 0,
  error: state.error,
  active,
});

async function digestFile(path) {
  const hash = createHash('sha256');
  await pipeline(
    createReadStream(path),
    new Writable({
      write(chunk, _encoding, callback) {
        hash.update(chunk);
        callback();
      },
    }),
  );
  return hash.digest('hex');
}

async function removeIfPresent(path) {
  await unlink(path).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class LocalModelManager {
  constructor(config, fetchImplementation = fetch, spawnImplementation = spawn) {
    this.config = config;
    this.fetch = fetchImplementation;
    this.spawn = spawnImplementation;
    this.states = new Map((config.catalog ?? []).map((model) => [
      model.id,
      { state: config.enabled ? 'checking' : 'unavailable', bytes: 0, error: '' },
    ]));
    this.installs = new Map();
    this.activeId = '';
    this.server = null;
    this.serverError = '';
    this.activationPromise = null;
  }

  path(model) {
    return join(this.config.modelsRoot, model.file);
  }

  activeMarkerPath() {
    return join(this.config.modelsRoot, '.active-model.json');
  }

  model(id) {
    const model = this.config.catalog.find((candidate) => candidate.id === id);
    if (!model) throw Object.assign(new Error('unknown local model'), { status: 404 });
    return model;
  }

  async initialize() {
    if (!this.config.enabled) return;
    await mkdir(this.config.modelsRoot, { recursive: true });
    for (const model of this.config.catalog) {
      const path = this.path(model);
      try {
        const file = await stat(path);
        if (file.size !== model.bytes || await digestFile(path) !== model.sha256) {
          this.states.set(model.id, {
            state: 'error',
            bytes: file.size,
            error: 'Installed bytes do not match the pinned model manifest.',
          });
          continue;
        }
        this.states.set(model.id, { state: 'installed', bytes: file.size, error: '' });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const partial = await stat(`${path}.part`).catch(() => null);
        this.states.set(model.id, {
          state: 'not-installed',
          bytes: Math.min(partial?.size ?? 0, model.bytes),
          error: '',
        });
      }
    }
    try {
      const marker = JSON.parse(await readFile(this.activeMarkerPath(), 'utf8'));
      if (marker.schema !== 'course.local-model-activation/v1') {
        throw new Error('activation marker schema is unsupported');
      }
      if (this.states.get(marker.modelId)?.state !== 'installed') {
        throw new Error('activation marker does not identify a verified installed model');
      }
      await this.activate(marker.modelId);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.serverError = `Saved local model could not be activated: ${error.message}`;
      }
    }
  }

  publicStatus() {
    return {
      schema: MODEL_CATALOG_SCHEMA,
      enabled: this.config.enabled,
      activeModelId: this.activeId,
      serverState: this.server ? 'ready' : this.activeId ? 'error' : 'stopped',
      serverError: this.serverError,
      models: this.config.catalog.map((model) =>
        publicModel(model, this.states.get(model.id), model.id === this.activeId)),
    };
  }

  activeConfig(base) {
    if (!this.activeId || !this.server) {
      throw new Error('no verified local model is active');
    }
    const model = this.model(this.activeId);
    return {
      ...base,
      model: model.model,
      label: `${model.label} Course Designer`,
      provider: `Local ${model.label}`,
    };
  }

  async install(id) {
    if (!this.config.enabled) throw new Error('local model installation is unavailable');
    const model = this.model(id);
    if (this.states.get(id).state === 'installed') return this.publicStatus();
    if (this.installs.has(id)) return this.publicStatus();
    const current = this.states.get(id);
    this.states.set(id, {
      state: 'downloading',
      bytes: current?.bytes ?? 0,
      error: '',
    });
    const promise = this.runInstall(model).finally(() => this.installs.delete(id));
    this.installs.set(id, promise);
    promise.catch((error) => console.error(`[local-model] ${id} installation failed:`, error.message));
    return this.publicStatus();
  }

  async source(model, offset) {
    if (this.config.seedRoot) {
      const path = join(this.config.seedRoot, model.file);
      const file = await stat(path);
      return {
        body: createReadStream(path, { start: offset }),
        totalBytes: file.size,
        resumed: offset > 0,
      };
    }
    const headers = { 'user-agent': 'kungfu-course-hub/1' };
    if (offset > 0) headers.range = `bytes=${offset}-`;
    const response = await this.fetch(model.url, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(30 * 60_000),
    });
    if (!response.ok || !response.body) {
      throw new Error(`model source returned ${response.status}`);
    }
    const resumed = offset > 0 && response.status === 206;
    const remainingBytes = Number(response.headers.get('content-length'));
    if (!Number.isSafeInteger(remainingBytes) || remainingBytes < 0) {
      throw new Error('model source did not provide a valid content length');
    }
    return {
      body: response.body,
      totalBytes: remainingBytes + (resumed ? offset : 0),
      resumed,
    };
  }

  async runInstall(model) {
    const path = this.path(model);
    const partial = `${path}.part`;
    let offset = Math.min((await stat(partial).catch(() => null))?.size ?? 0, model.bytes);
    this.states.set(model.id, { state: 'downloading', bytes: offset, error: '' });
    try {
      let source = await this.source(model, offset);
      if (offset > 0 && !source.resumed) {
        await removeIfPresent(partial);
        offset = 0;
        this.states.set(model.id, { state: 'downloading', bytes: 0, error: '' });
        source = await this.source(model, 0);
      }
      if (source.totalBytes !== model.bytes) {
        throw new Error('model source size does not match the pinned manifest');
      }
      const hash = createHash('sha256');
      if (offset > 0) {
        await pipeline(
          createReadStream(partial),
          new Writable({
            write(chunk, _encoding, callback) {
              hash.update(chunk);
              callback();
            },
          }),
        );
      }
      const state = this.states.get(model.id);
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          hash.update(chunk);
          state.bytes += chunk.length;
          callback(null, chunk);
        },
      });
      await pipeline(
        source.body,
        meter,
        createWriteStream(partial, { flags: offset ? 'a' : 'w', mode: 0o644 }),
      );
      state.state = 'verifying';
      if (state.bytes !== model.bytes || hash.digest('hex') !== model.sha256) {
        throw new Error('model download failed checksum verification');
      }
      await rename(partial, path);
      this.states.set(model.id, { state: 'installed', bytes: model.bytes, error: '' });
    } catch (error) {
      const bytes = (await stat(partial).catch(() => null))?.size ?? 0;
      this.states.set(model.id, {
        state: 'error',
        bytes,
        error: 'Download stopped or verification failed. Retry resumes verified source bytes when supported.',
      });
      throw error;
    }
  }

  async activate(id) {
    if (this.activationPromise) return this.activationPromise;
    this.activationPromise = this.runActivate(id).finally(() => {
      this.activationPromise = null;
    });
    return this.activationPromise;
  }

  async runActivate(id) {
    const model = this.model(id);
    if (this.states.get(id).state !== 'installed') {
      throw Object.assign(new Error('install and verify the model before activation'), { status: 409 });
    }
    await this.stop();
    this.activeId = id;
    this.serverError = '';
    const child = this.spawn(this.config.llamaBin, [
      '--model', this.path(model),
      '--alias', model.model,
      '--host', this.config.serverHost,
      '--port', String(this.config.serverPort),
      '--ctx-size', '4096',
      '--parallel', '1',
      '--jinja',
      '--reasoning', 'off',
      '--chat-template-kwargs', '{"enable_thinking":false}',
    ], {
      env: { ...process.env, LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH ?? '/opt/llama' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-8_192);
    });
    child.once('exit', (code) => {
      if (this.server === child) {
        this.server = null;
        this.serverError = `llama.cpp exited with code ${code}: ${stderr.slice(-500)}`;
      }
    });
    this.server = child;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      if (!this.server) break;
      const ready = await this.fetch(
        `http://${this.config.serverHost}:${this.config.serverPort}/health`,
        { signal: AbortSignal.timeout(1_000) },
      ).then((response) => response.ok, () => false);
      if (ready) {
        const marker = `${this.activeMarkerPath()}.${process.pid}.tmp`;
        await writeFile(marker, `${JSON.stringify({
          schema: 'course.local-model-activation/v1',
          modelId: id,
        })}\n`, { mode: 0o600 });
        await rename(marker, this.activeMarkerPath());
        return this.publicStatus();
      }
      await wait(1_000);
    }
    await this.stop();
    throw new Error(this.serverError || 'local inference server did not become ready');
  }

  async stop() {
    const child = this.server;
    this.server = null;
    if (!child) return;
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      wait(5_000).then(() => child.kill('SIGKILL')),
    ]);
  }
}
