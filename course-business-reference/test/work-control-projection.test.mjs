// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkControlProjection } from '../src/work-control-projection.mjs';

test('work-control projection exposes native Kungfu as a separate authority', async () => {
  const status = await new WorkControlProjection({}).publicStatus();
  assert.equal(status.mode, 'kungfu-managed');
  assert.equal(status.nativeCourseBinding, true);
  assert.match(status.authorityNotice, /PostgreSQL owns accounts/u);
  assert.match(status.authorityNotice, /Kungfu native journal state owns/u);
  assert.deepEqual(status.lifecycle, [
    'Assignment admitted and claimed',
    'Selected generator returns an outline',
    'Exact PostgreSQL version is attached as Evidence',
    'Independent reviewer checks the Evidence',
    'Typed continuation decision is recorded',
    'Accepted work receives a portable seal',
  ]);
});
