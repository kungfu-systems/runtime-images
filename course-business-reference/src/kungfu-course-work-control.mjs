// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

export const KUNGFU_COURSE_WORK_SCHEMA = 'course.kungfu-work-control/v1';
const ROOT_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const digest = (value) =>
  `sha256:${createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex')}`;

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};

const objectRoot = (value) => digest(JSON.stringify(canonicalize(value)));

const safeEpisodeId = (seed) =>
  String(Number.parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 12), 16));

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeBytesImmutable(path, bytes) {
  try {
    const current = await readFile(path);
    if (!current.equals(bytes)) throw new Error(`immutable evidence changed: ${path}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, bytes, { mode: 0o600 });
    await rename(temporary, path);
  }
}

function parseJson(stdout, args) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Kungfu returned non-JSON for ${args.join(' ')}: ${error.message}`);
  }
}

function assertUuid(value, label) {
  if (!UUID_PATTERN.test(String(value))) throw new Error(`invalid ${label}`);
  return String(value);
}

export class KungfuCourseWorkControl {
  constructor({
    stateRoot,
    kungfuBin,
    packageSha256 = process.env.KUNGFU_PACKAGE_SHA256
      ?? (process.arch === 'arm64'
        ? process.env.KUNGFU_PACKAGE_SHA256_ARM64
        : process.env.KUNGFU_PACKAGE_SHA256_AMD64)
      ?? '',
    sourceSha = process.env.KUNGFU_SOURCE_SHA ?? '',
    runImplementation = null,
  }) {
    this.stateRoot = stateRoot;
    this.kungfuBin = kungfuBin;
    this.packageSha256 = packageSha256;
    this.sourceSha = sourceSha;
    this.runImplementation = runImplementation;
    this.courseQueues = new Map();
  }

  bindingId(courseId) {
    return `kungfu:course:${assertUuid(courseId, 'course id')}`;
  }

  paths(courseId, versionId) {
    const course = assertUuid(courseId, 'course id');
    const version = assertUuid(versionId, 'version id');
    const root = join(this.stateRoot, 'kungfu-courses', course);
    return {
      root,
      workspace: join(root, 'workspace'),
      runtimeHome: join(root, 'workspace', '.kungfu'),
      control: join(root, 'control'),
      request: join(root, 'control', `request-${version}.json`),
      artifact: join(root, 'control', `outline-${version}.json`),
      claim: join(root, 'control', `claim-${version}.json`),
      review: join(root, 'control', `review-${version}.json`),
      decision: join(root, 'control', `decision-${version}.json`),
      settlement: join(root, 'control', `settlement-${version}.json`),
    };
  }

  async run(args, { home, timeoutMs = 120_000 } = {}) {
    if (this.runImplementation) return this.runImplementation(args, { home, timeoutMs });
    return new Promise((resolve, reject) => {
      const child = spawn(this.kungfuBin, args, {
        env: { ...process.env, KUNGFU_LOG_LEVEL: 'warning' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const limit = 8 * 1024 * 1024;
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (stdout.length > limit) child.kill('SIGKILL');
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
        if (stderr.length > limit) child.kill('SIGKILL');
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      child.once('error', reject);
      child.once('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`Kungfu command failed (${code}): ${args.join(' ')}\n${stderr || stdout}`));
          return;
        }
        resolve(parseJson(stdout, args));
      });
    });
  }

  async status(paths, initiativeId, assignmentId) {
    return this.run([
      'work', 'status',
      '--workspace', paths.workspace,
      '--initiative-id', initiativeId,
      '--assignment-id', assignmentId,
    ], { home: paths.root });
  }

  async inspectEvidence(paths, episodeId) {
    try {
      return await this.run([
        '-H', paths.runtimeHome,
        'storage', 'episode', 'inspect',
        '--episode-id', episodeId,
        '--json',
      ], { home: paths.root });
    } catch (error) {
      if (/not found|does not exist|unknown Episode|absent/iu.test(error.message)) return null;
      throw error;
    }
  }

  serialize(courseId, operation) {
    const prior = this.courseQueues.get(courseId) ?? Promise.resolve();
    const current = prior.catch(() => {}).then(operation).finally(() => {
      if (this.courseQueues.get(courseId) === current) this.courseQueues.delete(courseId);
    });
    this.courseQueues.set(courseId, current);
    return current;
  }

  async settleVersion(input) {
    return this.serialize(input.courseId, () => this.runSettlement(input));
  }

  async runSettlement({
    courseId,
    versionId,
    courseTitle,
    action,
    generator,
    outline,
  }) {
    const paths = this.paths(courseId, versionId);
    const bindingId = this.bindingId(courseId);
    const initiativeId = `course-${courseId}`;
    const assignmentId = `course-outline-${versionId}`;
    await mkdir(paths.workspace, { recursive: true });
    await mkdir(paths.control, { recursive: true });
    try {
      const prior = await readJson(paths.settlement);
      const status = await this.status(paths, initiativeId, assignmentId);
      if (prior.seal?.stateRoot && status.phase === 'continuation-decided') {
        return { ...prior, nativePhase: status.phase, queryProofRoot: status.query_proof_root };
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    const artifact = {
      schema: 'course.outline-evidence/v1',
      bindingId,
      courseId,
      versionId,
      action,
      generator,
      outline,
    };
    const artifactBytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
    const artifactRoot = digest(artifactBytes);
    await writeBytesImmutable(paths.artifact, artifactBytes);
    const request = {
      schema: 'kungfu.assignment-request/v1',
      source: {
        kind: 'course-hub-generation',
        sourceId: `${bindingId}:${versionId}`,
      },
      retention: { policy: 'explicit-expiry-retain-bytes-v1', expiresAt: null },
      workDefinition: {
        initiative_id: initiativeId,
        assignment_id: assignmentId,
        title: `${String(courseTitle).slice(0, 80)} · ${action === 'revise_outline' ? 'revision' : 'draft'}`,
        objective: 'Generate one schema-valid course outline from the saved creator brief and preserve the exact result as reviewable Evidence before committing the reserved course version.',
        owner_agent: 'course-outline-agent',
        responsibility: 'one bounded course-outline generation result',
        acceptance: [
          'The persisted Evidence payload identifies the course and reserved immutable PostgreSQL version.',
          'The outline contains a title, audience, promise, delivery, creator advantage, exactly three modules, and open questions.',
          'Every module contains a title, outcome, lessons, and one observable exercise.',
          'The generator identity and delivery mode are preserved with the output.',
        ],
      },
    };
    await writeJsonAtomic(paths.request, request);
    const captured = await this.run([
      'work', 'capture',
      '--request', paths.request,
      '--workspace', paths.workspace,
      '--json',
    ], { home: paths.root });
    const admitted = await this.run([
      'work', 'admit', captured.requestPath,
      '--workspace', paths.workspace,
      '--actor', 'course-hub',
      '--actor-type', 'agent',
    ], { home: paths.root });
    const leaseExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString();
    const claimed = await this.run([
      'work', 'claim',
      '--workspace', paths.workspace,
      '--initiative-id', initiativeId,
      '--assignment-id', assignmentId,
      '--owner', 'course-owner',
      '--agent', 'course-outline-agent',
      '--slot', `version-${versionId}`,
      '--lease-id', `lease-${versionId}`,
      '--lease-expires-at', leaseExpiresAt,
      '--authorized-by', 'course-hub',
      '--actor-type', 'agent',
    ], { home: paths.root });
    let current = claimed.status ?? await this.status(paths, initiativeId, assignmentId);
    if (current.phase === 'execution-claimed') {
      const kickedOff = await this.run([
        'work', 'kickoff',
        '--workspace', paths.workspace,
        '--initiative-id', initiativeId,
        '--assignment-id', assignmentId,
        '--actor', 'course-outline-agent',
        '--reason', 'The selected generator returned a schema-valid outline',
      ], { home: paths.root });
      current = kickedOff.status ?? await this.status(paths, initiativeId, assignmentId);
    }
    if (current.phase === 'executing') {
      const staged = await this.run([
        'work', 'stage',
        '--workspace', paths.workspace,
        '--initiative-id', initiativeId,
        '--assignment-id', assignmentId,
        '--actor', 'course-outline-agent',
        '--reason', 'The exact generated outline is persisted and ready for evidence review',
      ], { home: paths.root });
      current = staged.status ?? await this.status(paths, initiativeId, assignmentId);
    }

    const episodeId = safeEpisodeId(`${courseId}:${versionId}:outline`);
    const acceptanceRoot = digest('course.outline-evidence.acceptance/v1');
    const proofRoots = [
      captured.requestRoot,
      artifactRoot,
      /^[0-9a-f]{64}$/u.test(this.packageSha256) ? `sha256:${this.packageSha256}` : '',
      this.sourceSha ? digest(this.sourceSha) : '',
    ].filter((value) => ROOT_PATTERN.test(value));
    let completionClaim = current.completion_claims?.[0] ?? null;
    if (!completionClaim) {
      let evidenceInspection = await this.inspectEvidence(paths, episodeId);
      if (!evidenceInspection) {
        await this.run([
          '-H', paths.runtimeHome,
          'storage', 'episode', 'begin',
          '--episode-id', episodeId,
          '--title', 'Generated course outline Evidence',
          '--actor', 'course-outline-agent',
          '--source', generator.delivery === 'mock' ? 'explicit-mock-generator' : 'selected-inference-provider',
          '--json',
        ], { home: paths.root });
        evidenceInspection = await this.inspectEvidence(paths, episodeId);
      }
      if (!evidenceInspection?.episode?.closed) {
        const expectedRefId = `outline-${versionId}.json`;
        const attached = evidenceInspection?.records?.some((record) =>
          record.ref_id === expectedRefId && record.ref_hash === artifactRoot);
        if (!attached) {
          await this.run([
            '-H', paths.runtimeHome,
            'storage', 'episode', 'attach-payload',
            '--episode-id', episodeId,
            '--path', paths.artifact,
            '--ref-id', expectedRefId,
            '--content-hash', artifactRoot,
            '--json',
          ], { home: paths.root });
        }
        await this.run([
          '-H', paths.runtimeHome,
          'storage', 'episode', 'end',
          '--episode-id', episodeId,
          '--reason', 'The immutable generated outline payload is complete',
          '--json',
        ], { home: paths.root });
        evidenceInspection = await this.inspectEvidence(paths, episodeId);
      }
      if (!evidenceInspection?.ok || evidenceInspection.qualification?.status !== 'ok') {
        throw new Error('Kungfu Evidence Episode did not pass native qualification');
      }
      await writeJsonAtomic(paths.claim, {
        initiativeId,
        assignmentId,
        statement: 'The selected generator produced a schema-valid course outline; the reserved version identity and exact durable output are attached as Evidence.',
        actor: 'course-outline-agent',
        actorType: 'agent',
        source: 'kungfu',
        evidenceEpisodeIds: [Number(episodeId)],
        assignmentSet: [assignmentId],
        acceptanceRoot,
        proofRoots,
        knownGaps: [],
        evidenceAvailability: [
          { acceptance: 'persisted-course-outline', level: 'full', state: 'available' },
        ],
      });
      const completion = await this.run([
        'work', 'claim-completion', paths.claim,
        '--workspace', paths.workspace,
        '--authorized-by', 'course-outline-agent',
      ], { home: paths.root });
      current = completion.status ?? await this.status(paths, initiativeId, assignmentId);
      completionClaim = current.completion_claims?.find((row) =>
        row.claim_id === completion.claim?.claim_id) ?? completion.claim
        ?? current.completion_claims?.[0] ?? null;
    }
    if (!completionClaim) throw new Error('Kungfu did not expose the completion claim');
    await writeJsonAtomic(paths.review, {
      initiativeId,
      assignmentId,
      reviewer: 'course-outline-independent-reviewer',
      reviewerSource: 'course-hub-independent-review',
      source: 'kungfu',
      purpose: 'handoff',
      executorProfile: 'thread',
      proposedFollowups: [],
    });
    let reviewRecord = current.independent_reviews?.find((row) =>
      row.claim_id === completionClaim.claim_id) ?? null;
    let review = reviewRecord
      ? {
        review: reviewRecord,
        review_root: objectRoot(reviewRecord),
        continuation_plan_root: reviewRecord.continuation_plan_root,
      }
      : await this.run([
        'work', 'review', paths.review,
        '--workspace', paths.workspace,
        '--authorized-by', 'course-outline-independent-reviewer',
      ], { home: paths.root });
    reviewRecord = review.review;
    current = review.status ?? await this.status(paths, initiativeId, assignmentId);
    const allowed = review.review?.continuation_plan?.allowed_actions ?? [];
    const actionDecision = review.review?.verdict === 'fit' && allowed.includes('close')
      ? 'close'
      : allowed.includes('request-evidence')
        ? 'request-evidence'
        : null;
    if (!actionDecision) {
      throw new Error(`Kungfu review exposed no truthful continuation action: ${review.review?.verdict}`);
    }
    await writeJsonAtomic(paths.decision, {
      initiativeId,
      assignmentId,
      reviewId: review.review.review_id,
      expectedReviewRoot: review.review_root,
      expectedPlanRoot: review.continuation_plan_root,
      action: actionDecision,
      actor: 'course-hub-work-controller',
      actorType: 'agent',
      changeClass: 'mechanical',
      source: 'kungfu',
      reason: actionDecision === 'close'
        ? 'The persisted outline Evidence passed independent review.'
        : 'Independent review requires additional inspectable evidence.',
    });
    let decisionRecord = current.continuation_decisions?.find((row) =>
      row.review_id === reviewRecord.review_id) ?? null;
    const decision = decisionRecord
      ? { decision: decisionRecord, decision_root: objectRoot(decisionRecord) }
      : await this.run([
        'work', 'decide', paths.decision,
        '--workspace', paths.workspace,
        '--authorized-by', 'course-hub-work-controller',
      ], { home: paths.root });
    decisionRecord = decision.decision;
    let seal = null;
    if (actionDecision === 'close') {
      const plan = await this.run([
        'work', 'seal',
        '--workspace', paths.workspace,
        '--initiative-id', initiativeId,
        '--assignment-id', assignmentId,
      ], { home: paths.root });
      const sealed = await this.run([
        'work', 'seal',
        '--workspace', paths.workspace,
        '--initiative-id', initiativeId,
        '--assignment-id', assignmentId,
        '--execute',
        '--expected-state-root', plan.state_root,
      ], { home: paths.root });
      seal = {
        stateRoot: sealed.state_root ?? plan.state_root,
        queryProofRoot: sealed.query_proof_root ?? '',
      };
    }
    const status = await this.status(paths, initiativeId, assignmentId);
    if (seal && !seal.queryProofRoot) seal.queryProofRoot = status.query_proof_root ?? '';
    const evidenceRecord = completionClaim.evidence_episodes?.find((row) =>
      String(row.episode_id) === episodeId) ?? {};
    const settlement = {
      schema: KUNGFU_COURSE_WORK_SCHEMA,
      mode: 'kungfu-managed',
      bindingId,
      initiativeId,
      assignmentId,
      nativePhase: status.phase,
      requestRoot: captured.requestRoot,
      captureReceiptRoot: captured.receiptRoot,
      admissionEpisodeIds: [
        admitted.initiative_receipt?.receipt?.episode_id,
        admitted.assignment_receipt?.receipt?.episode_id,
      ].filter(Boolean),
      executionClaimId: claimed.claim?.claim_id ?? '',
      evidence: {
        episodeId,
        episodeRoot: evidenceRecord.episode_root ?? '',
        artifactRoot,
        versionId,
      },
      completionClaimId: completionClaim.claim_id ?? '',
      review: {
        id: review.review.review_id,
        verdict: review.review.verdict,
        root: review.review_root,
        reviewer: review.review.reviewer,
      },
      decision: {
        id: decisionRecord?.decision_id ?? '',
        action: actionDecision,
        root: decision.decision_root ?? objectRoot(decisionRecord),
      },
      seal,
      queryProofRoot: status.query_proof_root,
      authorityNotice: 'Kungfu native journal state is authoritative for work, Evidence, review, decision, and seal. PostgreSQL owns the course and immutable version.',
    };
    await writeJsonAtomic(paths.settlement, settlement);
    return settlement;
  }
}
