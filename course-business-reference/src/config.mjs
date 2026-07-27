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
  const qualificationRunId = process.env.COURSE_QUALIFICATION_RUN_ID?.trim() ?? '';
  if (qualificationRunId && !/^[A-Za-z0-9._-]{1,80}$/u.test(qualificationRunId)) {
    throw new Error('COURSE_QUALIFICATION_RUN_ID contains unsupported characters');
  }
  const qualificationTimeoutOnce = process.env.COURSE_QUALIFICATION_TIMEOUT_ONCE?.trim() ?? '';
  if (qualificationTimeoutOnce && ![
    'provision',
    'run_first_submission',
    'submit_evidence',
    'request_review',
    'seal',
  ].includes(qualificationTimeoutOnce)) {
    throw new Error('COURSE_QUALIFICATION_TIMEOUT_ONCE is not a supported command');
  }
  const qualificationCrashAfterAdapterOnce = boolean(
    'COURSE_QUALIFICATION_CRASH_AFTER_ADAPTER_ONCE',
  );
  if ((qualificationTimeoutOnce || qualificationCrashAfterAdapterOnce) && !qualificationRunId) {
    throw new Error('qualification fault injection requires COURSE_QUALIFICATION_RUN_ID');
  }
  const sessionHours = Number(process.env.SESSION_HOURS ?? 24);
  if (!Number.isFinite(sessionHours) || sessionHours <= 0 || sessionHours > 720) {
    throw new Error('SESSION_HOURS must be greater than 0 and at most 720');
  }
  const outboxProcessingStaleSeconds = Number(process.env.OUTBOX_PROCESSING_STALE_SECONDS ?? 30);
  if (
    !Number.isInteger(outboxProcessingStaleSeconds)
    || outboxProcessingStaleSeconds < 1
    || outboxProcessingStaleSeconds > 300
  ) {
    throw new Error('OUTBOX_PROCESSING_STALE_SECONDS must be an integer from 1 to 300');
  }
  return Object.freeze({
    port: Number(process.env.PORT ?? 8090),
    publicOrigin: new URL(origin).origin,
    databaseUrl: required('DATABASE_URL'),
    appDatabaseUrl: required('APP_DATABASE_URL'),
    appPassword,
    backend,
    sessionSecure: boolean('SESSION_SECURE'),
    sessionHours,
    outboxProcessingStaleSeconds,
    stateDir: process.env.STATE_DIR ?? '/state',
    qualificationRunId,
    qualificationTimeoutOnce,
    qualificationCrashAfterAdapterOnce,
  });
}
