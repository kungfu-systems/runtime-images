// SPDX-License-Identifier: Apache-2.0
import { isDeepStrictEqual } from 'node:util';

const repository = 'kungfu-systems/runtime-images';
const imageRepository = `ghcr.io/${repository}/hub-starter`;
const root = /^sha256:[0-9a-f]{64}$/u;
const sha = /^[0-9a-f]{40}$/u;
const run = /^https:\/\/github\.com\/kungfu-systems\/runtime-images\/actions\/runs\/[1-9][0-9]*$/u;
const check = (condition, message) => { if (!condition) throw new Error(message); };

export function verifyAcceptedRelease(lock, contract) {
  const release = lock.release;
  const published = contract.release;
  check(/^1\.0\.0-alpha\.[1-9][0-9]*$/u.test(release?.version), 'accepted Alpha version is not exact');
  check(release.tag === `v${release.version}`, 'accepted Alpha tag differs from version');
  for (const key of ['version', 'tag', 'releaseRevision', 'promotionRun', 'composeApplication', 'transactionStateRef', 'publication', 'preview']) {
    check(isDeepStrictEqual(release[key], published?.[key]), `accepted Alpha contract differs on ${key}`);
  }
  check(lock.image === published?.image && lock.imageSourceRevision === published?.sourceRevision
    && lock.qualificationRun === published?.qualificationRun && contract.substitutionSeam?.officialAlpha === release.tag,
  'accepted Alpha image, source or qualification differs');
  check(sha.test(lock.imageSourceRevision) && sha.test(release.releaseRevision), 'accepted Alpha source is not exact');
  check(run.test(lock.qualificationRun) && run.test(release.promotionRun), 'accepted Alpha workflow run is not exact');
  check(lock.image.startsWith(`${imageRepository}@`) && root.test(lock.image.slice(imageRepository.length + 1)), 'accepted Alpha image is not pinned');
  const applicationPrefix = `${imageRepository}:compose-${release.tag}@`;
  check(release.composeApplication.startsWith(applicationPrefix)
    && root.test(release.composeApplication.slice(applicationPrefix.length)), 'accepted Alpha Compose version or digest differs');
  check(root.test(release.previousComposePreviewDigest), 'accepted Alpha previous preview is not pinned');
  if (release.publication || published.previousComposePreviewDigest !== undefined) {
    check(release.previousComposePreviewDigest === published.previousComposePreviewDigest, 'accepted Alpha previous preview differs');
  }
  if (release.publication) {
    check(release.transactionStateRef === undefined, 'v4 publication must use its public settlement roots');
    const publication = release.publication;
    const preview = release.preview;
    const publicAssets = `https://github.com/${repository}/releases/download/${release.tag}/`;
    check(publication.kind === 'buildchain-v4' && publication.evidence === `${publicAssets}buildchain-publication-settlement.json`
      && run.test(publication.run), 'accepted Alpha public settlement coordinate differs');
    for (const key of ['receiptRoot', 'transactionRoot', 'stateRoot', 'planRoot', 'familyRoot']) {
      check(root.test(publication[key]), `accepted Alpha publication ${key} is missing`);
    }
    const qualificationRunId = lock.qualificationRun.split('/').at(-1);
    check(Number.isSafeInteger(preview?.qualificationAttempt) && preview.qualificationAttempt > 0
      && preview.evidence === `${publicAssets}buildchain-compose-preview-${qualificationRunId}-${preview.qualificationAttempt}.json`
      && root.test(preview.receiptRoot) && root.test(preview.qualificationRoot), 'accepted Alpha preview evidence is not bound to qualification');
  } else {
    check(release.preview === undefined && release.transactionStateRef === `refs/heads/buildchain/release-state/${release.version.replaceAll('.', '-')}`,
      'legacy Alpha transaction state ref differs from version');
  }
}
