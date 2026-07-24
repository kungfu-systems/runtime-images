// SPDX-License-Identifier: Apache-2.0

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { KungfuRuntime } from './runtime.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..', 'web');
const runtime = new KungfuRuntime();
const port = Number(process.env.PORT || 8080);

function sendJson(response, status, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

async function staticFile(response, name, type) {
  const body = await readFile(join(webRoot, name));
  response.writeHead(200, {
    'content-type': type,
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://hub-starter.local');
    if (request.method === 'GET' && url.pathname === '/healthz') {
      const state = await runtime.state();
      const readyPhases = new Set([
        'executing',
        'stage-ready',
        'claimed-complete',
        'reviewed',
        'continuation-decided',
      ]);
      sendJson(response, 200, {
        schema: 'kungfu.hub-starter.readiness/v1',
        ready: readyPhases.has(state.assignment.phase),
        instanceId: state.instance.instanceId,
        workspaceIdentityRoot: state.assignment.assignment.owning_workspace_identity_root,
        queryProofRoot: state.assignment.query_proof_root,
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/state') {
      sendJson(response, 200, await runtime.state());
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/settle') {
      sendJson(response, 200, await runtime.settleDemo());
      return;
    }
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      await staticFile(response, 'index.html', 'text/html; charset=utf-8');
      return;
    }
    if (request.method === 'GET' && url.pathname === '/app.js') {
      await staticFile(response, 'app.js', 'text/javascript; charset=utf-8');
      return;
    }
    if (request.method === 'GET' && url.pathname === '/style.css') {
      await staticFile(response, 'style.css', 'text/css; charset=utf-8');
      return;
    }
    sendJson(response, 404, { schema: 'kungfu.hub-starter.error/v1', code: 'not-found' });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, {
      schema: 'kungfu.hub-starter.error/v1',
      code: 'runtime-operation-failed',
      message: error.message,
    });
  }
});

await runtime.ensureBootstrap();
server.listen(port, '0.0.0.0', () => {
  console.log(`[hub-starter] semantic readiness established on container port ${port}`);
});
