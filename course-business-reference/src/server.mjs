// SPDX-License-Identifier: Apache-2.0
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { initializeDatabase } from './db.mjs';
import { CourseDomain } from './domain.mjs';
import { MockAgentWorkAdapter } from './mock-agent-work-adapter.mjs';
import { OutboxDispatcher } from './outbox.mjs';
import { createQualificationFaults } from './qualification-faults.mjs';
import { createRateLimiter } from './security.mjs';

const config = loadConfig();
const pool = await initializeDatabase(config);
const agentWorkPort = new MockAgentWorkAdapter(pool);
const dispatcher = new OutboxDispatcher(pool, agentWorkPort, createQualificationFaults(config));
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
    throw Object.assign(new Error('origin rejected'), { status: 403 });
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
      return json(res, ready ? 200 : 503, { ready, database: 'ready', migrations: 'ready', backend: 'mock-simulated' });
    }
    if (req.method === 'GET' && url.pathname === '/api/session') {
      const auth = await domain.authenticate(cookies(req).course_session);
      return json(res, 200, auth
        ? { authenticated: true, user: auth.user, csrfToken: auth.csrfToken, backend: 'mock-simulated' }
        : { authenticated: false, backend: 'mock-simulated' });
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
        backend: 'mock-simulated',
      }, { 'set-cookie': sessionCookie(result.token) });
    }
    if (req.method === 'POST' && url.pathname === '/api/logout') {
      requireOrigin(req);
      const auth = await requireAuth(req);
      requireCsrf(req, auth);
      await domain.logout(auth);
      return json(res, 200, { authenticated: false }, { 'set-cookie': sessionCookie('', true) });
    }
    if (req.method === 'GET' && url.pathname === '/api/homeworks') {
      const auth = await requireAuth(req);
      return json(res, 200, { homeworks: await domain.listHomeworks(auth.user.id) });
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
    const message = status === 401 ? 'Authentication required.'
      : status === 404 ? 'Not found.'
        : status >= 500 ? 'Internal error.'
          : 'Request could not be completed.';
    if (status >= 500) console.error('[request] failed:', error.message);
    json(res, status, { error: message });
  }
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(`[course-reference] listening on ${config.port}; backend=mock-simulated`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    ready = false;
    clearInterval(interval);
    server.close();
    await pool.end();
    process.exit(0);
  });
}
