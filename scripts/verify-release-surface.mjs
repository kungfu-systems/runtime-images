// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';

const read = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const workflow = (name) => YAML.parse(read(`.github/workflows/${name}.yml`));
const build = workflow('build');
const promotion = workflow('buildchain-ref-promotion');
const qualify = workflow('qualify-release');
const preview = workflow('compose-preview');
assert.equal(build.jobs.images.uses, 'kungfu-systems/buildchain/.github/workflows/build.yml@v4-alpha');
assert.equal(build.jobs.images.with['required-artifact-count'], undefined);
assert.equal(build.jobs.images.with['build-command'], 'npm run build:oci');
assert.equal(build.jobs.images.with['release-candidate'], true);
assert.equal(promotion.jobs.promote.uses, 'kungfu-systems/buildchain/.github/workflows/release-candidate-promote.yml@v4-alpha');
assert.equal(promotion.jobs.promote.with['publish-artifact-kind'], 'oci');
assert.equal(promotion.jobs.promote.with['required-artifact-count'], 1);
for (const field of ['release-passport', 'declarative-release-tail', 'github-release']) assert.equal(promotion.jobs.promote.with[field], true);
for (const level of ['kfd-1-witness-jsons', 'kfd-2-claim-jsons', 'kfd-3-prebuild-witness-jsons', 'kfd-3-artifact-witness-jsons']) {
  assert.ok(promotion.jobs.promote.with[`release-passport-${level}`].startsWith('.buildchain/kfd/'));
}
assert.equal(promotion.jobs.promote.steps, undefined);
assert.deepEqual(promotion.on.workflow_run.workflows, ['Verify']);
assert.ok(promotion.jobs.promote.if.includes("github.event.workflow_run.event == 'push'"));
assert.ok(promotion.jobs['reject-manual-apply']);
assert.deepEqual(qualify.permissions, { contents: 'read', packages: 'read' });
assert.equal(preview.jobs.preview.uses, 'kungfu-systems/buildchain/.github/workflows/public-release-oci-compose-preview.yml@v4-alpha');
assert.equal(preview.jobs.preview.steps, undefined);
assert.deepEqual(preview.on.workflow_run.workflows, ['Qualify Public OCI Release']);
assert.ok(read('scripts/publish-runtime-release.sh').includes('exit 2'));
const config = read('.buildchain/buildchain.toml');
assert.ok(config.includes('[lifecycle.verify]'));
assert.ok(!config.includes('[lifecycle.publish]'));
const candidate = read('scripts/build-oci-candidate.mjs');
for (const text of ['linux/amd64,linux/arm64', 'type=oci', '--provenance=mode=max', '--sbom=true', 'sealOciPublicationBundle', 'sha256(bytes)', 'previousDigest']) assert.ok(candidate.includes(text), `candidate lacks ${text}`);
const qualification = read('scripts/qualify-runtime-release.sh');
for (const text of ['COURSE_SMOKE_MODE=platform', 'qemu-platform-contract', 'agent verify --json',
  'test "${upgrade_database_id_after}" = "${upgrade_database_id_before}"',
  'test "${rollback_database_id}" = "${upgrade_database_id_before}"',
  'COURSE_SMOKE_PHASE=upgrade', 'COURSE_SMOKE_PHASE=rollback', 'NetworkSettings.Ports["5432/tcp"] == null']) {
  assert.ok(qualification.includes(text), `public qualification lacks ${text}`);
}
assert.equal((qualification.match(/scripts\/smoke-image\.sh/gu) ?? []).length, 2);
assert.ok(qualification.indexOf('release-qualification.mjs" finish') > qualification.indexOf('COURSE_SMOKE_PHASE=rollback'));
for (const source of [candidate, qualification, read('scripts/release-qualification.mjs')]) {
  assert.ok(!/docker compose[^\n]*publish|imagetools create|docker push|down\s+-v/u.test(source), 'candidate/qualification acquired registry writes or destructive cleanup');
}
for (const file of fs.readdirSync(new URL('../.github/workflows', import.meta.url)).filter((name) => name.endsWith('.yml'))) {
  const source = read(`.github/workflows/${file}`);
  assert.ok(!source.includes('branch-protection-bypass-apps'), 'workflow retains a protection bypass');
  for (const match of source.matchAll(/uses:\s*kungfu-systems\/buildchain\/[^\s]+@(\S+)/gu)) {
    assert.ok(['v4', 'v4-alpha'].includes(match[1]), 'consumer must use floating v4 calls');
  }
}
console.log('Buildchain v4 OCI and qualified Compose preview boundaries passed');
