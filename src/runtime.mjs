// SPDX-License-Identifier: Apache-2.0

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const ROOT_PATTERN = /^sha256:[0-9a-f]{64}$/u;

function root(value) {
  return `sha256:${createHash('sha256').update(String(value)).digest('hex')}`;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
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

export class KungfuRuntime {
  constructor({
    stateRoot = process.env.HUB_STATE_ROOT || '/state',
    kungfuBin = process.env.KUNGFU_BIN || '/opt/kungfu/kungfu',
    kungfuPrefixArgs = JSON.parse(process.env.KUNGFU_PREFIX_ARGS || '[]'),
    packageSha256 = process.env.KUNGFU_PACKAGE_SHA256 || '',
    sourceSha = process.env.KUNGFU_SOURCE_SHA || '',
    instanceLabel = process.env.HUB_INSTANCE_LABEL || 'local',
    courseName = process.env.HUB_COURSE_NAME || 'AI Teaching Sprint',
  } = {}) {
    this.stateRoot = stateRoot;
    this.workspace = join(stateRoot, 'workspace');
    this.control = join(stateRoot, 'control');
    this.runtimeHome = join(this.workspace, '.kungfu');
    this.kungfuBin = kungfuBin;
    this.kungfuPrefixArgs = kungfuPrefixArgs;
    this.packageSha256 = packageSha256;
    this.sourceSha = sourceSha;
    this.instanceLabel = instanceLabel;
    this.courseName = courseName.trim().slice(0, 80) || 'AI Teaching Sprint';
    this.bootstrapPromise = null;
    this.settlePromise = null;
  }

  async run(args, { timeoutMs = 90_000 } = {}) {
    return new Promise((resolve, reject) => {
      const commandArgs = [...this.kungfuPrefixArgs, ...args];
      const child = spawn(this.kungfuBin, commandArgs, {
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
        if (code !== 0) {
          reject(new Error(`Kungfu command failed (${code}): ${commandArgs.join(' ')}\n${stderr || stdout}`));
          return;
        }
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
        title: `Prepare the ${this.courseName} course`,
        objective: `Complete the bounded course-team workflow for ${this.courseName} and inspect its native evidence.`,
        owner_agent: 'hub-starter',
        responsibility: 'development-only local course-team walkthrough',
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
    return {
      schema: 'kungfu.hub-starter.state/v1',
      claimBoundary: 'pre-alpha development candidate; not production, authenticated, or multi-user',
      instance: identity,
      package: { sha256: this.packageSha256, kungfuSourceSha: this.sourceSha },
      assignment: status,
      episodes,
      settlement,
      authority: {
        writes: 'Kungfu CLI public Assignment commands',
        web: 'read projection and bounded command adapter only',
        database: 'native Kungfu runtime; no second authority',
      },
    };
  }

  async settleDemo() {
    if (!this.settlePromise) {
      this.settlePromise = this.#settle().finally(() => { this.settlePromise = null; });
    }
    return this.settlePromise;
  }

  async #settle() {
    const { metadata } = await this.ensureBootstrap();
    const settlementPath = join(this.control, 'settlement.json');
    try {
      const settled = await readJson(settlementPath);
      if (!ROOT_PATTERN.test(settled.stateRoot || '')) {
        throw new Error('persisted settlement has no valid sealed state root');
      }
      return settled;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const status = await this.#status(metadata);
    if (status.phase === 'executing') {
      await this.run([
        'assignment', 'stage', '--workspace', this.workspace,
        '--initiative-id', metadata.initiativeId, '--assignment-id', metadata.assignmentId,
        '--actor', 'hub-starter', '--reason', 'Guided walkthrough is ready for completion review',
      ]);
    }
    const acceptanceRoot = root('hub-starter-guided-walkthrough/v1');
    const proofRoots = [metadata.requestRoot, root(this.packageSha256 || 'package-not-reported')]
      .filter((value) => ROOT_PATTERN.test(value));
    const claimInput = join(this.control, 'completion-claim.json');
    await writeJsonAtomic(claimInput, {
      missionId: metadata.initiativeId,
      goalId: metadata.assignmentId,
      statement: 'The local developer opened and inspected the bounded Hub Starter walkthrough.',
      actor: 'hub-starter-claimant',
      actorType: 'agent',
      source: 'kungfu',
      evidenceEpisodeIds: [],
      goSet: [metadata.assignmentId],
      acceptanceRoot,
      proofRoots,
      knownGaps: [],
      evidenceAvailability: [
        { acceptance: 'native-assignment-visible', level: 'thin', state: 'available' },
      ],
    });
    const claim = await this.run([
      'assignment', 'claim-completion', claimInput, '--workspace', this.workspace,
      '--authorized-by', 'hub-starter-claimant',
    ]);
    const reviewInput = join(this.control, 'completion-review.json');
    await writeJsonAtomic(reviewInput, {
      missionId: metadata.initiativeId,
      goalId: metadata.assignmentId,
      reviewer: 'hub-starter-reviewer',
      reviewerSource: 'hub-starter-independent-review',
      source: 'kungfu',
      purpose: 'completion-review',
      executorProfile: 'thread',
      proposedFollowups: [],
    });
    const review = await this.run([
      'assignment', 'review', reviewInput, '--workspace', this.workspace,
      '--authorized-by', 'hub-starter-reviewer',
    ]);
    const plan = review.review?.continuation_plan;
    const action = plan?.allowed_actions?.find((value) => value !== 'stop') || plan?.allowed_actions?.[0];
    if (!action) throw new Error('independent review exposed no bounded continuation action');
    const decisionInput = join(this.control, 'continuation-decision.json');
    await writeJsonAtomic(decisionInput, {
      missionId: metadata.initiativeId,
      goalId: metadata.assignmentId,
      reviewId: review.review.review_id,
      expectedReviewRoot: review.review_root,
      expectedPlanRoot: review.continuation_plan_root,
      action,
      actor: 'hub-starter-operator',
      actorType: 'agent',
      changeClass: 'mechanical',
      source: 'kungfu',
      reason: 'Record the independent walkthrough review without expanding scope.',
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
      claimId: claim.claim?.claim_id || claim.coreReceipt?.claim?.claim_id || null,
      reviewId: review.review.review_id,
      reviewRoot: review.review_root,
      verdict: review.review.verdict,
      decisionId: decision.decision?.decision_id || decision.coreReceipt?.decision?.decision_id || null,
      action,
      stateRoot: seal.stateRoot,
      sealedStatePath: seal.statePath,
      recordedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(settlementPath, settlement);
    return settlement;
  }
}
