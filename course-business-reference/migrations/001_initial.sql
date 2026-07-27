-- SPDX-License-Identifier: Apache-2.0
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS course;
CREATE SCHEMA IF NOT EXISTS mock_agent_work;

CREATE TABLE IF NOT EXISTS course.schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS course.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_normalized text NOT NULL UNIQUE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  password_parameters jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email_normalized = lower(email_normalized)),
  CHECK (char_length(email_normalized) BETWEEN 3 AND 254)
);

CREATE TABLE IF NOT EXISTS course.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES course.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  csrf_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS sessions_user_active_idx
  ON course.sessions (user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS course.courses (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS course.homework_definitions (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES course.courses(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  brief text NOT NULL,
  required_artifact text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, slug)
);

CREATE TABLE IF NOT EXISTS course.enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES course.users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES course.courses(id) ON DELETE RESTRICT,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, course_id)
);
CREATE INDEX IF NOT EXISTS enrollments_user_idx ON course.enrollments (user_id);

CREATE TABLE IF NOT EXISTS course.learner_homeworks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES course.users(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES course.enrollments(id) ON DELETE CASCADE,
  definition_id uuid NOT NULL REFERENCES course.homework_definitions(id) ON DELETE RESTRICT,
  backend_kind text NOT NULL CHECK (backend_kind = 'mock'),
  backend_binding_id text,
  projected_status text NOT NULL DEFAULT 'provisioning'
    CHECK (projected_status IN ('provisioning','ready','needs_evidence','evidence_submitted','accepted','sealed','failed')),
  projection_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, definition_id),
  UNIQUE (backend_kind, backend_binding_id)
);
CREATE INDEX IF NOT EXISTS learner_homeworks_user_idx
  ON course.learner_homeworks (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS course.command_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES course.users(id) ON DELETE CASCADE,
  learner_homework_id uuid NOT NULL REFERENCES course.learner_homeworks(id) ON DELETE CASCADE,
  command_type text NOT NULL CHECK (command_type IN ('provision','run_first_submission','submit_evidence','request_review','seal')),
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','delivered','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS command_outbox_delivery_idx
  ON course.command_outbox (state, available_at, created_at);

CREATE TABLE IF NOT EXISTS mock_agent_work.works (
  binding_id text PRIMARY KEY CHECK (binding_id LIKE 'mock:%'),
  source_identity text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('ready','needs_evidence','evidence_submitted','accepted','sealed')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  audit jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mock_agent_work.deliveries (
  idempotency_key text PRIMARY KEY,
  binding_id text NOT NULL REFERENCES mock_agent_work.works(binding_id) ON DELETE CASCADE,
  command_type text NOT NULL,
  result jsonb NOT NULL,
  delivered_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE course.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE course.enrollments FORCE ROW LEVEL SECURITY;
ALTER TABLE course.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE course.sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE course.learner_homeworks ENABLE ROW LEVEL SECURITY;
ALTER TABLE course.learner_homeworks FORCE ROW LEVEL SECURITY;
ALTER TABLE course.command_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE course.command_outbox FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS enrollments_current_user ON course.enrollments;
CREATE POLICY enrollments_current_user ON course.enrollments
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
DROP POLICY IF EXISTS sessions_current_user ON course.sessions;
CREATE POLICY sessions_current_user ON course.sessions
  USING (
    user_id = nullif(current_setting('app.user_id', true), '')::uuid
    OR token_hash = nullif(current_setting('app.session_hash', true), '')
  )
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
DROP POLICY IF EXISTS learner_homeworks_current_user ON course.learner_homeworks;
CREATE POLICY learner_homeworks_current_user ON course.learner_homeworks
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
DROP POLICY IF EXISTS command_outbox_current_user ON course.command_outbox;
CREATE POLICY command_outbox_current_user ON course.command_outbox
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
