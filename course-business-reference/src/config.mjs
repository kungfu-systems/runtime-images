// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { QWEN_MODEL_CATALOG } from './model-catalog.mjs';

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

const optionalHttpUrl = (name) => {
  const raw = process.env[name]?.trim() ?? '';
  if (!raw) return '';
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${name} must be an HTTP(S) URL without credentials`);
  }
  if (url.search || url.hash) {
    throw new Error(`${name} must not contain a query or fragment`);
  }
  return url.toString();
};

function workControlConfig() {
  const statusUrl = optionalHttpUrl('COURSE_WORK_CONTROL_DEMO_STATUS_URL');
  const browserUrl = optionalHttpUrl('COURSE_WORK_CONTROL_DEMO_BROWSER_URL');
  if (Boolean(statusUrl) !== Boolean(browserUrl)) {
    throw new Error('course work-control demo status and browser URLs must be configured together');
  }
  return Object.freeze({
    enabled: Boolean(statusUrl),
    statusUrl,
    browserUrl,
    timeoutMs: integer('COURSE_WORK_CONTROL_DEMO_TIMEOUT_MS', 1_500, 250, 5_000),
  });
}

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

function hostedInferenceConfig() {
  const raw = process.env.COURSE_HOSTED_AGENT_BASE_URL?.trim() ?? '';
  if (!raw) return null;
  const baseUrl = new URL(raw);
  if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) {
    throw new Error('COURSE_HOSTED_AGENT_BASE_URL must be an HTTP(S) URL without credentials');
  }
  if (baseUrl.search || baseUrl.hash) {
    throw new Error('COURSE_HOSTED_AGENT_BASE_URL must not contain a query or fragment');
  }
  const model = required('COURSE_HOSTED_AGENT_MODEL');
  if (model.length > 160) throw new Error('COURSE_HOSTED_AGENT_MODEL is too long');
  const provider =
    process.env.COURSE_HOSTED_AGENT_PROVIDER_LABEL?.trim() || 'Hosted provider';
  if (provider.length > 80) throw new Error('COURSE_HOSTED_AGENT_PROVIDER_LABEL is too long');
  return Object.freeze({
    kind: 'hosted',
    label: `${provider} Course Designer`,
    provider,
    model,
    simulated: false,
    delivery: 'hosted',
    baseUrl: baseUrl.toString().replace(/\/+$/u, ''),
    apiKey: optionalSecret(
      'COURSE_HOSTED_AGENT_API_KEY',
      'COURSE_HOSTED_AGENT_API_KEY_FILE',
    ),
    timeoutMs: integer('COURSE_HOSTED_AGENT_TIMEOUT_MS', 120_000, 5_000, 300_000),
  });
}

function localModelConfig(enabled) {
  if (!enabled) return Object.freeze({ enabled: false, catalog: QWEN_MODEL_CATALOG });
  const modelsRoot = process.env.COURSE_LOCAL_MODELS_ROOT?.trim() || '/models';
  if (!/^\/[A-Za-z0-9._/-]+$/u.test(modelsRoot) || modelsRoot.includes('..')) {
    throw new Error('COURSE_LOCAL_MODELS_ROOT must be an absolute safe path');
  }
  const llamaBin = process.env.COURSE_LLAMA_SERVER_BIN?.trim() || '/opt/llama/llama-server';
  if (!/^\/[A-Za-z0-9._/-]+$/u.test(llamaBin) || llamaBin.includes('..')) {
    throw new Error('COURSE_LLAMA_SERVER_BIN must be an absolute safe path');
  }
  return Object.freeze({
    enabled: true,
    catalog: QWEN_MODEL_CATALOG,
    modelsRoot,
    llamaBin,
    serverHost: '127.0.0.1',
    serverPort: integer('COURSE_LLAMA_SERVER_PORT', 8081, 1024, 65_535),
    seedRoot: process.env.COURSE_LOCAL_MODEL_SEED_ROOT?.trim() ?? '',
  });
}

export function loadConfig() {
  const backend = process.env.AGENT_WORK_BACKEND ?? 'mock';
  if (!['mock', 'openai-compatible', 'hosted'].includes(backend)) {
    throw new Error(`unsupported AGENT_WORK_BACKEND: ${backend}`);
  }
  const appPassword = required('COURSE_DB_APP_PASSWORD');
  if (!/^[A-Za-z0-9._-]{16,128}$/u.test(appPassword)) {
    throw new Error('COURSE_DB_APP_PASSWORD must be 16-128 safe ASCII characters');
  }
  const origin = process.env.PUBLIC_ORIGIN ?? 'http://127.0.0.1:8090';
  const localModelManagement = boolean('COURSE_LOCAL_MODEL_MANAGEMENT', true);
  const inferences = {
    mock: inferenceConfig('mock'),
  };
  if (localModelManagement) {
    inferences['openai-compatible'] = Object.freeze({
      kind: 'openai-compatible',
      label: 'Local Qwen Course Designer',
      provider: 'Local Qwen',
      model: 'Select and activate a model',
      simulated: false,
      delivery: 'local',
      baseUrl: `http://127.0.0.1:${integer('COURSE_LLAMA_SERVER_PORT', 8081, 1024, 65_535)}/v1`,
      apiKey: '',
      timeoutMs: integer('AGENT_WORK_TIMEOUT_MS', 180_000, 5_000, 300_000),
      dynamicLocalModel: true,
    });
  } else if (backend === 'openai-compatible') {
    inferences['openai-compatible'] = inferenceConfig('openai-compatible');
  }
  const hosted = hostedInferenceConfig();
  if (hosted) inferences.hosted = hosted;
  if (!inferences[backend]) {
    throw new Error(`configured AGENT_WORK_BACKEND is unavailable: ${backend}`);
  }
  const inference = inferences[backend];
  const localModel = localModelConfig(localModelManagement);
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
  const workControl = workControlConfig();
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
    workControl,
    stateDir: process.env.STATE_DIR ?? '/state',
    kungfuBin: process.env.KUNGFU_BIN ?? '/opt/kungfu/kungfu',
    qualificationRunId,
    qualificationTimeoutOnce,
    qualificationCrashAfterAdapterOnce,
  });
}
