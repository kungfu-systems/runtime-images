// SPDX-License-Identifier: Apache-2.0
import { AGENT_WORK_CONTRACT } from './agent-work-port.mjs';
import { transaction } from './db.mjs';

export class OutboxDispatcher {
  constructor(pool, agentWorkPort) {
    this.pool = pool;
    this.agentWorkPort = agentWorkPort;
    this.running = false;
  }

  async drainAll() {
    if (this.running) return;
    this.running = true;
    try {
      const users = await this.pool.query('SELECT id FROM course.users ORDER BY id');
      for (const { id } of users.rows) await this.drainUser(id);
    } finally {
      this.running = false;
    }
  }

  async drainUser(userId) {
    for (let count = 0; count < 20; count += 1) {
      const message = await transaction(this.pool, { userId }, async (client) => {
        await client.query(
          `UPDATE course.command_outbox
           SET state = 'pending', locked_at = NULL
           WHERE state = 'processing' AND locked_at < now() - interval '30 seconds'`,
        );
        const selected = await client.query(
          `SELECT o.*, h.backend_binding_id
           FROM course.command_outbox o
           JOIN course.learner_homeworks h ON h.id = o.learner_homework_id
           WHERE o.state = 'pending' AND o.available_at <= now()
           ORDER BY o.created_at
           FOR UPDATE OF o SKIP LOCKED LIMIT 1`,
        );
        if (!selected.rowCount) return null;
        const row = selected.rows[0];
        await client.query(
          `UPDATE course.command_outbox
           SET state = 'processing', attempts = attempts + 1, locked_at = now()
           WHERE id = $1`,
          [row.id],
        );
        return row;
      });
      if (!message) return;
      try {
        const view = await this.agentWorkPort.execute({
          contract: AGENT_WORK_CONTRACT,
          type: message.command_type,
          idempotencyKey: message.idempotency_key,
          sourceIdentity: `course-homework:${message.learner_homework_id}`,
          bindingId: message.backend_binding_id,
          payload: message.payload,
        });
        await transaction(this.pool, { userId }, async (client) => {
          await client.query(
            `UPDATE course.learner_homeworks
             SET backend_binding_id = $2, projected_status = $3,
                 projection_version = $4, updated_at = now()
             WHERE id = $1`,
            [message.learner_homework_id, view.bindingId, view.status, view.transitionId],
          );
          await client.query(
            `UPDATE course.command_outbox
             SET state = 'delivered', delivered_at = now(), last_error = NULL
             WHERE id = $1`,
            [message.id],
          );
        });
      } catch (error) {
        await transaction(this.pool, { userId }, async (client) => {
          await client.query(
            `UPDATE course.command_outbox
             SET state = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
                 available_at = now() + interval '2 seconds',
                 last_error = $2, locked_at = NULL
             WHERE id = $1`,
            [message.id, String(error.message ?? error).slice(0, 500)],
          );
          await client.query(
            `UPDATE course.learner_homeworks
             SET projected_status = CASE WHEN $2 >= 5 THEN 'failed' ELSE projected_status END,
                 updated_at = now()
             WHERE id = $1`,
            [message.learner_homework_id, message.attempts + 1],
          );
        });
        return;
      }
    }
  }
}
