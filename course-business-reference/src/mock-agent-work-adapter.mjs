// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import {
  AGENT_WORK_CONTRACT,
  AgentWorkPort,
  assertAgentWorkView,
  assertCommand,
} from './agent-work-port.mjs';

const bindingFor = (source) => `mock:${createHash('sha256').update(source).digest('hex').slice(0, 24)}`;
const transitionFor = (binding, version) => `mock-transition:${binding.slice(5)}:${version}`;

function allowedActions(row) {
  return row.latest_output
    ? ['revise_outline', 'generate_outline']
    : ['generate_outline'];
}

function text(value, fallback) {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function generateOutline(payload, revision) {
  const title = text(payload.title, 'Untitled course');
  const targetLearner = text(payload.targetLearner, 'A clearly defined learner');
  const learnerProblem = text(payload.learnerProblem, 'A costly problem worth solving');
  const promisedOutcome = text(payload.promisedOutcome, 'A concrete, observable result');
  const creatorExpertise = text(payload.creatorExpertise, 'Practical experience from the creator');
  const constraints = text(payload.deliveryConstraints, 'A focused, testable delivery format');
  const feedback = text(payload.feedback, 'Make the learning path more concrete and testable.');
  const previous = payload.previousOutline && typeof payload.previousOutline === 'object'
    ? payload.previousOutline
    : null;
  const revisionNote = revision
    ? `This revision responds to: ${feedback}`
    : 'This first draft turns the course brief into a teachable three-module path.';
  return {
    title,
    positioning: `For ${targetLearner}, this course addresses ${learnerProblem}`,
    audience: targetLearner,
    promise: promisedOutcome,
    delivery: constraints,
    creatorAdvantage: creatorExpertise,
    modules: [
      {
        number: 1,
        title: 'Define the learner and the real job',
        outcome: `Turn "${learnerProblem}" into one observable learner goal.`,
        lessons: ['Identify the learner context', 'Choose one costly problem', 'Write a measurable success statement'],
        exercise: 'Interview or observe one representative learner and record the exact language they use.',
      },
      {
        number: 2,
        title: 'Build the smallest useful learning path',
        outcome: `Sequence the creator's expertise into steps that lead toward "${promisedOutcome}".`,
        lessons: ['Select only essential knowledge', 'Order practice before explanation', 'Define one deliverable per lesson'],
        exercise: 'Create one before-and-after example that a learner can reproduce.',
      },
      {
        number: 3,
        title: revision ? 'Validate, revise, and prepare delivery' : 'Validate with a real learner',
        outcome: 'Test whether the promised result is understandable, achievable, and worth paying for.',
        lessons: ['Run a small pilot', 'Collect observable evidence', 'Revise the weakest step'],
        exercise: 'Ask one learner to complete the final task and document where they become blocked.',
      },
    ],
    openQuestions: [
      'What will the learner be able to show at the end?',
      'What prior knowledge can the course safely assume?',
      `How will the course fit the constraint: ${constraints}?`,
    ],
    revisionNote,
    previousVersionTitle: previous?.title ?? null,
  };
}

function toView(row) {
  return assertAgentWorkView({
    contract: AGENT_WORK_CONTRACT,
    backend: 'mock-agent-work/v1',
    bindingId: row.binding_id,
    transitionId: transitionFor(row.binding_id, row.version),
    status: row.status,
    allowedActions: allowedActions(row),
    nextAction: row.latest_output
      ? 'Revise the visible draft or generate another version.'
      : 'Generate the first visible course outline.',
    latestOutput: row.latest_output,
    evidence: row.evidence,
    audit: row.audit,
    simulated: true,
    authorityNotice: 'Deterministic development simulation. Not Kungfu evidence, review, decision, or seal.',
  });
}

export class MockAgentWorkAdapter extends AgentWorkPort {
  constructor(pool) {
    super();
    this.pool = pool;
  }

  async execute(command) {
    assertCommand(command);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const prior = await client.query(
        'SELECT result FROM mock_agent_work.deliveries WHERE idempotency_key = $1',
        [command.idempotencyKey],
      );
      if (prior.rowCount) {
        await client.query('COMMIT');
        return prior.rows[0].result;
      }
      const bindingId = command.bindingId ?? bindingFor(command.sourceIdentity);
      await client.query(
        `INSERT INTO mock_agent_work.works(binding_id, source_identity, status, audit)
         VALUES ($1, $2, 'ready', $3::jsonb) ON CONFLICT (source_identity) DO NOTHING`,
        [bindingId, command.sourceIdentity, JSON.stringify([{
          type: 'provisioned',
          label: 'simulated',
          detail: 'Mock work provisioned from a deterministic business source identity.',
        }])],
      );
      const locked = await client.query(
        'SELECT * FROM mock_agent_work.works WHERE source_identity = $1 FOR UPDATE',
        [command.sourceIdentity],
      );
      if (!locked.rowCount) throw new Error('mock work was not provisioned');
      const row = locked.rows[0];
      let status = row.status;
      const evidence = row.evidence;
      const audit = row.audit;
      let latestOutput = row.latest_output;
      if (command.type === 'generate_outline' || command.type === 'revise_outline') {
        const revision = command.type === 'revise_outline';
        latestOutput = generateOutline(command.payload ?? {}, revision);
        status = 'ready';
        audit.push({
          type: revision ? 'outline-revised' : 'outline-generated',
          label: 'simulated',
          detail: revision
            ? 'The mock used the saved brief, previous version, and creator feedback to produce a new draft.'
            : 'The mock used the saved course brief to produce a visible first draft.',
        });
      } else if (command.type === 'run_first_submission' && status === 'ready') {
        status = 'needs_evidence';
        audit.push({
          type: 'review',
          label: 'simulated',
          outcome: 'insufficient-evidence',
          detail: 'The first draft states an intent but contains no inspectable course outline.',
        });
      } else if (command.type === 'submit_evidence' && status === 'needs_evidence') {
        status = 'evidence_submitted';
        evidence.push({
          id: `mock-artifact:${row.binding_id.slice(5)}:course-outline`,
          label: 'simulated',
          kind: 'course-outline',
          title: String(command.payload?.title ?? 'Course outline'),
          content: String(command.payload?.content ?? ''),
        });
        audit.push({ type: 'evidence-added', label: 'simulated', detail: 'Course outline artifact attached.' });
      } else if (command.type === 'request_review' && status === 'evidence_submitted' && evidence.length) {
        status = 'accepted';
        audit.push({
          type: 'review',
          label: 'simulated',
          outcome: 'accepted-fit',
          detail: 'The artifact now demonstrates audience, outcome, modules, and an observable exercise.',
        });
      } else if (command.type === 'seal' && status === 'accepted') {
        status = 'sealed';
        audit.push({
          type: 'seal',
          label: 'simulated',
          outcome: 'sealed',
          detail: 'Mock lifecycle closed. This is not a Kungfu seal.',
        });
      } else if (command.type !== 'provision') {
        throw new Error(`action ${command.type} is not allowed from ${status}`);
      }
      const updated = await client.query(
        `UPDATE mock_agent_work.works
         SET status = $2, evidence = $3::jsonb, audit = $4::jsonb, latest_output = $5::jsonb,
             version = version + CASE
               WHEN $6::boolean THEN 1
               WHEN status = $2 AND latest_output IS NOT DISTINCT FROM $5::jsonb THEN 0
               ELSE 1
             END,
             updated_at = now()
         WHERE binding_id = $1 RETURNING *`,
        [
          row.binding_id,
          status,
          JSON.stringify(evidence),
          JSON.stringify(audit),
          latestOutput ? JSON.stringify(latestOutput) : null,
          ['generate_outline', 'revise_outline'].includes(command.type),
        ],
      );
      const result = toView(updated.rows[0]);
      await client.query(
        `INSERT INTO mock_agent_work.deliveries(idempotency_key, binding_id, command_type, result)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [command.idempotencyKey, row.binding_id, command.type, JSON.stringify(result)],
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async read(bindingId) {
    if (!String(bindingId).startsWith('mock:')) throw new Error('invalid mock binding');
    const result = await this.pool.query(
      'SELECT * FROM mock_agent_work.works WHERE binding_id = $1',
      [bindingId],
    );
    return result.rowCount ? toView(result.rows[0]) : null;
  }
}
