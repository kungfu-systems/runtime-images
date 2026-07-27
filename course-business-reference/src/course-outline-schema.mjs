// SPDX-License-Identifier: Apache-2.0

// Keep the provider-facing grammar compact. Application validation below owns
// the text bounds so providers do not need to expand large maxLength values
// into thousands of grammar repetitions.
const text = { type: 'string' };

export const COURSE_OUTLINE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'positioning',
    'audience',
    'promise',
    'delivery',
    'creatorAdvantage',
    'modules',
    'openQuestions',
    'revisionNote',
    'summary',
    'changes',
  ],
  properties: {
    title: text,
    positioning: text,
    audience: text,
    promise: text,
    delivery: text,
    creatorAdvantage: text,
    modules: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['number', 'title', 'outcome', 'lessons', 'exercise'],
        properties: {
          number: { type: 'integer', minimum: 1, maximum: 3 },
          title: text,
          outcome: text,
          lessons: {
            type: 'array',
            minItems: 3,
            maxItems: 3,
            items: text,
          },
          exercise: text,
        },
      },
    },
    openQuestions: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: text,
    },
    revisionNote: text,
    summary: text,
    changes: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: text,
    },
  },
});

function boundedText(value, name, maximum = 2000) {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`model returned invalid ${name}`);
  }
  return normalized;
}

export function assertCourseOutline(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('model returned an invalid course outline');
  }
  const modules = value.modules;
  if (!Array.isArray(modules) || modules.length !== 3) {
    throw new Error('model must return exactly three modules');
  }
  const normalizedModules = modules.map((module, index) => {
    if (!module || typeof module !== 'object' || Array.isArray(module)) {
      throw new Error(`model returned invalid module ${index + 1}`);
    }
    if (!Array.isArray(module.lessons) || module.lessons.length !== 3) {
      throw new Error(`model must return three lessons for module ${index + 1}`);
    }
    return {
      number: index + 1,
      title: boundedText(module.title, `module ${index + 1} title`, 160),
      outcome: boundedText(module.outcome, `module ${index + 1} outcome`),
      lessons: module.lessons.map((lesson, lessonIndex) =>
        boundedText(lesson, `module ${index + 1} lesson ${lessonIndex + 1}`, 300)),
      exercise: boundedText(module.exercise, `module ${index + 1} exercise`),
    };
  });
  if (!Array.isArray(value.openQuestions) || value.openQuestions.length !== 3) {
    throw new Error('model must return exactly three open questions');
  }
  if (!Array.isArray(value.changes) || value.changes.length !== 3) {
    throw new Error('model must return exactly three changes');
  }
  return {
    title: boundedText(value.title, 'title', 160),
    positioning: boundedText(value.positioning, 'positioning'),
    audience: boundedText(value.audience, 'audience'),
    promise: boundedText(value.promise, 'promise'),
    delivery: boundedText(value.delivery, 'delivery'),
    creatorAdvantage: boundedText(value.creatorAdvantage, 'creator advantage'),
    modules: normalizedModules,
    openQuestions: value.openQuestions.map((question, index) =>
      boundedText(question, `open question ${index + 1}`, 500)),
    revisionNote: boundedText(value.revisionNote, 'revision note', 1000),
    summary: boundedText(value.summary, 'contribution summary', 1000),
    changes: value.changes.map((change, index) =>
      boundedText(change, `change ${index + 1}`, 500)),
  };
}
