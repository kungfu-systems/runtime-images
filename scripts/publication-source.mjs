// SPDX-License-Identifier: Apache-2.0
export function verifyPublicationSource({ documents, family, readback, sourceSha }) {
  const source = documents.passport?.source;
  const candidate = documents.invocation?.candidate;
  if (!/^[0-9a-f]{40}$/u.test(sourceSha)
    || !/^[0-9a-f]{40}$/u.test(family.sourceSha)
    || !/^[0-9a-f]{40}$/u.test(candidate?.tree)
    || documents.product?.publication?.releaseSha !== sourceSha
    || candidate.commit !== sourceSha || source?.headSha !== sourceSha
    || source.builtSourceSha !== family.sourceSha
    || source.builtSourceTreeSha !== candidate.tree
    || readback.sourceSha !== sourceSha
    || readback.candidateSourceSha !== family.sourceSha) {
    throw new Error('publication source mismatch');
  }
}
