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
      const homework = await client.query(
        `INSERT INTO course.learner_homeworks
          (user_id, enrollment_id, definition_id, backend_kind)
         VALUES ($1, $2, $3, 'mock') RETURNING id`,
        [user.id, enrollment.rows[0].id, HOMEWORK_ID],
      );
      await client.query(
        `INSERT INTO course.command_outbox
          (user_id, learner_homework_id, command_type, idempotency_key)
         VALUES ($1, $2, 'provision', $3)`,
        [user.id, homework.rows[0].id, `provision:${homework.rows[0].id}`],
      );
      return { user, session: await createSession(client, user.id, this.config.sessionHours) };
    });
    await this.dispatcher.drainUser(created.user.id);
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
        'SELECT id FROM course.learner_homeworks WHERE id = $1 AND user_id = $2',
        [homeworkId, userId],
      );
      if (!owned.rowCount) {
        const error = new Error('not found');
        error.code = 'NOT_FOUND';
        throw error;
      }
      await client.query(
        `INSERT INTO course.command_outbox
          (user_id, learner_homework_id, command_type, idempotency_key, payload)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [userId, homeworkId, type, `${type}:${homeworkId}:${key}`, JSON.stringify(payload)],
      );
    });
    await this.dispatcher.drainUser(userId);
    return this.homework(userId, homeworkId);
  }
}
