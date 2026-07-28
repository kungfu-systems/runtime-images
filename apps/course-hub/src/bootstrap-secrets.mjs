// SPDX-License-Identifier: Apache-2.0
import {
  chmodSync,
  closeSync,
  constants,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SECRET_NAMES = Object.freeze([
  'database-migration-password',
  'database-app-password',
]);

function safeRoot(value) {
  const root = value?.trim() || '/install-config';
  if (!/^\/[A-Za-z0-9._/-]+$/u.test(root) || root.includes('..')) {
    throw new Error('COURSE_INSTALL_CONFIG_ROOT must be an absolute safe path');
  }
  return root.replace(/\/+$/u, '') || '/';
}

function validateSecret(value, path) {
  const secret = value.trim();
  if (!/^[0-9a-f]{64}$/u.test(secret)) {
    throw new Error(`${path} must contain exactly 64 lowercase hexadecimal characters`);
  }
  return secret;
}

function installSecret(path) {
  try {
    return { value: validateSecret(readFileSync(path, 'utf8'), path), created: false };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const value = randomBytes(32).toString('hex');
  const temporary = `${path}.new-${process.pid}-${randomBytes(8).toString('hex')}`;
  let descriptor;
  try {
    descriptor = openSync(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o400,
    );
    writeFileSync(descriptor, `${value}\n`, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporary, 0o444);
    try {
      linkSync(temporary, path);
      return { value, created: true };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      return { value: validateSecret(readFileSync(path, 'utf8'), path), created: false };
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      unlinkSync(temporary);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

export function bootstrapInstallSecrets(rootValue = process.env.COURSE_INSTALL_CONFIG_ROOT) {
  const root = safeRoot(rootValue);
  mkdirSync(root, { recursive: true, mode: 0o755 });
  chmodSync(root, 0o755);
  const results = Object.fromEntries(
    SECRET_NAMES.map((name) => [name, installSecret(`${root}/${name}`)]),
  );
  return Object.freeze({
    root,
    results: Object.freeze(Object.fromEntries(
      Object.entries(results).map(([name, result]) => [
        name,
        Object.freeze({ path: `${root}/${name}`, created: result.created }),
      ]),
    )),
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = bootstrapInstallSecrets();
  for (const [name, metadata] of Object.entries(result.results)) {
    console.log(`${name}: ${metadata.created ? 'created' : 'reused'}`);
  }
}
