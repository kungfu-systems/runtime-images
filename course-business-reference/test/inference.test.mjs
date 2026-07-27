// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentWorkRouter } from '../src/agent-work-router.mjs';
import { loadConfig } from '../src/config.mjs';
import {
  createOutlineRequest,
  parseOutlineResponse,
} from '../src/openai-compatible-agent-work-adapter.mjs';

const inferenceConfig = {
  kind: 'openai-compatible',
  label: 'Local Qwen Course Designer',
  provider: 'Local Qwen',
  model: 'Qwen3-0.6B-Q4_K_M',
  delivery: 'local',
};

const command = {
  contract: 'course.agent-work-port/v2',
  type: 'generate_outline',
  idempotencyKey: 'generate:test:one',
  sourceIdentity: 'course-homework:test',
  payload: {
    title: 'Practical course design',
    targetLearner: 'Small-business experts',
    learnerProblem: 'Their knowledge is difficult to sequence.',
    promisedOutcome: 'Create a testable three-module outline.',
    creatorExpertise: 'Real client cases.',
    deliveryConstraints: 'Three short live sessions.',
  },
};

const outline = {
  title: 'Practical course design',
  positioning: 'A practical path for small-business experts',
  audience: 'Small-business experts',
  promise: 'Create a testable three-module outline.',
  delivery: 'Three short live sessions.',
  creatorAdvantage: 'Real client cases.',
  modules: [1, 2, 3].map((number) => ({
    number,
    title: `Module ${number}`,
    outcome: `Observable outcome ${number}`,
    lessons: [`Lesson ${number}.1`, `Lesson ${number}.2`, `Lesson ${number}.3`],
    exercise: `Exercise ${number}`,
  })),
  openQuestions: ['Question one?', 'Question two?', 'Question three?'],
  revisionNote: 'Created a first practical route.',
  summary: 'Turned the brief into a sequenced course.',
  changes: ['Sequenced the work.', 'Added exercises.', 'Exposed open decisions.'],
};

function configuredEnvironment(overrides, fn) {
  const names = [
    'AGENT_WORK_API_KEY',
    'AGENT_WORK_API_KEY_FILE',
    'AGENT_WORK_BACKEND',
    'AGENT_WORK_BASE_URL',
    'AGENT_WORK_DELIVERY',
    'AGENT_WORK_MODEL',
    'AGENT_WORK_PROVIDER_LABEL',
    'AGENT_WORK_TIMEOUT_MS',
    'APP_DATABASE_URL',
    'COURSE_DB_APP_PASSWORD',
    'COURSE_LOCAL_MODEL_BYTES',
    'COURSE_LOCAL_MODEL_MANAGEMENT',
    'COURSE_LOCAL_MODEL_PATH',
    'COURSE_LOCAL_MODEL_SEED_FILE',
    'COURSE_LOCAL_MODEL_SHA256',
    'COURSE_LOCAL_MODEL_SOURCE_LABEL',
    'COURSE_LOCAL_MODEL_URL',
    'DATABASE_URL',
  ];
  const prior = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  Object.assign(process.env, {
    COURSE_DB_APP_PASSWORD: 'synthetic_runtime_42',
    DATABASE_URL: 'postgresql://migration.invalid/course',
    APP_DATABASE_URL: 'postgresql://application.invalid/course',
    ...overrides,
  });
  try {
    return fn();
  } finally {
    for (const name of names) {
      if (prior[name] === undefined) delete process.env[name];
      else process.env[name] = prior[name];
    }
  }
}

test('configuration defaults to an explicit simulation without inference secrets', () => {
  configuredEnvironment({}, () => {
    const config = loadConfig();
    assert.equal(config.backend, 'mock');
    assert.equal(config.inference.simulated, true);
    assert.equal(config.inference.model, 'none');
    assert.equal('apiKey' in config.inference, false);
    assert.deepEqual(Object.keys(config.inferences), ['mock']);
    assert.equal(config.localModel.enabled, false);
  });
});

test('interactive local configuration keeps Mock default and pins click-installed model bytes', () => {
  configuredEnvironment({
    AGENT_WORK_BACKEND: 'mock',
    AGENT_WORK_BASE_URL: 'http://llama:8080/v1',
    AGENT_WORK_MODEL: 'Qwen3-0.6B-Q4_K_M',
    AGENT_WORK_PROVIDER_LABEL: 'Local Qwen',
    AGENT_WORK_DELIVERY: 'local',
    COURSE_LOCAL_MODEL_MANAGEMENT: 'true',
    COURSE_LOCAL_MODEL_PATH: '/models/Qwen3-0.6B-Q4_K_M.gguf',
    COURSE_LOCAL_MODEL_URL: 'https://models.invalid/pinned.gguf',
    COURSE_LOCAL_MODEL_SHA256: 'a'.repeat(64),
    COURSE_LOCAL_MODEL_BYTES: '396705472',
  }, () => {
    const config = loadConfig();
    assert.equal(config.backend, 'mock');
    assert.equal(config.inference.simulated, true);
    assert.equal(config.inferences['openai-compatible'].delivery, 'local');
    assert.equal(config.localModel.enabled, true);
    assert.equal(config.localModel.bytes, 396705472);
    assert.equal(config.localModel.inferenceKind, 'openai-compatible');
  });
});

test('OpenAI-compatible configuration validates the endpoint and exposes no secret metadata', () => {
  configuredEnvironment({
    AGENT_WORK_BACKEND: 'openai-compatible',
    AGENT_WORK_BASE_URL: 'http://llama:8080/v1',
    AGENT_WORK_MODEL: 'Qwen3-0.6B-Q4_K_M',
    AGENT_WORK_PROVIDER_LABEL: 'Local Qwen',
    AGENT_WORK_DELIVERY: 'local',
  }, () => {
    const config = loadConfig();
    assert.equal(config.inference.baseUrl, 'http://llama:8080/v1');
    assert.equal(config.inference.label, 'Local Qwen Course Designer');
    assert.equal(config.inference.apiKey, '');
  });
  configuredEnvironment({
    AGENT_WORK_BACKEND: 'openai-compatible',
    AGENT_WORK_BASE_URL: 'https://user:secret@provider.invalid/v1',
    AGENT_WORK_MODEL: 'model',
  }, () => assert.throws(loadConfig, /without credentials/u));
});

test('OpenAI-compatible request pins a structured course-outline response', () => {
  const request = createOutlineRequest(inferenceConfig, command);
  assert.equal(request.model, inferenceConfig.model);
  assert.equal(request.response_format.type, 'json_schema');
  assert.equal(request.response_format.json_schema.strict, true);
  assert.equal(request.response_format.json_schema.schema.properties.modules.minItems, 3);
  assert.equal(request.response_format.json_schema.schema.properties.modules.maxItems, 3);
  assert.equal(request.response_format.json_schema.schema.properties.positioning.maxLength, undefined);
  assert.equal(request.seed, createOutlineRequest(inferenceConfig, command).seed);
  assert.match(request.messages[1].content, /untrusted course data/u);
});

test('alternative generation is explicitly distinct without receiving a prior outline', () => {
  const request = createOutlineRequest(inferenceConfig, {
    ...command,
    idempotencyKey: 'alternative:stable-key',
    payload: {
      ...command.payload,
      previousVersionId: 'version-1',
      previousOutline: null,
    },
  });
  const prompt = request.messages[1].content;
  assert.match(prompt, /MODE: alternative/u);
  assert.match(prompt, /materially different learning route/u);
  assert.match(prompt, /earlier outline is intentionally omitted/u);
});

test('OpenAI-compatible response becomes the existing business-owned outline shape', () => {
  const parsed = parseOutlineResponse({
    choices: [{ message: { content: JSON.stringify(outline) } }],
  }, inferenceConfig, command);
  assert.equal(parsed.modules.length, 3);
  assert.equal(parsed.agentContribution.role, inferenceConfig.label);
  assert.equal(parsed.inference.delivery, 'local');
  assert.equal(parsed.inference.model, inferenceConfig.model);
  assert.equal(parsed.previousVersionTitle, null);
});

test('OpenAI-compatible response fails closed on malformed model output', () => {
  assert.throws(() => parseOutlineResponse({
    choices: [{ message: { content: JSON.stringify({ ...outline, modules: [] }) } }],
  }, inferenceConfig, command), /exactly three modules/u);
  assert.throws(() => parseOutlineResponse({
    choices: [{ message: { content: 'not-json' } }],
  }, inferenceConfig, command), /invalid JSON/u);
});

test('AgentWork router preserves old mock bindings while defaulting new work to inference', async () => {
  const calls = [];
  const adapter = (kind) => ({
    async health() {
      calls.push(`health:${kind}`);
      return { kind };
    },
    async execute(value) {
      calls.push(`execute:${kind}:${value.type}`);
      return { kind };
    },
    async read(bindingId) {
      calls.push(`read:${kind}:${bindingId}`);
      return { kind };
    },
  });
  const router = new AgentWorkRouter({
    defaultBackend: 'openai-compatible',
    adapters: {
      mock: adapter('mock'),
      'openai-compatible': adapter('openai-compatible'),
    },
  });
  assert.equal((await router.execute({ ...command, type: 'provision' })).kind, 'openai-compatible');
  assert.equal((await router.execute({ ...command, bindingId: 'mock:legacy' })).kind, 'mock');
  assert.equal((await router.read('openai:new')).kind, 'openai-compatible');
  assert.equal(router.hasBackend('mock'), true);
  assert.equal(router.hasBackend('missing'), false);
  assert.deepEqual(calls, [
    'execute:openai-compatible:provision',
    'execute:mock:generate_outline',
    'read:openai-compatible:openai:new',
  ]);
});
