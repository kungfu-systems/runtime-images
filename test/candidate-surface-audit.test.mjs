// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import { kfd3 } from '@kungfu-tech/buildchain/kfd';
import { candidateArtifactPath, packageInputPath, writeComposeLayout } from '../scripts/oci-compose-candidate.mjs';

test('post-build audit separates OCI transport from public binary surfaces', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-candidate-surfaces-'));
  const registryPath = '.buildchain/kfd/kfd-3/surfaces.json';
  const audit = () => kfd3.auditSurfaces({ cwd, registryPath });
  try {
    fs.writeFileSync(path.join(cwd, 'README.md'), '# Fixture\n');
    kfd3.registerSurfaces({ cwd, registryPath, kinds: ['documentation', 'node-api'] });
    const oldRoot = path.join(cwd, 'build/oci-candidate');
    writeComposeLayout({ root: oldRoot, project: { services: {} } });
    assert.equal(audit().status, 'partial', 'old staging must reproduce the failure');
    const nextRoot = path.join(cwd, candidateArtifactPath);
    fs.mkdirSync(path.dirname(nextRoot), { recursive: true });
    fs.renameSync(oldRoot, nextRoot);
    fs.mkdirSync(path.join(cwd, packageInputPath), { recursive: true });
    fs.writeFileSync(path.join(cwd, packageInputPath, 'package.tar.gz'), 'fixture input');
    assert.equal(audit().status, 'passed');
    fs.writeFileSync(path.join(cwd, 'build/unregistered-tool'), 'public binary fixture');
    const result = audit();
    assert.equal(result.status, 'partial', 'complete binary discovery must remain enabled');
    assert.equal(result.summary.detectedButUnregistered, 1);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('public candidate upload includes the transport layout', () => {
  const workflow = YAML.parse(fs.readFileSync(new URL('../.github/workflows/build.yml', import.meta.url), 'utf8'));
  assert.ok(workflow.jobs.images.with['artifact-paths'].split('\n').includes(candidateArtifactPath));
});
