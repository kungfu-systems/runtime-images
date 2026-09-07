import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { composeProject, imageRepository, sha256, writeComposeLayout } from '../scripts/oci-compose-candidate.mjs';

test('sealed Compose retains interpolation, volume identities, and private service boundaries', () => {
  const source = fs.readFileSync(new URL('../compose.yaml', import.meta.url), 'utf8');
  const digest = `sha256:${'a'.repeat(64)}`;
  const project = composeProject(source, digest);
  assert.equal(project.services.hub.image, `${imageRepository}@${digest}`);
  assert.equal(project.services.bootstrap.image, project.services.hub.image);
  assert.equal(project.services.hub.ports[0].published, '${HUB_PORT:-8080}');
  assert.equal(project.volumes['course-postgres'].name, '${COMPOSE_PROJECT_NAME:-kungfu-course-hub}-postgres');
  assert.equal(project.services.hub.environment.PUBLIC_ORIGIN, '${HUB_PUBLIC_ORIGIN:-http://127.0.0.1:${HUB_PORT:-8080}}');
  assert.equal(project.services.database.ports, undefined);
  assert.throws(() => composeProject(source.replace('127.0.0.1"', '0.0.0.0"'), digest), /network boundary/);
  assert.throws(() => composeProject(source, 'latest'), /exact image digest/);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-compose-test-'));
  try {
    const descriptor = writeComposeLayout({ root, project });
    const bytes = fs.readFileSync(path.join(root, 'blobs/sha256', descriptor.digest.slice(7)));
    assert.equal(sha256(bytes), descriptor.digest);
    const manifest = JSON.parse(bytes);
    assert.equal(manifest.artifactType, 'application/vnd.docker.compose.project');
    const layer = manifest.layers[0];
    const layerBytes = fs.readFileSync(path.join(root, 'blobs/sha256', layer.digest.slice(7)));
    assert.equal(sha256(layerBytes), layer.digest);
    assert.deepEqual(JSON.parse(layerBytes), project);
  } finally { fs.rmSync(root, { recursive: true }); }
});
