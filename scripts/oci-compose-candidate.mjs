// SPDX-License-Identifier: Apache-2.0
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const sha256 = (bytes) => `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
// Transport blobs and downloaded packages are build inputs, not public binary APIs.
export const candidateArtifactPath = '.artifacts/oci-candidate';
export const packageInputPath = '.artifacts/runtime-inputs';
export const imageRepository = 'ghcr.io/kungfu-systems/runtime-images/hub-starter';

export function composeProject(source, imageDigest) {
  if (!/^sha256:[0-9a-f]{64}$/u.test(imageDigest)) throw new Error('exact image digest required');
  const project = YAML.parse(source);
  for (const name of ['bootstrap', 'hub']) {
    if (!project.services?.[name]?.image?.startsWith('${KUNGFU_HUB_IMAGE:-')) {
      throw new Error(`missing controlled image substitution: ${name}`);
    }
    project.services[name].image = `${imageRepository}@${imageDigest}`;
  }
  if (project.services.database.ports || project.services.hub.ports[0].host_ip !== '127.0.0.1') {
    throw new Error('Compose network boundary changed');
  }
  for (const service of Object.values(project.services)) {
    if (!/^[a-z0-9./:_-]+@sha256:[0-9a-f]{64}$/u.test(service.image)) throw new Error('unpinned service image');
    if (service.privileged || service.network_mode === 'host') throw new Error('unsafe service privilege');
  }
  return project;
}

export function writeComposeLayout({ root, project }) {
  const directory = path.join(root, 'blobs/sha256');
  fs.mkdirSync(directory, { recursive: true });
  const blob = (value, mediaType) => {
    const bytes = Buffer.from(JSON.stringify(value));
    const digest = sha256(bytes);
    fs.writeFileSync(path.join(directory, digest.slice(7)), bytes);
    return { mediaType, digest, size: bytes.length };
  };
  const descriptor = blob({
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.manifest.v1+json',
    artifactType: 'application/vnd.docker.compose.project',
    config: blob({}, 'application/vnd.oci.empty.v1+json'),
    layers: [blob(project, 'application/vnd.docker.compose.file+yaml')],
  }, 'application/vnd.oci.image.manifest.v1+json');
  fs.writeFileSync(path.join(root, 'oci-layout'), '{"imageLayoutVersion":"1.0.0"}\n');
  fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify({ schemaVersion: 2, manifests: [descriptor] }));
  return descriptor;
}
