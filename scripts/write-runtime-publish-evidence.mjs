// SPDX-License-Identifier: Apache-2.0

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requireDigest(value, label) {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be an exact sha256 digest`);
  }
  return value;
}

const version = requiredEnv('BUILDCHAIN_VERSION');
const channel = requiredEnv('BUILDCHAIN_CHANNEL');
const sourceSha = requiredEnv('BUILDCHAIN_SOURCE_SHA');
const releaseSha = requiredEnv('BUILDCHAIN_RELEASE_SHA');
const targetRef = requiredEnv('BUILDCHAIN_TARGET_REF');
const evidencePath = requiredEnv('BUILDCHAIN_PUBLISH_EVIDENCE');
const releaseMaterialSha = process.env.BUILDCHAIN_RELEASE_MATERIAL_SHA || releaseSha;
const publishToolingSha = process.env.BUILDCHAIN_PUBLISH_TOOLING_SHA || releaseSha;
const imageDigest = requireDigest(requiredEnv('HUB_IMAGE_DIGEST'), 'HUB_IMAGE_DIGEST');
const applicationDigest = requireDigest(
  requiredEnv('HUB_APPLICATION_DIGEST'),
  'HUB_APPLICATION_DIGEST',
);
const name = 'ghcr.io/kungfu-systems/runtime-images/hub-starter';
const artifacts = [
  {
    group: 'image',
    kind: 'oci',
    name,
    ref: `v${version}`,
    digest: imageDigest,
  },
  {
    group: 'application',
    kind: 'oci',
    name,
    ref: `compose-v${version}`,
    digest: applicationDigest,
  },
];

const requiredArtifacts = JSON.parse(requiredEnv('BUILDCHAIN_REQUIRED_ARTIFACTS'));
for (const required of requiredArtifacts) {
  const match = artifacts.find((artifact) => (
    artifact.kind === required.kind
    && artifact.name === required.name
    && artifact.ref === required.ref
    && (!required.group || artifact.group === required.group)
  ));
  if (!match) {
    throw new Error(
      `publish evidence is missing ${required.group ?? '*'}:${required.kind}:${required.name}:${required.ref}`,
    );
  }
}

await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify({
  schema: 1,
  version,
  channel,
  source_sha: sourceSha,
  release_sha: releaseSha,
  target_ref: targetRef,
  release_material_sha: releaseMaterialSha,
  publish_tooling_sha: publishToolingSha,
  artifacts,
}, null, 2)}\n`);

console.log(`publish_evidence=${evidencePath}`);
