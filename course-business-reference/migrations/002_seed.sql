-- SPDX-License-Identifier: Apache-2.0
INSERT INTO course.courses (id, slug, title, summary)
VALUES (
  '10000000-0000-4000-8000-000000000001',
  'ai-course-builder',
  'AI Course Builder Sprint',
  'Turn a real teaching goal into a small, reviewable course outline.'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO course.homework_definitions
  (id, course_id, slug, title, brief, required_artifact)
VALUES (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'course-outline',
  'Build a course outline',
  'Draft a learner-centered course outline, inspect the first review, then provide the missing outline artifact.',
  'A course outline with audience, outcome, three modules, and one observable exercise.'
)
ON CONFLICT (id) DO NOTHING;
