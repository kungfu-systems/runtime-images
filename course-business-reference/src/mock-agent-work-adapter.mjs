// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { AGENT_WORK_CONTRACT, AgentWorkPort, assertCommand } from './agent-work-port.mjs';

const bindingFor = (source) => `mock:${createHash('sha256').update(source).digest('hex').slice(0, 24)}`;
const transitionFor = (binding, version) => `mock-transition:${binding.slice(5)}:${version}`;

function allowedActions(status) {
  if (status === 'ready') return ['run_first_submission'];
  if (status === 'needs_evidence') return ['submit_evidence'];
  if (status === 'evidence_submitted') return ['request_review'];
  if (status === 'accepted') return ['seal'];
  return [];
}

function toView(row) {
  const next = {
    ready: 'Run the first simulated submission.',
    needs_evidence: 'Add the required course-outline artifact.',
    evidence_submitted: 'Request a fresh simulated review.',
    accepted: 'Seal the completed simulated work.',
    sealed: null,
  }[row.status];
  return {
    contract: AGENT_WORK_CONTRACT,
    backend: 'mock-agent-work/v1',
    bindingId: row.binding_id,
    transitionId: transitionFor(row.binding_id, row.version),
    status: row.status,
    allowedActions: allowedActions(row.status),
    nextAction: next,
    evidence: row.evidence,
    audit: row.audit,
    simulated: true,
    authorityNotice: 'Deterministic development simulation. Not Kungfu evidence, review, decision, or seal.',
  };
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
      if (command.type === 'run_first_submission' && status === 'ready') {
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
         SET status = $2, evidence = $3::jsonb, audit = $4::jsonb,
             version = version + CASE WHEN status = $2 THEN 0 ELSE 1 END, updated_at = now()
         WHERE binding_id = $1 RETURNING *`,
        [row.binding_id, status, JSON.stringify(evidence), JSON.stringify(audit)],
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
