// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkControlProjection } from '../src/work-control-projection.mjs';

const disabled = {
  enabled: false,
  statusUrl: '',
  browserUrl: '',
  timeoutMs: 1_500,
};

test('work-control projection labels the course app as app-only without a demo', async () => {
  const status = await new WorkControlProjection(disabled).publicStatus();
  assert.equal(status.mode, 'app-only');
  assert.equal(status.nativeCourseBinding, false);
  assert.equal(status.hubStarterDemo.configured, false);
  assert.match(status.authorityNotice, /No native Kungfu Assignment/u);
});

test('work-control projection reports a healthy separate Hub Starter walkthrough', async () => {
  const projection = new WorkControlProjection({
    enabled: true,
    statusUrl: 'http://hub.example/healthz',
    browserUrl: 'http://hub.example/',
    timeoutMs: 1_500,
  }, async () => new Response(JSON.stringify({
    schema: 'kungfu.hub-starter.readiness/v1',
    ready: true,
    phase: 'executing',
  }), { status: 200 }));
  const status = await projection.publicStatus();
  assert.equal(status.nativeCourseBinding, false);
  assert.deepEqual(status.hubStarterDemo, {
    configured: true,
    reachable: true,
    ready: true,
    phase: 'executing',
    browserUrl: 'http://hub.example/',
  });
});

test('work-control projection fails closed when the neighboring demo is invalid', async () => {
  const projection = new WorkControlProjection({
    enabled: true,
    statusUrl: 'http://hub.example/healthz',
    browserUrl: 'http://hub.example/',
    timeoutMs: 1_500,
  }, async () => new Response('{"ready":true}', { status: 200 }));
  const status = await projection.publicStatus();
  assert.equal(status.nativeCourseBinding, false);
  assert.equal(status.hubStarterDemo.reachable, false);
  assert.equal(status.hubStarterDemo.ready, false);
  assert.equal(status.hubStarterDemo.phase, 'unavailable');
});
