// SPDX-License-Identifier: Apache-2.0
import { AGENT_WORK_CONTRACT } from './agent-work-port.mjs';
import { transaction } from './db.mjs';

export class OutboxDispatcher {
  constructor(pool, agentWorkPort, hooks = {}) {
    this.pool = pool;
    this.agentWorkPort = agentWorkPort;
    this.hooks = hooks;
    this.processingStaleSeconds = hooks.processingStaleSeconds ?? 30;
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
           WHERE state = 'processing'
             AND locked_at < now() - ($1 * interval '1 second')`,
          [this.processingStaleSeconds],
        );
        const selected = await client.query(
          `SELECT o.*, h.backend_binding_id, h.course_project_id
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
        await this.hooks.beforeExecute?.(message);
        const view = await this.agentWorkPort.execute({
          contract: AGENT_WORK_CONTRACT,
          type: message.command_type,
          idempotencyKey: message.idempotency_key,
          sourceIdentity: `course-homework:${message.learner_homework_id}`,
          bindingId: message.backend_binding_id,
          payload: message.payload,
        });
        await this.hooks.afterExecute?.(message, view);
        await transaction(this.pool, { userId }, async (client) => {
          if (
            ['generate_outline', 'revise_outline'].includes(message.command_type)
            && view.latestOutput
          ) {
            const run = await client.query(
              `INSERT INTO course.agent_runs
                (user_id, course_project_id, outbox_command_id, action, backend_kind,
                 backend_binding_id, transition_id, input, output)
               VALUES ($1, $2, $3, $4, 'mock', $5, $6, $7::jsonb, $8::jsonb)
               ON CONFLICT (outbox_command_id) DO UPDATE
                 SET outbox_command_id = EXCLUDED.outbox_command_id
               RETURNING id`,
              [
                userId,
                message.course_project_id,
                message.id,
                message.command_type,
                view.bindingId,
                view.transitionId,
                JSON.stringify(message.payload),
                JSON.stringify(view.latestOutput),
              ],
            );
            const priorVersion = await client.query(
              'SELECT id FROM course.course_outline_versions WHERE source_run_id = $1',
              [run.rows[0].id],
            );
            if (!priorVersion.rowCount) {
              await client.query(
                `INSERT INTO course.course_outline_versions
                  (user_id, course_project_id, version_number, source_run_id,
                   outline, change_summary)
                 SELECT $1, $2, COALESCE(max(version_number), 0) + 1, $3,
                        $4::jsonb, $5
                 FROM course.course_outline_versions
                 WHERE course_project_id = $2`,
                [
                  userId,
                  message.course_project_id,
                  run.rows[0].id,
                  JSON.stringify(view.latestOutput),
                  String(view.latestOutput.revisionNote ?? 'A new mock-generated course outline.'),
                ],
              );
            }
            await client.query(
              'UPDATE course.course_projects SET updated_at = now() WHERE id = $1',
              [message.course_project_id],
            );
          }
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
