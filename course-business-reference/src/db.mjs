// SPDX-License-Identifier: Apache-2.0
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));

export async function initializeDatabase(config) {
  const migrationPool = new Pool({ connectionString: config.databaseUrl, max: 2 });
  const client = await migrationPool.connect();
  try {
    const role = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'course_app'");
    const password = config.appPassword.replaceAll("'", "''");
    if (role.rowCount === 0) {
      await client.query(`CREATE ROLE course_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${password}'`);
    } else {
      await client.query(`ALTER ROLE course_app PASSWORD '${password}'`);
    }
    await client.query('CREATE SCHEMA IF NOT EXISTS course');
    await client.query(`
      CREATE TABLE IF NOT EXISTS course.schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const files = (await readdir(migrationsDir)).filter((name) => /^\d+_.+\.sql$/u.test(name)).sort();
    for (const file of files) {
      const applied = await client.query(
        'SELECT 1 FROM course.schema_migrations WHERE version = $1',
        [file],
      );
      if (applied.rowCount > 0) continue;
      await client.query('BEGIN');
      try {
        await client.query(await readFile(`${migrationsDir}/${file}`, 'utf8'));
        await client.query('INSERT INTO course.schema_migrations(version) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    await client.query('GRANT CONNECT ON DATABASE course_reference TO course_app');
    await client.query('GRANT USAGE ON SCHEMA course, mock_agent_work TO course_app');
    await client.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA course, mock_agent_work TO course_app');
    await client.query('ALTER DEFAULT PRIVILEGES IN SCHEMA course GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO course_app');
    await client.query('ALTER DEFAULT PRIVILEGES IN SCHEMA mock_agent_work GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO course_app');
  } finally {
    client.release();
    await migrationPool.end();
  }
  const pool = new Pool({
    connectionString: config.appDatabaseUrl,
    max: 12,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
  });
  await pool.query('SELECT 1');
  return pool;
}

export async function transaction(pool, context, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (context?.userId) {
      await client.query("SELECT set_config('app.user_id', $1, true)", [context.userId]);
    }
    if (context?.sessionHash) {
      await client.query("SELECT set_config('app.session_hash', $1, true)", [context.sessionHash]);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
