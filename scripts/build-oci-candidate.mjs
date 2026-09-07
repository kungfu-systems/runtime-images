// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sealOciPublicationBundle } from '@kungfu-tech/buildchain/oci-publication';
import { candidateArtifactPath, packageInputPath, composeProject, imageRepository, sha256, writeComposeLayout } from './oci-compose-candidate.mjs';

const root = process.cwd();
const output = path.join(root, candidateArtifactPath);
const json = (file) => JSON.parse(fs.readFileSync(file));
const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', ...options });
const readCommand = (command, args) => run(command, args, { stdio: 'pipe', encoding: 'utf8' }).trim();
const sourceSha = readCommand('git', ['rev-parse', 'HEAD']);
run('git', ['diff', '--quiet', 'HEAD']);
if (process.env.BUILDCHAIN_SOURCE_SHA && process.env.BUILDCHAIN_SOURCE_SHA !== sourceSha) {
  throw new Error('checkout does not match the Buildchain candidate source');
}
const version = json('package.json').version;
const lock = json('release/runtime.lock.json');
if (fs.existsSync(output)) throw new Error('candidate output exists; use a clean build workspace');
fs.mkdirSync(output, { recursive: true });

const previousDigest = readCommand('docker', ['buildx', 'imagetools', 'inspect', `${imageRepository}:compose-preview`, '--format', '{{.Manifest.Digest}}']);
if (!/^sha256:[0-9a-f]{64}$/u.test(previousDigest)) throw new Error('previous preview must resolve before candidate sealing');
const packageTag = lock.packageRelease.split('/').at(-1);
const inputDir = path.join(root, packageInputPath);
fs.mkdirSync(inputDir, { recursive: true });
const buildArgs = [];
for (const [architecture, suffix] of [['amd64', 'x64'], ['arm64', 'arm64']]) {
  const name = `kungfu-episodes-cli-linux-${suffix}.tar.gz`;
  const destination = path.join(root, name);
  if (fs.existsSync(destination)) throw new Error(`refusing to overwrite package input: ${name}`);
  run('curl', ['--fail', '--silent', '--show-error', '--location', '--retry', '3',
    '--output', path.join(inputDir, name),
    `https://github.com/kungfu-systems/runtime-images/releases/download/${encodeURIComponent(packageTag)}/${name}`]);
  const bytes = fs.readFileSync(path.join(inputDir, name));
  const expected = lock.kungfuPackages[`linux/${architecture}`].sha256;
  if (sha256(bytes) !== `sha256:${expected}`) throw new Error(`package digest mismatch: ${name}`);
  fs.copyFileSync(path.join(inputDir, name), destination);
  buildArgs.push('--build-arg', `KUNGFU_PACKAGE_SHA256_${architecture.toUpperCase()}=${expected}`);
}
const imageLayout = path.join(output, 'image');
const builder = `runtime-candidate-${sourceSha.slice(0, 12)}-${process.pid}`;
try {
  run('docker', ['run', '--privileged', '--rm', 'tonistiigi/binfmt@sha256:400a4873b838d1b89194d982c45e5fb3cda4593fbfd7e08a02e76b03b21166f0', '--install', 'arm64']);
  run('docker', ['buildx', 'create', '--name', builder, '--driver', 'docker-container']);
  run('docker', ['buildx', 'build', '--builder', builder, '--platform', 'linux/amd64,linux/arm64',
    '--output', `type=oci,dest=${imageLayout},tar=false`, '--provenance=mode=max', '--sbom=true',
    '--tag', `hub-starter-candidate:${sourceSha}`, ...buildArgs,
    '--build-arg', `KUNGFU_PACKAGE_VERSION=${lock.kungfuPackageVersion}`,
    '--build-arg', `KUNGFU_SOURCE_SHA=${lock.kungfuSourceSha}`,
    '--build-arg', `SOURCE_REVISION=${sourceSha}`, '--build-arg', `RUNTIME_VERSION=${version}`, '.']);
} finally {
  for (const suffix of ['x64', 'arm64']) fs.unlinkSync(path.join(root, `kungfu-episodes-cli-linux-${suffix}.tar.gz`));
  try { run('docker', ['buildx', 'rm', builder]); } catch { /* Preserve the original build failure. */ }
}
const index = json(path.join(imageLayout, 'index.json'));
if (index.manifests.length !== 1) throw new Error('expected one complete image index');
const imageDigest = index.manifests[0].digest;
const platformEvidence = [];
for (const [architecture, mode, port] of [['amd64', 'initial', '18081'], ['arm64', 'platform', '18082']]) {
  const local = `hub-starter-candidate:${sourceSha}-${architecture}`;
  run('skopeo', ['copy', '--override-os', 'linux', '--override-arch', architecture, `oci:${imageLayout}`, `docker-daemon:${local}`]);
  const evidence = path.join(output, `hub-image-smoke-linux-${architecture}.json`);
  run('bash', ['scripts/smoke-image.sh', local, evidence], {
    env: { ...process.env, COURSE_SMOKE_MODE: mode, COURSE_SMOKE_PORT: port },
  });
  const observed = json(evidence);
  if (!observed.freshInstall || !observed.restartPersistence || !(mode === 'platform' ? observed.courseApiContract : observed.stateRoot)) throw new Error(`image smoke failed: ${architecture}`);
  platformEvidence.push({ platform: `linux/${architecture}`, path: path.basename(evidence), sha256: sha256(fs.readFileSync(evidence)), policy: mode === 'platform' ? 'qemu-platform-contract' : 'native-full-lifecycle' });
}
const project = composeProject(fs.readFileSync('compose.yaml', 'utf8'), imageDigest);
const compose = writeComposeLayout({ root: path.join(output, 'compose'), project });
const projectPath = path.join(output, 'compose-source.json');
fs.writeFileSync(projectPath, JSON.stringify(project, null, 2));
run('docker', ['compose', '-f', projectPath, 'config', '--quiet']);
const smoke = (name, details) => {
  const filename = `${name}-smoke.json`;
  const bytes = Buffer.from(`${JSON.stringify({ schema: 1, image: name, passed: true, ...details }, null, 2)}\n`);
  fs.writeFileSync(path.join(output, filename), bytes);
  return { path: filename, sha256: sha256(bytes) };
};
const body = {
  schema: 'kungfu-buildchain-oci-family/v2', repository: 'kungfu-systems/runtime-images', sourceSha, version,
  expectedImages: ['hub-starter', 'hub-starter-compose'],
  images: [
    { name: 'hub-starter', kind: 'image', repository: imageRepository, digest: imageDigest, layout: 'image',
      platform: 'multi-platform', platforms: ['linux/amd64', 'linux/arm64'], action: 'built', content: { sourceSha, version },
      smoke: smoke('hub-starter', { policy: 'candidate-platform-smoke', platforms: platformEvidence }) },
    { name: 'hub-starter-compose', kind: 'compose', targetImage: 'hub-starter', repository: imageRepository,
      digest: compose.digest, layout: 'compose', platform: 'compose', action: 'built', content: { sourceSha, version },
      preview: { alias: 'compose-preview', previousDigest, qualificationWorkflow: '.github/workflows/qualify-release.yml' },
      smoke: smoke('hub-starter-compose', { policy: 'compose-config-and-exact-image-contract', publicInstallationQualified: false }) },
  ],
};
const family = sealOciPublicationBundle({ bundleRoot: output, body });
fs.writeFileSync(path.join(output, 'oci-family.json'), `${JSON.stringify(family, null, 2)}\n`);
console.log(`Sealed dual-platform image and Compose: ${family.root}`);
