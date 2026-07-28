-- SPDX-License-Identifier: Apache-2.0

ALTER TABLE course.command_outbox
  ADD COLUMN IF NOT EXISTS backend_kind text,
  ADD COLUMN IF NOT EXISTS backend_binding_id text;

UPDATE course.command_outbox o
SET backend_kind = h.backend_kind,
    backend_binding_id = CASE
      WHEN o.command_type = 'provision' THEN NULL
      ELSE h.backend_binding_id
    END
FROM course.learner_homeworks h
WHERE h.id = o.learner_homework_id
  AND o.backend_kind IS NULL;

ALTER TABLE course.command_outbox
  ALTER COLUMN backend_kind SET NOT NULL;
ALTER TABLE course.command_outbox
  DROP CONSTRAINT IF EXISTS command_outbox_backend_kind_check;
ALTER TABLE course.command_outbox
  ADD CONSTRAINT command_outbox_backend_kind_check
  CHECK (backend_kind IN ('mock','openai-compatible'));

CREATE TABLE IF NOT EXISTS course.course_backend_switches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES course.users(id) ON DELETE CASCADE,
  course_project_id uuid NOT NULL REFERENCES course.course_projects(id) ON DELETE CASCADE,
  learner_homework_id uuid NOT NULL REFERENCES course.learner_homeworks(id) ON DELETE CASCADE,
  from_backend_kind text NOT NULL CHECK (from_backend_kind IN ('mock','openai-compatible')),
  to_backend_kind text NOT NULL CHECK (to_backend_kind IN ('mock','openai-compatible')),
  prior_binding_id text,
  new_binding_id text,
  provision_command_id uuid NOT NULL UNIQUE
    REFERENCES course.command_outbox(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (from_backend_kind <> to_backend_kind)
);
CREATE INDEX IF NOT EXISTS course_backend_switches_project_created_idx
  ON course.course_backend_switches (course_project_id, created_at DESC);

ALTER TABLE course.course_backend_switches ENABLE ROW LEVEL SECURITY;
ALTER TABLE course.course_backend_switches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS course_backend_switches_current_user ON course.course_backend_switches;
CREATE POLICY course_backend_switches_current_user ON course.course_backend_switches
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
