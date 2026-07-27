// SPDX-License-Identifier: Apache-2.0

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const boolean = (name, fallback = false) => {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be true or false`);
};

export function loadConfig() {
  const backend = process.env.AGENT_WORK_BACKEND ?? 'mock';
  if (backend !== 'mock') throw new Error(`unsupported AGENT_WORK_BACKEND: ${backend}`);
  const appPassword = required('COURSE_DB_APP_PASSWORD');
  if (!/^[A-Za-z0-9._-]{16,128}$/u.test(appPassword)) {
    throw new Error('COURSE_DB_APP_PASSWORD must be 16-128 safe ASCII characters');
  }
  const origin = process.env.PUBLIC_ORIGIN ?? 'http://127.0.0.1:8090';
  return Object.freeze({
    port: Number(process.env.PORT ?? 8090),
    publicOrigin: new URL(origin).origin,
    databaseUrl: required('DATABASE_URL'),
    appDatabaseUrl: required('APP_DATABASE_URL'),
    appPassword,
    backend,
    sessionSecure: boolean('SESSION_SECURE'),
    sessionHours: Number(process.env.SESSION_HOURS ?? 24),
  });
}
