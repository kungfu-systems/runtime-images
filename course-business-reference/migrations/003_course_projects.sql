-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE IF NOT EXISTS course.course_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES course.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  target_learner text NOT NULL CHECK (char_length(target_learner) BETWEEN 1 AND 500),
  learner_problem text NOT NULL CHECK (char_length(learner_problem) BETWEEN 1 AND 1000),
  promised_outcome text NOT NULL CHECK (char_length(promised_outcome) BETWEEN 1 AND 1000),
  creator_expertise text NOT NULL CHECK (char_length(creator_expertise) BETWEEN 1 AND 2000),
  delivery_constraints text NOT NULL CHECK (char_length(delivery_constraints) BETWEEN 1 AND 1000),
  current_outline_version_id uuid,
  legacy_homework_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS course_projects_user_updated_idx
  ON course.course_projects (user_id, updated_at DESC);

ALTER TABLE course.learner_homeworks
  ADD COLUMN IF NOT EXISTS course_project_id uuid REFERENCES course.course_projects(id) ON DELETE CASCADE;
ALTER TABLE course.learner_homeworks
  DROP CONSTRAINT IF EXISTS learner_homeworks_user_id_definition_id_key;

INSERT INTO course.course_projects (
  user_id,
  title,
  target_learner,
  learner_problem,
  promised_outcome,
  creator_expertise,
  delivery_constraints,
  legacy_homework_id
)
SELECT
  h.user_id,
  'AI Course Builder Sprint',
  'Small-business course creators without a technical background',
  'Their expertise is valuable but difficult to turn into a teachable sequence.',
  'Publish a testable three-module course outline.',
  'Practical experience serving a real customer group.',
  'A concise course that can be validated with one learner.',
  h.id
FROM course.learner_homeworks h
WHERE h.course_project_id IS NULL
ON CONFLICT (legacy_homework_id) DO NOTHING;

UPDATE course.learner_homeworks h
SET course_project_id = p.id
FROM course.course_projects p
WHERE h.course_project_id IS NULL
  AND p.legacy_homework_id = h.id;

ALTER TABLE course.learner_homeworks
  ALTER COLUMN course_project_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS learner_homeworks_course_project_idx
  ON course.learner_homeworks (course_project_id);

ALTER TABLE course.command_outbox
  DROP CONSTRAINT IF EXISTS command_outbox_command_type_check;
ALTER TABLE course.command_outbox
  ADD CONSTRAINT command_outbox_command_type_check
  CHECK (command_type IN (
    'provision',
    'run_first_submission',
    'submit_evidence',
    'request_review',
    'seal',
    'generate_outline',
    'revise_outline'
  ));

ALTER TABLE mock_agent_work.works
  ADD COLUMN IF NOT EXISTS latest_output jsonb;

CREATE TABLE IF NOT EXISTS course.agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES course.users(id) ON DELETE CASCADE,
  course_project_id uuid NOT NULL REFERENCES course.course_projects(id) ON DELETE CASCADE,
  outbox_command_id uuid NOT NULL UNIQUE REFERENCES course.command_outbox(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('generate_outline','revise_outline')),
  backend_kind text NOT NULL CHECK (backend_kind = 'mock'),
  backend_binding_id text NOT NULL,
  transition_id text NOT NULL,
  input jsonb NOT NULL,
  output jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_runs_project_created_idx
  ON course.agent_runs (course_project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS course.course_outline_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES course.users(id) ON DELETE CASCADE,
  course_project_id uuid NOT NULL REFERENCES course.course_projects(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  source_run_id uuid NOT NULL UNIQUE REFERENCES course.agent_runs(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','superseded')),
  outline jsonb NOT NULL,
  change_summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  UNIQUE (course_project_id, version_number)
);
CREATE INDEX IF NOT EXISTS course_outline_versions_project_idx
  ON course.course_outline_versions (course_project_id, version_number DESC);

ALTER TABLE course.course_projects
  ADD CONSTRAINT course_projects_current_outline_version_fk
  FOREIGN KEY (current_outline_version_id)
  REFERENCES course.course_outline_versions(id)
  ON DELETE SET NULL;

ALTER TABLE course.course_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE course.course_projects FORCE ROW LEVEL SECURITY;
ALTER TABLE course.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE course.agent_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE course.course_outline_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE course.course_outline_versions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS course_projects_current_user ON course.course_projects;
CREATE POLICY course_projects_current_user ON course.course_projects
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
DROP POLICY IF EXISTS agent_runs_current_user ON course.agent_runs;
CREATE POLICY agent_runs_current_user ON course.agent_runs
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
DROP POLICY IF EXISTS course_outline_versions_current_user ON course.course_outline_versions;
CREATE POLICY course_outline_versions_current_user ON course.course_outline_versions
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
