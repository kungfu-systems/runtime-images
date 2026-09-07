// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyPublicationSource } from '../scripts/publication-source.mjs';

function fixture(merged = true) {
  const sourceSha = 'a'.repeat(40), built = merged ? 'b'.repeat(40) : sourceSha, tree = 'c'.repeat(40);
  return { sourceSha, family: { sourceSha: built },
    documents: { passport: { source: { headSha: sourceSha, builtSourceSha: built, builtSourceTreeSha: tree } },
      invocation: { candidate: { commit: sourceSha, tree } }, product: { publication: { releaseSha: sourceSha } } },
    readback: { sourceSha, candidateSourceSha: built } };
}

test('public qualification accepts exact and tree-equivalent publication sources', () => {
  for (const merged of [false, true]) assert.doesNotThrow(() => verifyPublicationSource(fixture(merged)));
});

test('public qualification rejects drift in every built, release, tree and readback identity', () => {
  for (const change of [
    (input) => { input.documents.passport.source.builtSourceSha = 'd'.repeat(40); },
    (input) => { input.documents.passport.source.builtSourceTreeSha = 'd'.repeat(40); },
    (input) => { input.documents.passport.source.headSha = 'd'.repeat(40); },
    (input) => { input.documents.invocation.candidate.commit = 'd'.repeat(40); },
    (input) => { input.documents.product.publication.releaseSha = 'd'.repeat(40); },
    (input) => { input.readback.sourceSha = 'd'.repeat(40); },
    (input) => { input.readback.candidateSourceSha = 'd'.repeat(40); },
    (input) => { delete input.documents.passport.source.builtSourceTreeSha; },
    (input) => { input.sourceSha = 'latest'; },
  ]) {
    const input = fixture(); change(input);
    assert.throws(() => verifyPublicationSource(input), /publication source mismatch/);
  }
});
