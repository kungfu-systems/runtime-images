-- SPDX-License-Identifier: Apache-2.0

ALTER TABLE course.learner_homeworks
  DROP CONSTRAINT IF EXISTS learner_homeworks_backend_kind_check;
ALTER TABLE course.learner_homeworks
  ADD CONSTRAINT learner_homeworks_backend_kind_check
  CHECK (backend_kind IN ('mock','openai-compatible','hosted'));

ALTER TABLE course.agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_backend_kind_check;
ALTER TABLE course.agent_runs
  ADD CONSTRAINT agent_runs_backend_kind_check
  CHECK (backend_kind IN ('mock','openai-compatible','hosted'));

ALTER TABLE course.command_outbox
  DROP CONSTRAINT IF EXISTS command_outbox_backend_kind_check;
ALTER TABLE course.command_outbox
  ADD CONSTRAINT command_outbox_backend_kind_check
  CHECK (backend_kind IN ('mock','openai-compatible','hosted'));

ALTER TABLE course.course_backend_switches
  DROP CONSTRAINT IF EXISTS course_backend_switches_from_backend_kind_check;
ALTER TABLE course.course_backend_switches
  DROP CONSTRAINT IF EXISTS course_backend_switches_to_backend_kind_check;
ALTER TABLE course.course_backend_switches
  ADD CONSTRAINT course_backend_switches_from_backend_kind_check
  CHECK (from_backend_kind IN ('mock','openai-compatible','hosted'));
ALTER TABLE course.course_backend_switches
  ADD CONSTRAINT course_backend_switches_to_backend_kind_check
  CHECK (to_backend_kind IN ('mock','openai-compatible','hosted'));
