// SPDX-License-Identifier: Apache-2.0
import { AGENT_WORK_CONTRACT } from './agent-work-port.mjs';
import { transaction } from './db.mjs';
import { projectedStatusAfterDeliveryFailure } from './outbox-recovery.mjs';

export class OutboxDispatcher {
  constructor(pool, agentWorkPort, hooks = {}, workControl = null) {
    this.pool = pool;
    this.agentWorkPort = agentWorkPort;
    this.hooks = hooks;
    this.workControl = workControl;
    this.processingStaleSeconds = hooks.processingStaleSeconds ?? 30;
    this.running = false;
    this.userDrains = new Map();
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
    const existing = this.userDrains.get(userId);
    if (existing) return existing;
    const draining = this.drainUserOnce(userId).finally(() => {
      if (this.userDrains.get(userId) === draining) this.userDrains.delete(userId);
    });
    this.userDrains.set(userId, draining);
    return draining;
  }

  async drainUserOnce(userId) {
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
          `SELECT o.*, h.course_project_id, p.title AS course_title,
                  h.backend_kind AS current_backend_kind,
                  h.backend_binding_id AS current_backend_binding_id
           FROM course.command_outbox o
           JOIN course.learner_homeworks h ON h.id = o.learner_homework_id
           JOIN course.course_projects p ON p.id = h.course_project_id
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
          sourceIdentity: `${message.backend_kind}:course-homework:${message.learner_homework_id}`,
          bindingId: message.backend_binding_id,
          backendKind: message.backend_kind,
          payload: message.payload,
        });
        await this.hooks.afterExecute?.(message, view);
        let workControlResult = null;
        if (
          ['generate_outline', 'revise_outline'].includes(message.command_type)
          && view.latestOutput
        ) {
          if (!this.workControl) {
            throw new Error('Kungfu work control is required for generated course versions');
          }
          workControlResult = await this.workControl.settleVersion({
            courseId: message.course_project_id,
            versionId: message.id,
            courseTitle: message.course_title,
            action: message.command_type,
            generator: {
              backend: message.backend_kind,
              bindingId: view.bindingId,
              transitionId: view.transitionId,
              provider: view.latestOutput.inference?.provider
                ?? (view.simulated ? 'deterministic simulation' : 'selected provider'),
              model: view.latestOutput.inference?.model ?? 'none',
              delivery: view.simulated
                ? 'mock'
                : view.latestOutput.inference?.delivery ?? 'external',
              simulated: view.simulated,
            },
            outline: view.latestOutput,
          });
        }
        await transaction(this.pool, { userId }, async (client) => {
          if (
            ['generate_outline', 'revise_outline'].includes(message.command_type)
            && view.latestOutput
          ) {
            const run = await client.query(
              `INSERT INTO course.agent_runs
               (user_id, course_project_id, outbox_command_id, action, backend_kind,
                 backend_binding_id, transition_id, input, output)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
               ON CONFLICT (outbox_command_id) DO UPDATE
                 SET outbox_command_id = EXCLUDED.outbox_command_id
               RETURNING id`,
              [
                userId,
                message.course_project_id,
                message.id,
                message.command_type,
                message.backend_kind,
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
                  (id, user_id, course_project_id, version_number, source_run_id,
                   outline, change_summary, work_control, work_control_state)
                 SELECT $1, $2, $3, COALESCE(max(version_number), 0) + 1, $4,
                        $5::jsonb, $6, $7::jsonb, $8
                 FROM course.course_outline_versions
                 WHERE course_project_id = $3`,
                [
                  message.id,
                  userId,
                  message.course_project_id,
                  run.rows[0].id,
                  JSON.stringify(view.latestOutput),
                  String(view.latestOutput.revisionNote ?? 'A new Agent-generated course outline.'),
                  JSON.stringify(workControlResult),
                  workControlResult?.decision?.action === 'close'
                    ? 'kungfu-sealed'
                    : 'kungfu-needs-evidence',
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
             WHERE id = $1 AND backend_kind = $5`,
            [
              message.learner_homework_id,
              view.bindingId,
              view.status,
              view.transitionId,
              message.backend_kind,
            ],
          );
          if (message.command_type === 'provision') {
            await client.query(
              `UPDATE course.course_backend_switches
               SET new_binding_id = $2, completed_at = now()
               WHERE provision_command_id = $1`,
              [message.id, view.bindingId],
            );
          }
          await client.query(
            `UPDATE course.command_outbox
             SET state = 'delivered', delivered_at = now(), last_error = NULL
             WHERE id = $1`,
            [message.id],
          );
        });
      } catch (error) {
        const attempts = message.attempts + 1;
        const projectedStatus = projectedStatusAfterDeliveryFailure({
          commandType: message.command_type,
          attempts,
          backendBindingId: message.backend_binding_id,
        });
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
             SET projected_status = COALESCE($3::text, projected_status),
                 updated_at = now()
             WHERE id = $1 AND backend_kind = $2`,
            [
              message.learner_homework_id,
              message.backend_kind,
              projectedStatus,
            ],
          );
        });
        return;
      }
    }
  }
}
