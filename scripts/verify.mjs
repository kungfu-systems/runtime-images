// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises';
import { validateComposeText, validateImageReference } from '../src/policy.mjs';

const compose = await readFile(new URL('../compose.yaml', import.meta.url), 'utf8');
validateComposeText(compose);

for (const relative of [
  '../package.json',
  '../contracts/hub-starter-runtime.contract.json',
  '../release/runtime.lock.json',
]) {
  JSON.parse(await readFile(new URL(relative, import.meta.url), 'utf8'));
}

const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
for (const required of [
  'FROM ${BUILD_IMAGE} AS package',
  'FROM ${RUNTIME_IMAGE} AS runtime',
  'sha256sum -c -',
  'USER node',
  'tech.kungfu.product.source',
  'tech.kungfu.product.package.sha256',
  'tech.kungfu.build-image.digest',
  'ln -s /opt/kungfu/kungfu /usr/local/bin/kungfu',
]) {
  if (!dockerfile.includes(required)) throw new Error(`Dockerfile invariant missing: ${required}`);
}
for (const forbidden of ['COPY . ', 'git clone', 'npm install', 'pnpm install']) {
  if (dockerfile.includes(forbidden)) throw new Error(`final build boundary contains forbidden source/toolchain action: ${forbidden}`);
}

const lock = JSON.parse(await readFile(new URL('../release/runtime.lock.json', import.meta.url), 'utf8'));
if (lock.status === 'qualified-development-candidate') validateImageReference(lock.image);
if (!/^[0-9a-f]{40}$/u.test(lock.kungfuSourceSha)) throw new Error('Kungfu source is not an exact commit');
if (!lock.buildImageDigest.startsWith('sha256:')) throw new Error('build image is not digest-pinned');
if (!compose.includes('HUB_COURSE_NAME: ${HUB_COURSE_NAME:-AI Teaching Sprint}')) {
  throw new Error('bounded course-team extension seam is missing');
}

console.log('[verify] source, Compose, image boundary, and identity contracts passed');
