-- SPDX-License-Identifier: Apache-2.0

-- A failed outline generation is an action failure, not a failed Agent binding.
-- Recover only bindings whose latest command failed during generation/revision.
UPDATE course.learner_homeworks h
SET projected_status = 'ready',
    updated_at = now()
WHERE h.projected_status = 'failed'
  AND h.backend_binding_id IS NOT NULL
  AND (
    SELECT o.state = 'failed'
       AND o.command_type IN ('generate_outline', 'revise_outline')
    FROM course.command_outbox o
    WHERE o.learner_homework_id = h.id
    ORDER BY o.created_at DESC
    LIMIT 1
  ) IS TRUE;
