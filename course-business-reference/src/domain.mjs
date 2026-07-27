// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from 'node:crypto';
import { transaction } from './db.mjs';
import {
  hashPassword,
  normalizeEmail,
  randomToken,
  tokenHash,
  validatePassword,
  verifyPassword,
} from './security.mjs';

const COURSE_ID = '10000000-0000-4000-8000-000000000001';
const HOMEWORK_ID = '20000000-0000-4000-8000-000000000001';

function publicUser(row) {
  return { id: row.id, email: row.email_normalized, displayName: row.display_name };
}

function bounded(value, name, minimum, maximum) {
  const normalized = String(value ?? '').trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new Error(`invalid ${name}`);
  }
  return normalized;
}

function projectInput(input) {
  return {
    title: bounded(input.title, 'course title', 1, 120),
    targetLearner: bounded(input.targetLearner, 'target learner', 1, 500),
    learnerProblem: bounded(input.learnerProblem, 'learner problem', 1, 1000),
    promisedOutcome: bounded(input.promisedOutcome, 'promised outcome', 1, 1000),
    creatorExpertise: bounded(input.creatorExpertise, 'creator expertise', 1, 2000),
    deliveryConstraints: bounded(input.deliveryConstraints, 'delivery constraints', 1, 1000),
  };
}

async function createSession(client, userId, hours) {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  await client.query(
    `INSERT INTO course.sessions(user_id, token_hash, csrf_token, expires_at)
     VALUES ($1, $2, $3, now() + ($4 * interval '1 hour'))`,
    [userId, tokenHash(token), csrfToken, hours],
  );
  return { token, csrfToken };
}

export class CourseDomain {
  constructor(pool, agentWorkPort, dispatcher, config) {
    this.pool = pool;
    this.agentWorkPort = agentWorkPort;
    this.dispatcher = dispatcher;
    this.config = config;
  }

  async register(input) {
    const email = normalizeEmail(input.email);
    const password = validatePassword(input.password);
    const displayName = String(input.displayName ?? '').trim();
    if (displayName.length < 1 || displayName.length > 80) throw new Error('invalid registration');
    const credential = await hashPassword(password);
    const created = await transaction(this.pool, {}, async (client) => {
      const userResult = await client.query(
        `INSERT INTO course.users
          (email_normalized, display_name, password_salt, password_hash, password_parameters)
         VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *`,
        [email, displayName, credential.salt, credential.hash, JSON.stringify(credential.parameters)],
      );
      const user = userResult.rows[0];
      await client.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
      const enrollment = await client.query(
        `INSERT INTO course.enrollments(user_id, course_id)
         VALUES ($1, $2) RETURNING id`,
        [user.id, COURSE_ID],
      );
      if (!enrollment.rowCount) throw new Error('enrollment could not be created');
      return { user, session: await createSession(client, user.id, this.config.sessionHours) };
    });
    return { user: publicUser(created.user), ...created.session };
  }

  async login(input) {
    const email = normalizeEmail(input.email);
    const found = await this.pool.query(
      `SELECT * FROM course.users WHERE email_normalized = $1`,
      [email],
    );
    const row = found.rows[0];
    const fallback = {
      password_salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
      password_hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      password_parameters: { N: 32768, r: 8, p: 1, keyLength: 32 },
    };
    const credential = row ?? fallback;
    const valid = await verifyPassword(
      String(input.password ?? ''),
      credential.password_salt,
      credential.password_hash,
      credential.password_parameters,
    ).catch(() => false);
    if (!row || !valid) throw new Error('invalid credentials');
    const session = await transaction(this.pool, { userId: row.id }, (client) =>
      createSession(client, row.id, this.config.sessionHours));
    return { user: publicUser(row), ...session };
  }

  async authenticate(token) {
    if (!token) return null;
    const hash = tokenHash(token);
    return transaction(this.pool, { sessionHash: hash }, async (client) => {
      const result = await client.query(
        `SELECT s.id AS session_id, s.csrf_token, s.expires_at, u.*
         FROM course.sessions s JOIN course.users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
        [hash],
      );
      if (!result.rowCount) return null;
      const row = result.rows[0];
      return {
        sessionId: row.session_id,
        csrfToken: row.csrf_token,
        user: publicUser(row),
        tokenHash: hash,
      };
    });
  }

  async logout(auth) {
    await transaction(this.pool, { userId: auth.user.id, sessionHash: auth.tokenHash }, (client) =>
      client.query('UPDATE course.sessions SET revoked_at = now() WHERE id = $1', [auth.sessionId]));
  }

  async createCourse(userId, input, backendKind = this.config.backend) {
    if (!this.agentWorkPort.hasBackend(backendKind)) {
      throw new Error('requested course Agent backend is unavailable');
    }
    const values = projectInput(input);
    const created = await transaction(this.pool, { userId }, async (client) => {
      const enrollment = await client.query(
        'SELECT id FROM course.enrollments WHERE user_id = $1 AND course_id = $2',
        [userId, COURSE_ID],
      );
      if (!enrollment.rowCount) throw new Error('course enrollment is missing');
      const project = await client.query(
        `INSERT INTO course.course_projects
          (user_id, title, target_learner, learner_problem, promised_outcome,
           creator_expertise, delivery_constraints)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          userId,
          values.title,
          values.targetLearner,
          values.learnerProblem,
          values.promisedOutcome,
          values.creatorExpertise,
          values.deliveryConstraints,
        ],
      );
      const homework = await client.query(
        `INSERT INTO course.learner_homeworks
          (user_id, enrollment_id, definition_id, backend_kind, course_project_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          userId,
          enrollment.rows[0].id,
          HOMEWORK_ID,
          backendKind,
          project.rows[0].id,
        ],
      );
      await client.query(
        `INSERT INTO course.command_outbox
          (user_id, learner_homework_id, command_type, idempotency_key,
           backend_kind, backend_binding_id)
         VALUES ($1, $2, 'provision', $3, $4, NULL)`,
        [userId, homework.rows[0].id, `provision:${homework.rows[0].id}`, backendKind],
      );
      return project.rows[0].id;
    });
    await this.dispatcher.drainUser(userId);
    return this.course(userId, created);
  }

  async listCourses(userId) {
    const result = await transaction(this.pool, { userId }, (client) => client.query(
      `SELECT p.id, p.title, p.target_learner, p.promised_outcome,
              p.updated_at, p.current_outline_version_id,
              h.backend_kind,
              count(v.id)::integer AS version_count,
              max(v.version_number)::integer AS latest_version_number,
              max(v.created_at) AS latest_version_at
       FROM course.course_projects p
       JOIN course.learner_homeworks h ON h.course_project_id = p.id
       LEFT JOIN course.course_outline_versions v ON v.course_project_id = p.id
       WHERE p.user_id = $1
       GROUP BY p.id, h.backend_kind
       ORDER BY p.updated_at DESC`,
      [userId],
    ));
    return result.rows;
  }

  async course(userId, courseId) {
    const project = await transaction(this.pool, { userId }, async (client) => {
      const result = await client.query(
        `SELECT p.*, h.id AS homework_id, h.projected_status,
                h.backend_kind, h.backend_binding_id, h.projection_version
         FROM course.course_projects p
         JOIN course.learner_homeworks h ON h.course_project_id = p.id
         WHERE p.id = $1 AND p.user_id = $2`,
        [courseId, userId],
      );
      if (!result.rowCount) return null;
      const versions = await client.query(
        `SELECT v.id, v.version_number, v.status, v.outline, v.change_summary,
                v.created_at, v.approved_at, r.action AS agent_action,
                r.backend_kind AS agent_backend, r.transition_id,
                r.backend_binding_id AS agent_backend_binding_id,
                r.input AS agent_input, r.created_at AS agent_completed_at
         FROM course.course_outline_versions v
         JOIN course.agent_runs r ON r.id = v.source_run_id
         WHERE v.course_project_id = $1 AND v.user_id = $2
         ORDER BY v.version_number DESC`,
        [courseId, userId],
      );
      const backendSwitches = await client.query(
        `SELECT from_backend_kind, to_backend_kind, prior_binding_id,
                new_binding_id, created_at, completed_at
         FROM course.course_backend_switches
         WHERE course_project_id = $1 AND user_id = $2
         ORDER BY created_at DESC`,
        [courseId, userId],
      );
      return {
        ...result.rows[0],
        versions: versions.rows,
        backend_switches: backendSwitches.rows,
      };
    });
    if (!project) return null;
    const work = project.backend_binding_id
      ? await this.agentWorkPort.read(project.backend_binding_id)
      : null;
    return {
      id: project.id,
      title: project.title,
      brief: {
        targetLearner: project.target_learner,
        learnerProblem: project.learner_problem,
        promisedOutcome: project.promised_outcome,
        creatorExpertise: project.creator_expertise,
        deliveryConstraints: project.delivery_constraints,
      },
      backendKind: project.backend_kind,
      backendStatus: project.projected_status,
      backendSwitches: project.backend_switches.map((entry) => ({
        from: entry.from_backend_kind,
        to: entry.to_backend_kind,
        priorBindingId: entry.prior_binding_id,
        newBindingId: entry.new_binding_id,
        createdAt: entry.created_at,
        completedAt: entry.completed_at,
      })),
      currentOutlineVersionId: project.current_outline_version_id,
      versions: project.versions.map((version) => ({
        id: version.id,
        versionNumber: version.version_number,
        status: version.status,
        outline: version.outline,
        changeSummary: version.change_summary,
        createdAt: version.created_at,
        approvedAt: version.approved_at,
        agentRun: {
          action: version.agent_action,
          backend: version.agent_backend,
          backendBindingId: version.agent_backend_binding_id,
          transitionId: version.transition_id,
          previousVersionId: version.agent_input?.previousVersionId ?? null,
          feedback: version.agent_input?.feedback ?? '',
          completedAt: version.agent_completed_at,
        },
      })),
      agentWork: work,
      updatedAt: project.updated_at,
    };
  }

  async switchCourseBackend(userId, courseId, backendKind, clientKey) {
    if (!this.agentWorkPort.hasBackend(backendKind)) {
      throw Object.assign(
        new Error('requested course Agent backend is unavailable'),
        { status: 409 },
      );
    }
    const key = String(clientKey ?? randomUUID());
    if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(key)) throw new Error('invalid idempotency key');
    const changed = await transaction(this.pool, { userId }, async (client) => {
      const priorRequest = await client.query(
        `SELECT id FROM course.course_backend_switches
         WHERE user_id = $1 AND course_project_id = $2 AND idempotency_key = $3`,
        [userId, courseId, key],
      );
      if (priorRequest.rowCount) return false;
      const owned = await client.query(
        `SELECT p.id, h.id AS homework_id, h.backend_kind,
                h.backend_binding_id, h.projected_status
         FROM course.course_projects p
         JOIN course.learner_homeworks h ON h.course_project_id = p.id
         WHERE p.id = $1 AND p.user_id = $2
         FOR UPDATE OF p, h`,
        [courseId, userId],
      );
      if (!owned.rowCount) {
        const error = new Error('not found');
        error.code = 'NOT_FOUND';
        throw error;
      }
      const current = owned.rows[0];
      if (current.backend_kind === backendKind) return false;
      const pending = await client.query(
        `SELECT id FROM course.command_outbox
         WHERE learner_homework_id = $1 AND state IN ('pending','processing')
         LIMIT 1`,
        [current.homework_id],
      );
      if (pending.rowCount) {
        throw Object.assign(
          new Error('wait for the current Agent action before switching'),
          { status: 409 },
        );
      }
      const provisionKey = `switch-backend:${courseId}:${key}:provision`;
      const command = await client.query(
        `INSERT INTO course.command_outbox
          (user_id, learner_homework_id, command_type, idempotency_key,
           backend_kind, backend_binding_id)
         VALUES ($1, $2, 'provision', $3, $4, NULL)
         RETURNING id`,
        [userId, current.homework_id, provisionKey, backendKind],
      );
      await client.query(
        `INSERT INTO course.course_backend_switches
          (user_id, course_project_id, learner_homework_id,
           from_backend_kind, to_backend_kind, prior_binding_id,
           provision_command_id, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          userId,
          courseId,
          current.homework_id,
          current.backend_kind,
          backendKind,
          current.backend_binding_id,
          command.rows[0].id,
          key,
        ],
      );
      await client.query(
        `UPDATE course.learner_homeworks
         SET backend_kind = $2, backend_binding_id = NULL,
             projected_status = 'provisioning', projection_version = NULL,
             updated_at = now()
         WHERE id = $1`,
        [current.homework_id, backendKind],
      );
      await client.query(
        'UPDATE course.course_projects SET updated_at = now() WHERE id = $1',
        [courseId],
      );
      return true;
    });
    if (changed) await this.dispatcher.drainUser(userId);
    return this.course(userId, courseId);
  }

  async enqueueCourseAction(userId, courseId, type, clientKey, input = {}) {
    if (!['generate_outline', 'revise_outline'].includes(type)) {
      throw new Error('unsupported course action');
    }
    const key = String(clientKey ?? randomUUID());
    if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(key)) throw new Error('invalid idempotency key');
    await transaction(this.pool, { userId }, async (client) => {
      const owned = await client.query(
        `SELECT p.*, h.id AS homework_id, h.backend_kind,
                h.backend_binding_id, h.projected_status
         FROM course.course_projects p
         JOIN course.learner_homeworks h ON h.course_project_id = p.id
         WHERE p.id = $1 AND p.user_id = $2`,
        [courseId, userId],
      );
      if (!owned.rowCount) {
        const error = new Error('not found');
        error.code = 'NOT_FOUND';
        throw error;
      }
      const project = owned.rows[0];
      if (!project.backend_binding_id || project.projected_status !== 'ready') {
        throw Object.assign(
          new Error('course Agent binding is not ready'),
          { status: 409 },
        );
      }
      const latest = await client.query(
        `SELECT id, outline
         FROM course.course_outline_versions
         WHERE course_project_id = $1
         ORDER BY version_number DESC LIMIT 1`,
        [courseId],
      );
      if (type === 'revise_outline' && !latest.rowCount) {
        throw new Error('generate the first outline before revising it');
      }
      const payload = {
        title: project.title,
        targetLearner: project.target_learner,
        learnerProblem: project.learner_problem,
        promisedOutcome: project.promised_outcome,
        creatorExpertise: project.creator_expertise,
        deliveryConstraints: project.delivery_constraints,
        previousVersionId: latest.rows[0]?.id ?? null,
        previousOutline: latest.rows[0]?.outline ?? null,
        feedback: type === 'revise_outline'
          ? bounded(input.feedback, 'revision feedback', 1, 1000)
          : '',
      };
      await client.query(
        `INSERT INTO course.command_outbox
          (user_id, learner_homework_id, command_type, idempotency_key, payload,
           backend_kind, backend_binding_id)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          userId,
          project.homework_id,
          type,
          `${type}:${courseId}:${key}`,
          JSON.stringify(payload),
          project.backend_kind,
          project.backend_binding_id,
        ],
      );
    });
    await this.dispatcher.drainUser(userId);
    return this.course(userId, courseId);
  }

  async approveVersion(userId, courseId, versionId) {
    await transaction(this.pool, { userId }, async (client) => {
      const version = await client.query(
        `SELECT id FROM course.course_outline_versions
         WHERE id = $1 AND course_project_id = $2 AND user_id = $3`,
        [versionId, courseId, userId],
      );
      if (!version.rowCount) {
        const error = new Error('not found');
        error.code = 'NOT_FOUND';
        throw error;
      }
      await client.query(
        `UPDATE course.course_outline_versions
         SET status = 'superseded'
         WHERE course_project_id = $1 AND user_id = $2 AND status = 'approved' AND id <> $3`,
        [courseId, userId, versionId],
      );
      await client.query(
        `UPDATE course.course_outline_versions
         SET status = 'approved', approved_at = COALESCE(approved_at, now())
         WHERE id = $1`,
        [versionId],
      );
      await client.query(
        `UPDATE course.course_projects
         SET current_outline_version_id = $2, updated_at = now()
         WHERE id = $1 AND user_id = $3`,
        [courseId, versionId, userId],
      );
    });
    return this.course(userId, courseId);
  }

  async listHomeworks(userId) {
    const result = await transaction(this.pool, { userId }, (client) => client.query(
      `SELECT h.id, h.projected_status AS status, h.updated_at,
              d.title, d.brief, d.required_artifact,
              c.title AS course_title
       FROM course.learner_homeworks h
       JOIN course.homework_definitions d ON d.id = h.definition_id
       JOIN course.courses c ON c.id = d.course_id
       WHERE h.user_id = $1 ORDER BY h.created_at`,
      [userId],
    ));
    return result.rows;
  }

  async homework(userId, homeworkId) {
    const result = await transaction(this.pool, { userId }, (client) => client.query(
      `SELECT h.id, h.backend_binding_id, h.projected_status AS status,
              h.projection_version, h.updated_at, d.title, d.brief,
              d.required_artifact, c.title AS course_title
       FROM course.learner_homeworks h
       JOIN course.homework_definitions d ON d.id = h.definition_id
       JOIN course.courses c ON c.id = d.course_id
       WHERE h.id = $1 AND h.user_id = $2`,
      [homeworkId, userId],
    ));
    if (!result.rowCount) return null;
    const row = result.rows[0];
    const work = row.backend_binding_id ? await this.agentWorkPort.read(row.backend_binding_id) : null;
    return {
      id: row.id,
      title: row.title,
      courseTitle: row.course_title,
      brief: row.brief,
      requiredArtifact: row.required_artifact,
      status: row.status,
      updatedAt: row.updated_at,
      agentWork: work,
    };
  }

  async enqueueAction(userId, homeworkId, type, clientKey, payload = {}) {
    const key = String(clientKey ?? randomUUID());
    if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(key)) throw new Error('invalid idempotency key');
    await transaction(this.pool, { userId }, async (client) => {
      const owned = await client.query(
        `SELECT id, backend_kind, backend_binding_id
         FROM course.learner_homeworks WHERE id = $1 AND user_id = $2`,
        [homeworkId, userId],
      );
      if (!owned.rowCount) {
        const error = new Error('not found');
        error.code = 'NOT_FOUND';
        throw error;
      }
      await client.query(
        `INSERT INTO course.command_outbox
          (user_id, learner_homework_id, command_type, idempotency_key, payload,
           backend_kind, backend_binding_id)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          userId,
          homeworkId,
          type,
          `${type}:${homeworkId}:${key}`,
          JSON.stringify(payload),
          owned.rows[0].backend_kind,
          owned.rows[0].backend_binding_id,
        ],
      );
    });
    await this.dispatcher.drainUser(userId);
    return this.homework(userId, homeworkId);
  }
}
