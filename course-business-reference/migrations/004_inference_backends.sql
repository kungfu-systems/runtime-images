-- SPDX-License-Identifier: Apache-2.0

CREATE SCHEMA IF NOT EXISTS agent_work;

ALTER TABLE course.learner_homeworks
  DROP CONSTRAINT IF EXISTS learner_homeworks_backend_kind_check;
ALTER TABLE course.learner_homeworks
  ADD CONSTRAINT learner_homeworks_backend_kind_check
  CHECK (backend_kind IN ('mock','openai-compatible'));

ALTER TABLE course.agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_backend_kind_check;
ALTER TABLE course.agent_runs
  ADD CONSTRAINT agent_runs_backend_kind_check
  CHECK (backend_kind IN ('mock','openai-compatible'));

CREATE TABLE IF NOT EXISTS agent_work.works (
  binding_id text PRIMARY KEY CHECK (binding_id LIKE 'openai:%'),
  source_identity text NOT NULL UNIQUE,
  provider text NOT NULL,
  model text NOT NULL,
  status text NOT NULL DEFAULT 'ready' CHECK (status = 'ready'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  latest_output jsonb,
  audit jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_work.deliveries (
  idempotency_key text PRIMARY KEY,
  binding_id text NOT NULL REFERENCES agent_work.works(binding_id) ON DELETE CASCADE,
  command_type text NOT NULL CHECK (
    command_type IN ('provision','generate_outline','revise_outline')
  ),
  state text NOT NULL CHECK (state IN ('processing','completed','failed')),
  result jsonb,
  last_error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (
    (state = 'completed' AND result IS NOT NULL AND completed_at IS NOT NULL)
    OR state <> 'completed'
  )
);
CREATE INDEX IF NOT EXISTS agent_work_deliveries_binding_idx
  ON agent_work.deliveries (binding_id, started_at DESC);
