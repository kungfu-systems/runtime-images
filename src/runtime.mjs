// SPDX-License-Identifier: Apache-2.0

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const ROOT_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const COURSE_SCHEMA = 'kungfu.hub-starter.coursework/v1';
const OUTLINE_SCHEMA = 'kungfu.hub-starter.course-outline/v1';
const OUTLINE_SECTIONS = [
  { title: 'Claims are not acceptance', objective: 'Separate an Agent completion claim from an accepted result.' },
  { title: 'Evidence makes work reviewable', objective: 'Bind a concrete artifact to a sealed Kungfu Episode.' },
  { title: 'Independent review drives follow-up', objective: 'Use review evidence to request work or close the homework.' },
];

function root(value) {
  const material = Buffer.isBuffer(value) ? value : String(value);
  return `sha256:${createHash('sha256').update(material).digest('hex')}`;
}

function safeEpisodeId(seed) {
  const hexadecimal = createHash('sha256').update(String(seed)).digest('hex').slice(0, 12);
  return String(Number.parseInt(hexadecimal, 16));
}

function reviewFor(status, claim) {
  return status.independent_reviews?.findLast((row) => row.claim_id === claim?.claim_id) || null;
}

function decisionFor(status, review) {
  return status.continuation_decisions?.findLast((row) => row.review_id === review?.review_id) || null;
}

export function projectCoursework(status, artifact = null, settlement = null) {
  const claims = status.completion_claims || [];
  const firstClaim = claims.find((row) => row.asserted_by === 'hub-starter-agent-round-1')
    || claims.find((row) => (row.evidence_episodes || []).length === 0)
    || null;
  const secondClaim = claims.find((row) => row.asserted_by === 'hub-starter-agent-round-2')
    || claims.find((row) => (row.evidence_episodes || []).length > 0)
    || null;
  const firstReview = reviewFor(status, firstClaim);
  const secondReview = reviewFor(status, secondClaim);
  const firstDecision = decisionFor(status, firstReview);
  const secondDecision = decisionFor(status, secondReview);
  const accepted = secondReview?.verdict === 'fit' && secondDecision?.action === 'close';
  const needsEvidence = firstReview?.verdict === 'insufficient'
    && firstDecision?.action === 'request-evidence';
  const state = accepted ? 'accepted' : needsEvidence ? 'needs-evidence' : 'ready';
  const primaryAction = state === 'ready'
    ? { id: 'submit-claim', label: 'Ask the Agent simulator to submit' }
    : state === 'needs-evidence'
      ? { id: 'add-evidence', label: 'Create evidence and request a new review' }
      : null;
  const latestClaim = secondClaim || firstClaim;
  const currentReview = secondReview || firstReview;
  const currentDecision = secondDecision || firstDecision;
  const evidenceEpisodes = latestClaim?.evidence_episodes || [];
  const timeline = [
    { id: 'assigned', label: 'Homework assigned', state: 'complete' },
    { id: 'claimed', label: 'Agent said the work was done', state: firstClaim ? 'complete' : 'current' },
    { id: 'checked', label: 'Independent reviewer checked the evidence', state: firstReview ? 'complete' : firstClaim ? 'current' : 'upcoming' },
    { id: 'followup', label: 'System requested the missing artifact', state: needsEvidence ? 'complete' : 'upcoming' },
    { id: 'resubmitted', label: 'Agent attached a reviewable course outline', state: secondClaim ? 'complete' : needsEvidence ? 'current' : 'upcoming' },
    { id: 'accepted', label: 'Independent reviewer accepted the homework', state: accepted ? 'complete' : 'upcoming' },
  ];
  return {
    schema: COURSE_SCHEMA,
    course: {
      title: status.assignment?.work_definition?.title || 'Agent/Kungfu Course',
      subtitle: 'A small course about evidence-based Agent work',
      lessonsCompleted: accepted ? 3 : needsEvidence ? 2 : 1,
      lessonsTotal: 3,
    },
    homework: {
      id: 'course-outline',
      title: 'Design the course outline',
      instruction: 'Create a three-section outline with one learning objective per section.',
      acceptance: {
        sectionCount: OUTLINE_SECTIONS.length,
        learningObjectiveCount: OUTLINE_SECTIONS.length,
      },
    },
    simulator: {
      label: 'Deterministic Agent simulator',
      disclosure: 'This demo runs a repeatable script. A long-running Agent can use the same claim, evidence, review, and decision contract later.',
    },
    submission: latestClaim ? {
      round: secondClaim ? 2 : 1,
      statement: latestClaim.statement,
      evidenceCount: evidenceEpisodes.length,
    } : null,
    independentCheck: currentReview ? {
      verdict: currentReview.verdict,
      summary: currentReview.verdict === 'fit'
        ? 'The course outline is attached as sealed evidence and satisfies the homework policy.'
        : 'The Agent said it was done, but no acceptable artifact was attached.',
      reviewer: 'Independent reviewer',
    } : null,
    evidence: {
      required: 'A sealed course-outline artifact with three sections and three learning objectives.',
      state: accepted ? 'satisfied' : needsEvidence ? 'missing' : 'not-checked',
      artifact: artifact ? {
        title: artifact.title,
        sectionCount: artifact.sections?.length || 0,
        learningObjectiveCount: artifact.sections?.filter((row) => row.objective).length || 0,
      } : null,
    },
    outcome: {
      state,
      label: accepted ? 'Homework accepted' : needsEvidence ? 'Evidence needed' : 'Ready for the Agent',
      explanation: accepted
        ? 'The second claim passed an independent evidence review.'
        : needsEvidence
          ? 'A claim alone is not acceptance. The system created a concrete follow-up action.'
          : 'The Agent can submit a claim, which will be checked independently.',
    },
    primaryAction,
    timeline,
    audit: {
      phase: status.phase,
      assignmentId: status.assignment_id,
      claimIds: claims.map((row) => row.claim_id),
      reviewIds: (status.independent_reviews || []).map((row) => row.review_id),
      decisionIds: (status.continuation_decisions || []).map((row) => row.decision_id),
      evidenceEpisodeIds: evidenceEpisodes.map((row) => String(row.episode_id)),
      queryProofRoot: status.query_proof_root,
      artifactRoot: artifact?.artifactRoot || null,
      stateRoot: settlement?.stateRoot || null,
      latestDecision: currentDecision?.action || null,
    },
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readArtifact(path) {
  const bytes = await readFile(path);
  return { ...JSON.parse(bytes.toString('utf8')), artifactRoot: root(bytes) };
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

function parseJsonOutput(stdout, args) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Kungfu returned non-JSON for ${args.join(' ')}: ${error.message}`);
  }
}

function installedPackageSha256() {
  if (process.env.KUNGFU_PACKAGE_SHA256) return process.env.KUNGFU_PACKAGE_SHA256;
  if (process.arch === 'arm64') return process.env.KUNGFU_PACKAGE_SHA256_ARM64 || '';
  if (process.arch === 'x64') return process.env.KUNGFU_PACKAGE_SHA256_AMD64 || '';
  return '';
}

export class KungfuRuntime {
  constructor({
    stateRoot = process.env.HUB_STATE_ROOT || '/state',
    kungfuBin = process.env.KUNGFU_BIN || '/opt/kungfu/kungfu',
    kungfuPrefixArgs = JSON.parse(process.env.KUNGFU_PREFIX_ARGS || '[]'),
    kungfuCwd = process.env.KUNGFU_CWD || '',
    packageSha256 = installedPackageSha256(),
    sourceSha = process.env.KUNGFU_SOURCE_SHA || '',
    instanceLabel = process.env.HUB_INSTANCE_LABEL || 'local',
    courseName = process.env.HUB_COURSE_NAME || 'Agent/Kungfu Course',
  } = {}) {
    this.stateRoot = stateRoot;
    this.workspace = join(stateRoot, 'workspace');
    this.control = join(stateRoot, 'control');
    this.runtimeHome = join(this.workspace, '.kungfu');
    this.kungfuBin = kungfuBin;
    this.kungfuPrefixArgs = kungfuPrefixArgs;
    this.kungfuCwd = kungfuCwd;
    this.packageSha256 = packageSha256;
    this.sourceSha = sourceSha;
    this.instanceLabel = instanceLabel;
    this.courseName = courseName.trim().slice(0, 80) || 'Agent/Kungfu Course';
    this.bootstrapPromise = null;
    this.actionPromise = null;
  }

  async run(args, { timeoutMs = 90_000 } = {}) {
    return new Promise((resolve, reject) => {
      const commandArgs = [...this.kungfuPrefixArgs, ...args];
      const commandSurface = args[0] === '-H'
        ? args.slice(2, 5).join(' ')
        : args.slice(0, 2).join(' ');
      const startedAt = Date.now();
      console.log(`[hub-starter] kungfu ${commandSurface} started`);
      const child = spawn(this.kungfuBin, commandArgs, {
        cwd: this.kungfuCwd || undefined,
        env: { ...process.env, HOME: this.stateRoot, KUNGFU_LOG_LEVEL: 'warning' },
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
        const durationMs = Date.now() - startedAt;
        if (code !== 0) {
          console.error(`[hub-starter] kungfu ${commandSurface} failed after ${durationMs}ms`);
          reject(new Error(`Kungfu command failed (${code}): ${commandArgs.join(' ')}\n${stderr || stdout}`));
          return;
        }
        console.log(`[hub-starter] kungfu ${commandSurface} completed in ${durationMs}ms`);
        resolve(parseJsonOutput(stdout, args));
      });
    });
  }

  async ensureBootstrap() {
    if (!this.bootstrapPromise) this.bootstrapPromise = this.#bootstrap();
    return this.bootstrapPromise;
  }

  async #bootstrap() {
    await mkdir(this.control, { recursive: true });
    await mkdir(this.workspace, { recursive: true });
    const identityPath = join(this.control, 'instance.json');
    let identity;
    try {
      identity = await readJson(identityPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      identity = {
        schema: 'kungfu.hub-starter.instance/v1',
        instanceId: randomUUID(),
        label: this.instanceLabel,
        createdAt: new Date().toISOString(),
      };
      await writeJsonAtomic(identityPath, identity);
    }
    const assignmentId = `hub-starter-${identity.instanceId}`;
    const initiativeId = `hub-starter-${identity.instanceId.slice(0, 12)}`;
    const metadataPath = join(this.control, 'bootstrap.json');
    let metadata;
    try {
      metadata = await readJson(metadataPath);
      await this.#status(metadata);
      return { identity, metadata };
    } catch (error) {
      if (metadata || error.code !== 'ENOENT') {
        throw new Error(`persisted Hub state is not readable; refusing destructive reinitialization: ${error.message}`);
      }
    }

    const request = {
      schema: 'kungfu.assignment-request/v1',
      source: { kind: 'hub-starter-guided-work', sourceId: assignmentId },
      retention: { policy: 'explicit-expiry-retain-bytes-v1', expiresAt: null },
      workDefinition: {
        goal_id: assignmentId,
        mission_id: initiativeId,
        title: this.courseName,
        objective: 'Design a three-section course outline with one learning objective per section.',
        owner_agent: 'hub-starter',
        responsibility: 'development-only single-user coursework walkthrough',
        acceptance: [
          'The course outline contains exactly three sections.',
          'Each section contains one non-empty learning objective.',
          'The submitted artifact is bound to a sealed Kungfu Evidence Episode.',
          'An independent reviewer, not the claimant, returns a fit verdict.',
        ],
      },
    };
    const requestPath = join(this.control, 'assignment-request.json');
    await writeJsonAtomic(requestPath, request);
    const captured = await this.run([
      'assignment', 'capture', '--request', requestPath, '--workspace', this.workspace, '--json',
    ]);
    const admitted = await this.run([
      'assignment', 'admit', captured.requestPath, '--workspace', this.workspace,
      '--actor', 'hub-starter', '--actor-type', 'agent',
    ]);
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const claimed = await this.run([
      'assignment', 'claim', '--workspace', this.workspace,
      '--initiative-id', initiativeId, '--assignment-id', assignmentId,
      '--owner', 'local-developer', '--agent', 'hub-starter', '--slot', identity.instanceId,
      '--lease-id', `lease-${identity.instanceId}`, '--lease-expires-at', expires,
      '--authorized-by', 'local-developer', '--actor-type', 'user',
    ]);
    const kickedOff = await this.run([
      'assignment', 'kickoff', '--workspace', this.workspace,
      '--initiative-id', initiativeId, '--assignment-id', assignmentId,
      '--actor', 'hub-starter', '--reason', 'Hub Starter became semantically ready',
    ]);
    metadata = {
      schema: 'kungfu.hub-starter.bootstrap/v1',
      initiativeId,
      assignmentId,
      requestRoot: captured.requestRoot,
      captureReceiptRoot: captured.receiptRoot,
      admissionEpisodeIds: [
        admitted.initiative_receipt?.receipt?.episode_id,
        admitted.assignment_receipt?.receipt?.episode_id,
      ].filter(Boolean),
      claimReceiptEpisodeId: claimed.receipt?.episode_id || null,
      kickoffReceiptEpisodeId: kickedOff.receipt?.episode_id || null,
      packageSha256: this.packageSha256,
      kungfuSourceSha: this.sourceSha,
      readyAt: new Date().toISOString(),
    };
    await writeJsonAtomic(metadataPath, metadata);
    return { identity, metadata };
  }

  async #status(metadata) {
    return this.run([
      'assignment', 'status', '--workspace', this.workspace,
      '--initiative-id', metadata.initiativeId, '--assignment-id', metadata.assignmentId,
    ]);
  }

  async readiness() {
    const { identity, metadata } = await this.ensureBootstrap();
    const status = await this.#status(metadata);
    console.log(`[hub-starter] assignment readiness phase=${status.phase}`);
    return { identity, status };
  }

  async state() {
    const { identity, metadata } = await this.ensureBootstrap();
    const status = await this.#status(metadata);
    let episodes = { episodes: [] };
    try {
      episodes = await this.run(['-H', this.runtimeHome, 'storage', 'episode', 'list', '--json']);
    } catch (error) {
      episodes = { episodes: [], projectionError: error.message };
    }
    let settlement = null;
    try {
      settlement = await readJson(join(this.control, 'settlement.json'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    let artifact = null;
    try {
      artifact = await readArtifact(join(this.control, 'course-outline.json'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return {
      schema: 'kungfu.hub-starter.state/v1',
      claimBoundary: 'pre-alpha development candidate; not production, authenticated, or multi-user',
      instance: identity,
      package: { sha256: this.packageSha256, kungfuSourceSha: this.sourceSha },
      assignment: status,
      episodes,
      settlement,
      coursework: projectCoursework(status, artifact, settlement),
      authority: {
        writes: 'Kungfu CLI public Assignment commands',
        web: 'read projection and bounded command adapter only',
        database: 'native Kungfu runtime; no second authority',
      },
    };
  }

  async submitFirstAttempt() {
    return this.#serialize(() => this.#firstAttempt());
  }

  async submitEvidenceAttempt() {
    return this.#serialize(() => this.#evidenceAttempt());
  }

  async settleDemo() {
    return this.#serialize(async () => {
      await this.#firstAttempt();
      return this.#evidenceAttempt();
    });
  }

  async #serialize(operation) {
    if (!this.actionPromise) {
      this.actionPromise = operation().finally(() => { this.actionPromise = null; });
    }
    return this.actionPromise;
  }

  async #firstAttempt() {
    const { metadata } = await this.ensureBootstrap();
    let status = await this.#status(metadata);
    if (status.completion_claim_count > 0) return this.state();
    if (status.phase === 'executing') {
      await this.run([
        'assignment', 'stage', '--workspace', this.workspace,
        '--initiative-id', metadata.initiativeId, '--assignment-id', metadata.assignmentId,
        '--actor', 'hub-starter', '--reason', 'Course-outline homework is ready for the first Agent submission',
      ]);
    }
    const acceptanceRoot = root('hub-starter-course-outline-acceptance/v1');
    const proofRoots = [metadata.requestRoot, root(this.packageSha256 || 'package-not-reported')]
      .filter((value) => ROOT_PATTERN.test(value));
    const claimInput = join(this.control, 'completion-claim-round-1.json');
    await writeJsonAtomic(claimInput, {
      missionId: metadata.initiativeId,
      goalId: metadata.assignmentId,
      statement: 'I completed the three-section Agent/Kungfu course outline.',
      actor: 'hub-starter-agent-round-1',
      actorType: 'agent',
      source: 'kungfu',
      evidenceEpisodeIds: [],
      goSet: [metadata.assignmentId],
      acceptanceRoot,
      proofRoots,
      knownGaps: [],
      evidenceAvailability: [
        { acceptance: 'sealed-course-outline-artifact', level: 'full', state: 'missing' },
      ],
    });
    await this.run([
      'assignment', 'claim-completion', claimInput, '--workspace', this.workspace,
      '--authorized-by', 'hub-starter-agent-round-1',
    ]);
    const reviewInput = join(this.control, 'completion-review-round-1.json');
    await writeJsonAtomic(reviewInput, {
      missionId: metadata.initiativeId,
      goalId: metadata.assignmentId,
      reviewer: 'hub-starter-reviewer-round-1',
      reviewerSource: 'hub-starter-independent-review-round-1',
      source: 'kungfu',
      purpose: 'completion-review',
      executorProfile: 'thread',
      proposedFollowups: [],
    });
    const review = await this.run([
      'assignment', 'review', reviewInput, '--workspace', this.workspace,
      '--authorized-by', 'hub-starter-reviewer-round-1',
    ]);
    if (review.review?.verdict !== 'insufficient') {
      throw new Error(`first review must remain insufficient without evidence; got ${review.review?.verdict}`);
    }
    if (!review.review.continuation_plan?.allowed_actions?.includes('request-evidence')) {
      throw new Error('first review did not expose the required request-evidence action');
    }
    const decisionInput = join(this.control, 'continuation-decision-round-1.json');
    await writeJsonAtomic(decisionInput, {
      missionId: metadata.initiativeId,
      goalId: metadata.assignmentId,
      reviewId: review.review.review_id,
      expectedReviewRoot: review.review_root,
      expectedPlanRoot: review.continuation_plan_root,
      action: 'request-evidence',
      actor: 'hub-starter-operator',
      actorType: 'agent',
      changeClass: 'mechanical',
      source: 'kungfu',
      reason: 'The Agent claim has no sealed course-outline artifact, so request that evidence.',
    });
    await this.run([
      'assignment', 'decide', decisionInput, '--workspace', this.workspace,
      '--authorized-by', 'hub-starter-operator',
    ]);
    status = await this.#status(metadata);
    const projected = projectCoursework(status);
    if (projected.outcome.state !== 'needs-evidence') {
      throw new Error('first coursework round did not reach the evidence-needed state');
    }
    return this.state();
  }

  async #evidenceAttempt() {
    const { identity, metadata } = await this.ensureBootstrap();
    const settlementPath = join(this.control, 'settlement.json');
    let status = await this.#status(metadata);
    if (status.completion_claim_count < 1) {
      throw new Error('submit the first Agent claim before creating follow-up evidence');
    }
    const existing = projectCoursework(status);
    let priorSettlement = null;
    try {
      priorSettlement = await readJson(settlementPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (existing.outcome.state === 'accepted' && ROOT_PATTERN.test(priorSettlement?.stateRoot || '')) {
      return this.state();
    }
    if (!['needs-evidence', 'accepted'].includes(existing.outcome.state)) {
      throw new Error('independent review has not requested evidence for this homework');
    }
    const artifact = {
      schema: OUTLINE_SCHEMA,
      homeworkId: 'course-outline',
      title: `${this.courseName}: course outline`,
      sections: OUTLINE_SECTIONS,
    };
    if (artifact.sections.length !== 3 || artifact.sections.some((row) => !row.objective.trim())) {
      throw new Error('deterministic course outline does not satisfy the declared acceptance properties');
    }
    const artifactPath = join(this.control, 'course-outline.json');
    let recordedArtifact;
    if (status.completion_claim_count < 2) {
      await writeJsonAtomic(artifactPath, artifact);
      recordedArtifact = await readArtifact(artifactPath);
      const episodeId = safeEpisodeId(`${identity.instanceId}:course-outline:v1`);
      const begun = await this.run([
        '-H', this.runtimeHome, 'storage', 'episode', 'begin',
        '--episode-id', episodeId,
        '--title', 'Course outline evidence', '--actor', 'hub-starter-agent-round-2',
        '--source', 'hub-starter-deterministic-agent', '--json',
      ]);
      if (String(begun.episode_id) !== episodeId) {
        throw new Error('Kungfu did not preserve the requested safe Evidence Episode id');
      }
      await this.run([
        '-H', this.runtimeHome, 'storage', 'episode', 'attach-payload',
        '--episode-id', episodeId, '--path', artifactPath, '--ref-id', 'course-outline.json',
        '--content-hash', recordedArtifact.artifactRoot, '--json',
      ]);
      await this.run([
        '-H', this.runtimeHome, 'storage', 'episode', 'end',
        '--episode-id', episodeId,
        '--reason', 'The deterministic course outline artifact is complete and ready for independent review',
        '--json',
      ]);
      const acceptanceRoot = root('hub-starter-course-outline-acceptance/v1');
      const claimInput = join(this.control, 'completion-claim-round-2.json');
      await writeJsonAtomic(claimInput, {
        missionId: metadata.initiativeId,
        goalId: metadata.assignmentId,
        statement: 'I completed the course outline and attached the requested artifact evidence.',
        actor: 'hub-starter-agent-round-2',
        actorType: 'agent',
        source: 'kungfu',
        evidenceEpisodeIds: [Number(episodeId)],
        goSet: [metadata.assignmentId],
        acceptanceRoot,
        proofRoots: [metadata.requestRoot, recordedArtifact.artifactRoot],
        knownGaps: [],
        evidenceAvailability: [
          { acceptance: 'sealed-course-outline-artifact', level: 'full', state: 'available' },
        ],
      });
      await this.run([
        'assignment', 'claim-completion', claimInput, '--workspace', this.workspace,
        '--authorized-by', 'hub-starter-agent-round-2',
      ]);
    } else {
      recordedArtifact = await readArtifact(artifactPath);
      const evidenceBackedClaim = status.completion_claims.find(
        (row) => row.asserted_by === 'hub-starter-agent-round-2',
      );
      if ((evidenceBackedClaim?.evidence_episodes || []).length !== 1) {
        throw new Error('persisted second claim does not bind exactly one Evidence Episode');
      }
    }
    const reviewInput = join(this.control, 'completion-review-round-2.json');
    await writeJsonAtomic(reviewInput, {
      missionId: metadata.initiativeId,
      goalId: metadata.assignmentId,
      reviewer: 'hub-starter-reviewer-round-2',
      reviewerSource: 'hub-starter-independent-review-round-2',
      source: 'kungfu',
      purpose: 'handoff',
      executorProfile: 'thread',
      proposedFollowups: [],
    });
    const review = await this.run([
      'assignment', 'review', reviewInput, '--workspace', this.workspace,
      '--authorized-by', 'hub-starter-reviewer-round-2',
    ]);
    if (review.review?.verdict !== 'fit') {
      throw new Error(`evidence-backed review must be fit before acceptance; got ${review.review?.verdict}`);
    }
    if (!review.review.continuation_plan?.allowed_actions?.includes('close')) {
      throw new Error('fit review did not expose the required close action');
    }
    const decisionInput = join(this.control, 'continuation-decision-round-2.json');
    await writeJsonAtomic(decisionInput, {
      missionId: metadata.initiativeId,
      goalId: metadata.assignmentId,
      reviewId: review.review.review_id,
      expectedReviewRoot: review.review_root,
      expectedPlanRoot: review.continuation_plan_root,
      action: 'close',
      actor: 'hub-starter-operator',
      actorType: 'agent',
      changeClass: 'mechanical',
      source: 'kungfu',
      reason: 'The sealed course-outline evidence passed independent review.',
    });
    const decision = await this.run([
      'assignment', 'decide', decisionInput, '--workspace', this.workspace,
      '--authorized-by', 'hub-starter-operator',
    ]);
    const sealPlan = await this.run([
      'assignment', 'seal', '--workspace', this.workspace,
      '--initiative-id', metadata.initiativeId, '--assignment-id', metadata.assignmentId,
    ]);
    const seal = await this.run([
      'assignment', 'seal', '--workspace', this.workspace,
      '--initiative-id', metadata.initiativeId, '--assignment-id', metadata.assignmentId,
      '--execute', '--expected-state-root', sealPlan.state_root,
    ]);
    const settlement = {
      schema: 'kungfu.hub-starter.settlement/v1',
      reviewId: review.review.review_id,
      reviewRoot: review.review_root,
      verdict: review.review.verdict,
      decisionId: decision.decision?.decision_id || decision.coreReceipt?.decision?.decision_id || null,
      action: 'close',
      stateRoot: seal.stateRoot,
      sealedStatePath: seal.statePath,
      recordedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(settlementPath, settlement);
    status = await this.#status(metadata);
    if (projectCoursework(status, recordedArtifact, settlement).outcome.state !== 'accepted') {
      throw new Error('second coursework round did not reach the accepted state');
    }
    return this.state();
  }
}
