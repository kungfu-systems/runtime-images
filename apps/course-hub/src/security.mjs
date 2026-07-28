// SPDX-License-Identifier: Apache-2.0
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
export const PASSWORD_PARAMETERS = Object.freeze({
  algorithm: 'scrypt',
  N: 32768,
  r: 8,
  p: 1,
  keyLength: 32,
});

export function normalizeEmail(value) {
  const email = String(value ?? '').trim().normalize('NFKC').toLowerCase();
  if (email.length < 3 || email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(email)) {
    throw new Error('invalid email');
  }
  return email;
}

export function validatePassword(value) {
  const password = String(value ?? '');
  const bytes = Buffer.byteLength(password, 'utf8');
  if (bytes < 12 || bytes > 128) throw new Error('password must be 12-128 UTF-8 bytes');
  return password;
}

export async function hashPassword(password) {
  const checked = validatePassword(password);
  const salt = randomBytes(16);
  const key = await scrypt(checked, salt, PASSWORD_PARAMETERS.keyLength, {
    N: PASSWORD_PARAMETERS.N,
    r: PASSWORD_PARAMETERS.r,
    p: PASSWORD_PARAMETERS.p,
    maxmem: 64 * 1024 * 1024,
  });
  return {
    salt: salt.toString('base64'),
    hash: Buffer.from(key).toString('base64'),
    parameters: PASSWORD_PARAMETERS,
  };
}

export async function verifyPassword(password, saltText, hashText, parameters) {
  const candidate = String(password ?? '');
  const expected = Buffer.from(hashText, 'base64');
  const salt = Buffer.from(saltText, 'base64');
  const key = await scrypt(candidate, salt, parameters.keyLength, {
    N: parameters.N,
    r: parameters.r,
    p: parameters.p,
    maxmem: 64 * 1024 * 1024,
  });
  return expected.length === key.length && timingSafeEqual(expected, key);
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const tokenHash = (token) => createHash('sha256').update(token).digest('hex');

export function createRateLimiter({ limit = 10, windowMs = 5 * 60_000 } = {}) {
  const buckets = new Map();
  return (key) => {
    const now = Date.now();
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    current.count += 1;
    return current.count <= limit;
  };
}
