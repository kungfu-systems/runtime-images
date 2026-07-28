// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';

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

const integer = (name, fallback, minimum, maximum) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
};

const optionalSecret = (name, fileName) => {
  const inline = process.env[name]?.trim() ?? '';
  const path = process.env[fileName]?.trim() ?? '';
  if (inline && path) throw new Error(`${name} and ${fileName} cannot both be set`);
  if (!path) return inline;
  const value = readFileSync(path, 'utf8').trim();
  if (!value) throw new Error(`${fileName} points to an empty file`);
  return value;
};

function inferenceConfig(backend) {
  if (backend === 'mock') {
    return Object.freeze({
      kind: 'mock',
      label: 'Visible Mock Agent',
      provider: 'deterministic simulation',
      model: 'none',
      simulated: true,
      delivery: 'bundled',
    });
  }
  const baseUrl = new URL(required('AGENT_WORK_BASE_URL'));
  if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) {
    throw new Error('AGENT_WORK_BASE_URL must be an HTTP(S) URL without credentials');
  }
  if (baseUrl.search || baseUrl.hash) {
    throw new Error('AGENT_WORK_BASE_URL must not contain a query or fragment');
  }
  const model = required('AGENT_WORK_MODEL');
  if (model.length > 160) throw new Error('AGENT_WORK_MODEL is too long');
  const provider = process.env.AGENT_WORK_PROVIDER_LABEL?.trim() || 'OpenAI-compatible provider';
  if (provider.length > 80) throw new Error('AGENT_WORK_PROVIDER_LABEL is too long');
  const delivery = process.env.AGENT_WORK_DELIVERY?.trim() || 'external';
  if (!['hosted', 'local', 'external'].includes(delivery)) {
    throw new Error('AGENT_WORK_DELIVERY must be hosted, local, or external');
  }
  return Object.freeze({
    kind: backend,
    label: `${provider} Course Designer`,
    provider,
    model,
    simulated: false,
    delivery,
    baseUrl: baseUrl.toString().replace(/\/+$/u, ''),
    apiKey: optionalSecret('AGENT_WORK_API_KEY', 'AGENT_WORK_API_KEY_FILE'),
    timeoutMs: integer('AGENT_WORK_TIMEOUT_MS', 120_000, 5_000, 300_000),
  });
}

function localModelConfig(enabled, inferences) {
  if (!enabled) return Object.freeze({ enabled: false });
  const inference = inferences['openai-compatible'];
  if (!inference || inference.delivery !== 'local') {
    throw new Error('local model management requires a local OpenAI-compatible backend');
  }
  const path = required('COURSE_LOCAL_MODEL_PATH');
  if (!/^\/models\/[A-Za-z0-9._-]+\.gguf$/u.test(path)) {
    throw new Error('COURSE_LOCAL_MODEL_PATH must be a GGUF file directly under /models');
  }
  const url = new URL(required('COURSE_LOCAL_MODEL_URL'));
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('COURSE_LOCAL_MODEL_URL must be an HTTPS URL without credentials');
  }
  const sha256 = required('COURSE_LOCAL_MODEL_SHA256').toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(sha256)) {
    throw new Error('COURSE_LOCAL_MODEL_SHA256 must be a lowercase SHA-256 digest');
  }
  const bytes = integer('COURSE_LOCAL_MODEL_BYTES', 0, 1, 20 * 1024 * 1024 * 1024);
  const sourceLabel = process.env.COURSE_LOCAL_MODEL_SOURCE_LABEL?.trim() || 'Pinned model source';
  if (sourceLabel.length > 80) throw new Error('COURSE_LOCAL_MODEL_SOURCE_LABEL is too long');
  return Object.freeze({
    enabled: true,
    path,
    url: url.toString(),
    sha256,
    bytes,
    sourceLabel,
    seedFile: process.env.COURSE_LOCAL_MODEL_SEED_FILE?.trim() ?? '',
    inferenceKind: 'openai-compatible',
  });
}

export function loadConfig() {
  const backend = process.env.AGENT_WORK_BACKEND ?? 'mock';
  if (!['mock', 'openai-compatible'].includes(backend)) {
    throw new Error(`unsupported AGENT_WORK_BACKEND: ${backend}`);
  }
  const appPassword = required('COURSE_DB_APP_PASSWORD');
  if (!/^[A-Za-z0-9._-]{16,128}$/u.test(appPassword)) {
    throw new Error('COURSE_DB_APP_PASSWORD must be 16-128 safe ASCII characters');
  }
  const origin = process.env.PUBLIC_ORIGIN ?? 'http://127.0.0.1:8090';
  const localModelManagement = boolean('COURSE_LOCAL_MODEL_MANAGEMENT');
  const inferences = {
    mock: inferenceConfig('mock'),
  };
  if (backend === 'openai-compatible' || localModelManagement) {
    inferences['openai-compatible'] = inferenceConfig('openai-compatible');
  }
  const inference = inferences[backend];
  const localModel = localModelConfig(localModelManagement, inferences);
  const qualificationRunId = process.env.COURSE_QUALIFICATION_RUN_ID?.trim() ?? '';
  if (qualificationRunId && !/^[A-Za-z0-9._-]{1,80}$/u.test(qualificationRunId)) {
    throw new Error('COURSE_QUALIFICATION_RUN_ID contains unsupported characters');
  }
  const qualificationTimeoutOnce = process.env.COURSE_QUALIFICATION_TIMEOUT_ONCE?.trim() ?? '';
  if (qualificationTimeoutOnce && ![
    'provision',
    'generate_outline',
    'revise_outline',
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
  const outboxProcessingStaleSeconds = integer(
    'OUTBOX_PROCESSING_STALE_SECONDS',
    240,
    1,
    600,
  );
  return Object.freeze({
    port: Number(process.env.PORT ?? 8090),
    publicOrigin: new URL(origin).origin,
    databaseUrl: required('DATABASE_URL'),
    appDatabaseUrl: required('APP_DATABASE_URL'),
    appPassword,
    backend,
    inference,
    inferences: Object.freeze(inferences),
    localModel,
    sessionSecure: boolean('SESSION_SECURE'),
    sessionHours,
    outboxProcessingStaleSeconds,
    stateDir: process.env.STATE_DIR ?? '/state',
    qualificationRunId,
    qualificationTimeoutOnce,
    qualificationCrashAfterAdapterOnce,
  });
}
