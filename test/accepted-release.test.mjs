// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { verifyAcceptedRelease } from '../scripts/verify-accepted-release.mjs';

const read = (name) => JSON.parse(fs.readFileSync(new URL(name, import.meta.url)));
const fixture = () => ({ lock: read('../release/runtime.lock.json'), contract: read('../contracts/hub-starter-runtime.contract.json') });
test('accepted public Alpha and legacy transaction coordinates both validate', () => {
  const { lock, contract } = fixture();
  verifyAcceptedRelease(lock, contract);
  delete lock.release.publication;
  delete lock.release.preview;
  delete contract.release.publication;
  delete contract.release.preview;
  delete contract.release.previousComposePreviewDigest;
  lock.release.transactionStateRef = `refs/heads/buildchain/release-state/${lock.release.version.replaceAll('.', '-')}`;
  contract.release.transactionStateRef = lock.release.transactionStateRef;
  verifyAcceptedRelease(lock, contract);
  lock.release.transactionStateRef += '-wrong';
  contract.release.transactionStateRef = lock.release.transactionStateRef;
  assert.throws(() => verifyAcceptedRelease(lock, contract), /transaction state ref/);
});
test('accepted Alpha rejects contract drift and self-consistent but invalid evidence coordinates', () => {
  const mutations = [
    ({ contract }) => { contract.release.previousComposePreviewDigest = 'sha256:' + 'f'.repeat(64); },
    ({ contract }) => { contract.release.version = '1.0.0-alpha.999'; },
    ({ lock, contract }) => { lock.release.tag = contract.release.tag = 'v1.0.0-alpha.999'; },
    ({ lock, contract }) => { lock.release.composeApplication = contract.release.composeApplication = lock.release.composeApplication.replace(`:compose-${lock.release.tag}@`, ':compose-v1.0.0-alpha.999@'); },
    ({ lock, contract }) => { lock.imageSourceRevision = contract.release.sourceRevision = 'dev/v1/v1.0'; },
    ({ lock, contract }) => { lock.qualificationRun = contract.release.qualificationRun = 'https://github.com/other/repo/actions/runs/1'; },
    ({ lock, contract }) => { delete lock.release.publication.receiptRoot; delete contract.release.publication.receiptRoot; },
    ({ lock, contract }) => { lock.release.publication.evidence = contract.release.publication.evidence = 'https://example.org/settlement.json'; },
    ({ lock, contract }) => { lock.release.preview.qualificationAttempt = contract.release.preview.qualificationAttempt = 0; },
    ({ lock, contract }) => { lock.release.preview.evidence = contract.release.preview.evidence = lock.release.preview.evidence.replace(/-[0-9]+\.json$/u, '-999.json'); },
    ({ lock, contract }) => { lock.release.transactionStateRef = contract.release.transactionStateRef = 'refs/heads/buildchain/release-state/1-0-0-alpha-15'; },
  ];
  for (const mutate of mutations) {
    const value = fixture();
    mutate(value);
    assert.throws(() => verifyAcceptedRelease(value.lock, value.contract));
  }
});
