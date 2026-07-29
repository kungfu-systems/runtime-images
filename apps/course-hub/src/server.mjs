// SPDX-License-Identifier: Apache-2.0
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { initializeDatabase } from './db.mjs';
import { CourseDomain, registrationLogReason } from './domain.mjs';
import { AgentWorkRouter } from './agent-work-router.mjs';
import { MockAgentWorkAdapter } from './mock-agent-work-adapter.mjs';
import { OpenAICompatibleAgentWorkAdapter } from './openai-compatible-agent-work-adapter.mjs';
import { LocalModelManager } from './local-model-manager.mjs';
import { KungfuCourseWorkControl } from './kungfu-course-work-control.mjs';
import { OutboxDispatcher } from './outbox.mjs';
import { createQualificationFaults } from './qualification-faults.mjs';
import { createRateLimiter } from './security.mjs';
import { WorkControlProjection } from './work-control-projection.mjs';

const config = loadConfig();
const pool = await initializeDatabase(config);
const localModel = new LocalModelManager(config.localModel);
await localModel.initialize();
const adapters = { mock: new MockAgentWorkAdapter(pool) };
for (const kind of ['openai-compatible', 'hosted']) {
  const inferenceConfig = config.inferences[kind];
  if (!inferenceConfig) continue;
  adapters[kind] = new OpenAICompatibleAgentWorkAdapter(
    pool,
    inferenceConfig.dynamicLocalModel
      ? () => localModel.activeConfig(inferenceConfig)
      : inferenceConfig,
  );
}
const agentWorkPort = new AgentWorkRouter({
  defaultBackend: config.backend,
  adapters,
});
const workControlAdapter = new KungfuCourseWorkControl({
  stateRoot: config.stateDir,
  kungfuBin: config.kungfuBin,
});
const workControl = new WorkControlProjection(config.workControl);
const dispatcher = new OutboxDispatcher(
  pool,
  agentWorkPort,
  createQualificationFaults(config),
  workControlAdapter,
);
const domain = new CourseDomain(pool, agentWorkPort, dispatcher, config);
const webRoot = fileURLToPath(new URL('../web/', import.meta.url));
const authLimit = createRateLimiter({ limit: 10, windowMs: 5 * 60_000 });
let ready = true;
const interval = setInterval(() => dispatcher.drainAll().catch((error) => {
  console.error('[outbox] delivery sweep failed:', error.message);
}), 2_000);
interval.unref();
await dispatcher.drainAll();

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie ?? '').split(';').map((part) => {
    const [key, ...rest] = part.trim().split('=');
    return [key, decodeURIComponent(rest.join('='))];
  }).filter(([key]) => key));
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function headers(extra = {}) {
  return {
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    ...extra,
  };
}

function json(res, status, value, extra = {}) {
  res.writeHead(status, headers({ 'content-type': 'application/json; charset=utf-8', ...extra }));
  res.end(JSON.stringify(value));
}

function backendDescription(kind = config.backend) {
  let inference = config.inferences[kind];
  if (kind === 'openai-compatible' && inference?.dynamicLocalModel) {
    try {
      inference = localModel.activeConfig(inference);
    } catch {
      // The catalog remains visible before a model is activated.
    }
  }
  const {
    kind: backendKind,
    label,
    provider,
    model,
    simulated,
    delivery,
  } = inference;
  return { kind: backendKind, label, provider, model, simulated, delivery };
}

async function runtimeDescription() {
  const modelCatalog = localModel.publicStatus();
  let localReady = false;
  if (modelCatalog.activeModelId && agentWorkPort.hasBackend('openai-compatible')) {
    localReady = await agentWorkPort.health('openai-compatible').then(
      () => true,
      () => false,
    );
  }
  return {
    defaultBackend: config.backend,
    workControl: await workControl.publicStatus(),
    backends: {
      mock: {
        ...backendDescription('mock'),
        available: true,
        ready: true,
      },
      ...(config.inferences['openai-compatible']
        ? {
          'openai-compatible': {
            ...backendDescription('openai-compatible'),
            available: modelCatalog.models.some((model) => model.state === 'installed'),
            ready: localReady,
            modelCatalog,
          },
        }
        : {}),
      hosted: config.inferences.hosted
        ? {
          ...backendDescription('hosted'),
          available: true,
          ready: await agentWorkPort.health('hosted').then(() => true, () => false),
        }
        : {
          kind: 'hosted',
          label: 'Hosted OpenAI-compatible provider',
          provider: 'not configured',
          model: 'none',
          simulated: false,
          delivery: 'hosted',
          available: false,
          ready: false,
        },
    },
  };
}

async function requireCourseBackend(input) {
  const kind = String(input.backendKind ?? config.backend);
  if (!agentWorkPort.hasBackend(kind)) {
    throw Object.assign(new Error('requested Agent backend is unavailable'), { status: 409 });
  }
  if (kind === 'openai-compatible') {
    const runtime = await runtimeDescription();
    if (!runtime.backends[kind]?.ready) {
      throw Object.assign(new Error('local model is not ready'), { status: 409 });
    }
  }
  if (kind === 'hosted') {
    const ready = await agentWorkPort.health('hosted').then(() => true, () => false);
    if (!ready) throw Object.assign(new Error('hosted provider is not ready'), { status: 409 });
  }
  return kind;
}

function sessionCookie(token, clear = false) {
  const pieces = [
    `course_session=${clear ? '' : encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    clear ? 'Max-Age=0' : `Max-Age=${config.sessionHours * 3600}`,
  ];
  if (config.sessionSecure) pieces.push('Secure');
  return pieces.join('; ');
}

function requireOrigin(req) {
  if (req.headers.origin !== config.publicOrigin) {
    throw Object.assign(new Error('origin rejected'), {
      status: 403,
      publicCode: 'origin_rejected',
      publicMessage: `Open ${config.publicOrigin} and try again.`,
    });
  }
}

async function requireAuth(req) {
  const auth = await domain.authenticate(cookies(req).course_session);
  if (!auth) throw Object.assign(new Error('authentication required'), { status: 401 });
  return auth;
}

function requireCsrf(req, auth) {
  if (req.headers['x-csrf-token'] !== auth.csrfToken) {
    throw Object.assign(new Error('request rejected'), { status: 403 });
  }
}

async function staticFile(pathname, res) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!/^[A-Za-z0-9._/-]+$/u.test(relative) || relative.includes('..')) return false;
  try {
    const content = await readFile(`${webRoot}/${relative}`);
    const type = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
    }[extname(relative)] ?? 'application/octet-stream';
    res.writeHead(200, headers({ 'content-type': type, 'cache-control': 'no-cache' }));
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

const actionTypes = {
  'first-submission': 'run_first_submission',
  evidence: 'submit_evidence',
  review: 'request_review',
  seal: 'seal',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, config.publicOrigin);
  try {
    if (req.method === 'GET' && url.pathname === '/healthz') {
      return json(res, 200, { live: true });
    }
    if (req.method === 'GET' && url.pathname === '/readyz') {
      await pool.query('SELECT 1');
      let inference = 'ready';
      try {
        await agentWorkPort.health();
      } catch {
        inference = 'unavailable';
      }
      const isReady = ready && inference === 'ready';
      return json(res, isReady ? 200 : 503, {
        ready: isReady,
        database: 'ready',
        migrations: 'ready',
        inference,
        agentBackend: backendDescription(),
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/runtime') {
      return json(res, 200, { runtime: await runtimeDescription() });
    }
    if (req.method === 'GET' && url.pathname === '/api/session') {
      const auth = await domain.authenticate(cookies(req).course_session);
      return json(res, 200, auth
        ? {
          authenticated: true,
          user: auth.user,
          csrfToken: auth.csrfToken,
          agentBackend: backendDescription(),
        }
        : { authenticated: false, agentBackend: backendDescription() });
    }
    if (req.method === 'POST' && ['/api/register', '/api/login'].includes(url.pathname)) {
      requireOrigin(req);
      const remote = req.socket.remoteAddress ?? 'unknown';
      if (!authLimit(`${remote}:${url.pathname}`)) {
        return json(res, 429, { error: 'Please wait before trying again.' });
      }
      const input = await body(req);
      const result = url.pathname.endsWith('register')
        ? await domain.register(input)
        : await domain.login(input);
      return json(res, 200, {
        authenticated: true,
        user: result.user,
        csrfToken: result.csrfToken,
        agentBackend: backendDescription(),
      }, { 'set-cookie': sessionCookie(result.token) });
    }
    if (req.method === 'POST' && url.pathname === '/api/logout') {
      requireOrigin(req);
      const auth = await requireAuth(req);
      requireCsrf(req, auth);
      await domain.logout(auth);
      return json(res, 200, { authenticated: false }, { 'set-cookie': sessionCookie('', true) });
    }
    const modelInstallMatch = url.pathname.match(
      /^\/api\/runtime\/local-models\/([a-z0-9.-]+)\/install$/u,
    );
    if (req.method === 'POST' && modelInstallMatch) {
      requireOrigin(req);
      const auth = await requireAuth(req);
      requireCsrf(req, auth);
      await body(req);
      await localModel.install(modelInstallMatch[1]);
      return json(res, 202, { runtime: await runtimeDescription() });
    }
    const modelActivateMatch = url.pathname.match(
      /^\/api\/runtime\/local-models\/([a-z0-9.-]+)\/activate$/u,
    );
    if (req.method === 'POST' && modelActivateMatch) {
      requireOrigin(req);
      const auth = await requireAuth(req);
      requireCsrf(req, auth);
      await body(req);
      await localModel.activate(modelActivateMatch[1]);
      return json(res, 200, { runtime: await runtimeDescription() });
    }
    if (req.method === 'GET' && url.pathname === '/api/homeworks') {
      const auth = await requireAuth(req);
      return json(res, 200, { homeworks: await domain.listHomeworks(auth.user.id) });
    }
    if (req.method === 'GET' && url.pathname === '/api/courses') {
      const auth = await requireAuth(req);
      return json(res, 200, { courses: await domain.listCourses(auth.user.id) });
    }
    if (req.method === 'POST' && url.pathname === '/api/courses') {
      requireOrigin(req);
      const auth = await requireAuth(req);
      requireCsrf(req, auth);
      const input = await body(req);
      const backendKind = await requireCourseBackend(input);
      const course = await domain.createCourse(auth.user.id, input, backendKind);
      return json(res, 201, { course });
    }
    const courseMatch = url.pathname.match(/^\/api\/courses\/([0-9a-f-]{36})$/u);
    if (req.method === 'GET' && courseMatch) {
      const auth = await requireAuth(req);
      const course = await domain.course(auth.user.id, courseMatch[1]);
      return course ? json(res, 200, { course }) : json(res, 404, { error: 'Not found.' });
    }
    const courseBackendMatch = url.pathname.match(
      /^\/api\/courses\/([0-9a-f-]{36})\/backend$/u,
    );
    if (req.method === 'POST' && courseBackendMatch) {
      requireOrigin(req);
      const auth = await requireAuth(req);
      requireCsrf(req, auth);
      const input = await body(req);
      const backendKind = await requireCourseBackend(input);
      const course = await domain.switchCourseBackend(
        auth.user.id,
        courseBackendMatch[1],
        backendKind,
        req.headers['idempotency-key'],
      );
      return json(res, 200, { course });
    }
    const courseActionMatch = url.pathname.match(
      /^\/api\/courses\/([0-9a-f-]{36})\/actions\/(generate|revise)$/u,
    );
    if (req.method === 'POST' && courseActionMatch) {
      requireOrigin(req);
      const auth = await requireAuth(req);
      requireCsrf(req, auth);
      const course = await domain.enqueueCourseAction(
        auth.user.id,
        courseActionMatch[1],
        courseActionMatch[2] === 'generate' ? 'generate_outline' : 'revise_outline',
        req.headers['idempotency-key'],
        await body(req),
      );
      return json(res, 200, { course });
    }
    const approveMatch = url.pathname.match(
      /^\/api\/courses\/([0-9a-f-]{36})\/versions\/([0-9a-f-]{36})\/approve$/u,
    );
    if (req.method === 'POST' && approveMatch) {
      requireOrigin(req);
      const auth = await requireAuth(req);
      requireCsrf(req, auth);
      const course = await domain.approveVersion(auth.user.id, approveMatch[1], approveMatch[2]);
      return json(res, 200, { course });
    }
    const homeworkMatch = url.pathname.match(/^\/api\/homeworks\/([0-9a-f-]{36})$/u);
    if (req.method === 'GET' && homeworkMatch) {
      const auth = await requireAuth(req);
      const homework = await domain.homework(auth.user.id, homeworkMatch[1]);
      return homework ? json(res, 200, { homework }) : json(res, 404, { error: 'Not found.' });
    }
    const actionMatch = url.pathname.match(/^\/api\/homeworks\/([0-9a-f-]{36})\/actions\/([a-z-]+)$/u);
    if (req.method === 'POST' && actionMatch) {
      requireOrigin(req);
      const auth = await requireAuth(req);
      requireCsrf(req, auth);
      const type = actionTypes[actionMatch[2]];
      if (!type) return json(res, 404, { error: 'Not found.' });
      const input = await body(req);
      const homework = await domain.enqueueAction(
        auth.user.id,
        actionMatch[1],
        type,
        req.headers['idempotency-key'],
        input,
      );
      return json(res, 200, { homework });
    }
    if (req.method === 'GET' && await staticFile(url.pathname, res)) return;
    json(res, 404, { error: 'Not found.' });
  } catch (error) {
    const status = error.status ?? (error.code === 'NOT_FOUND' ? 404 : 400);
    const message = error.publicMessage ?? (status === 401 ? 'Authentication required.'
      : status === 404 ? 'Not found.'
        : status >= 500 ? 'Internal error.'
          : 'Request could not be completed.');
    if (url.pathname === '/api/register') {
      console.warn(
        `[registration] rejected status=${status} reason=${registrationLogReason(error)}`,
      );
    }
    if (status >= 500) console.error('[request] failed:', error.message);
    json(res, status, { error: message });
  }
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(`[course-reference] listening on ${config.port}; backend=${config.backend}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    ready = false;
    clearInterval(interval);
    server.close();
    await localModel.stop();
    await pool.end();
    process.exit(0);
  });
}
