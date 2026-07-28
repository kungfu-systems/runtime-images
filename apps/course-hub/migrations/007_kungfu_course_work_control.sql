-- SPDX-License-Identifier: Apache-2.0

ALTER TABLE course.course_projects
  ADD COLUMN IF NOT EXISTS kungfu_binding_id text;

UPDATE course.course_projects
SET kungfu_binding_id = 'kungfu:course:' || id::text
WHERE kungfu_binding_id IS NULL;

ALTER TABLE course.course_projects
  ALTER COLUMN kungfu_binding_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS course_projects_kungfu_binding_idx
  ON course.course_projects (kungfu_binding_id);

ALTER TABLE course.course_outline_versions
  ADD COLUMN IF NOT EXISTS work_control jsonb,
  ADD COLUMN IF NOT EXISTS work_control_state text NOT NULL DEFAULT 'legacy-unmanaged'
    CHECK (work_control_state IN ('legacy-unmanaged','kungfu-sealed','kungfu-needs-evidence'));

ALTER TABLE course.course_outline_versions
  ADD CONSTRAINT course_outline_versions_work_control_shape
  CHECK (
    work_control_state = 'legacy-unmanaged'
    OR (
      work_control IS NOT NULL
      AND work_control->>'schema' = 'course.kungfu-work-control/v1'
      AND work_control->>'bindingId' = 'kungfu:course:' || course_project_id::text
    )
  ) NOT VALID;

ALTER TABLE course.course_outline_versions
  VALIDATE CONSTRAINT course_outline_versions_work_control_shape;
