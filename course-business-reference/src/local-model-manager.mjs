// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
} from 'node:fs';
import {
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

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

function progress(bytes, totalBytes) {
  if (!totalBytes) return 0;
  return Math.min(100, Math.floor((bytes / totalBytes) * 100));
}

export class LocalModelManager {
  constructor(config, fetchImplementation = fetch) {
    this.config = config;
    this.fetch = fetchImplementation;
    this.current = {
      state: config.enabled ? 'checking' : 'unavailable',
      bytes: 0,
      totalBytes: config.bytes ?? 0,
      error: '',
    };
    this.installPromise = null;
  }

  async initialize() {
    if (!this.config.enabled) return;
    try {
      const file = await stat(this.config.path);
      if (file.size !== this.config.bytes) {
        this.current = {
          ...this.current,
          state: 'error',
          bytes: file.size,
          error: 'The installed model has an unexpected size.',
        };
        return;
      }
      const sha256 = await digestFile(this.config.path);
      this.current = sha256 === this.config.sha256
        ? { ...this.current, state: 'installed', bytes: file.size, error: '' }
        : {
          ...this.current,
          state: 'error',
          bytes: file.size,
          error: 'The installed model failed checksum verification.',
        };
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.current = { ...this.current, state: 'not-installed', bytes: 0, error: '' };
        return;
      }
      throw error;
    }
  }

  publicStatus() {
    return {
      enabled: this.config.enabled,
      state: this.current.state,
      bytes: this.current.bytes,
      totalBytes: this.current.totalBytes,
      progress: progress(this.current.bytes, this.current.totalBytes),
      error: this.current.error,
      sourceLabel: this.config.sourceLabel ?? '',
    };
  }

  async source() {
    if (this.config.seedFile) {
      const file = await stat(this.config.seedFile);
      return {
        body: createReadStream(this.config.seedFile),
        totalBytes: file.size,
      };
    }
    const response = await this.fetch(this.config.url, {
      headers: { 'user-agent': 'kungfu-course-business-reference/1' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15 * 60_000),
    });
    if (!response.ok || !response.body) {
      throw new Error(`model source returned ${response.status}`);
    }
    return {
      body: response.body,
      totalBytes: Number(response.headers.get('content-length')) || this.config.bytes,
    };
  }

  async install() {
    if (!this.config.enabled) throw new Error('local model installation is unavailable');
    if (this.current.state === 'installed') return this.publicStatus();
    if (this.installPromise) return this.publicStatus();
    this.current = {
      ...this.current,
      state: 'downloading',
      bytes: 0,
      totalBytes: this.config.bytes,
      error: '',
    };
    this.installPromise = this.runInstall().finally(() => {
      this.installPromise = null;
    });
    this.installPromise.catch((error) => {
      console.error('[local-model] installation failed:', error.message);
    });
    return this.publicStatus();
  }

  async runInstall() {
    const partial = `${this.config.path}.part`;
    await removeIfPresent(partial);
    try {
      const source = await this.source();
      if (source.totalBytes !== this.config.bytes) {
        throw new Error('model source size does not match the pinned manifest');
      }
      const hash = createHash('sha256');
      const meter = new Transform({
        transform: (chunk, _encoding, callback) => {
          hash.update(chunk);
          this.current.bytes += chunk.length;
          callback(null, chunk);
        },
      });
      await pipeline(source.body, meter, createWriteStream(partial, { flags: 'wx', mode: 0o644 }));
      this.current.state = 'verifying';
      if (this.current.bytes !== this.config.bytes || hash.digest('hex') !== this.config.sha256) {
        throw new Error('model download failed checksum verification');
      }
      await rename(partial, this.config.path);
      this.current = {
        ...this.current,
        state: 'installed',
        bytes: this.config.bytes,
        error: '',
      };
    } catch (error) {
      await removeIfPresent(partial);
      this.current = {
        ...this.current,
        state: 'error',
        error: 'Model installation failed. Retry the verified download.',
      };
      throw error;
    }
  }
}
