// SPDX-License-Identifier: Apache-2.0

export class WorkControlProjection {
  constructor(_config) {}

  async publicStatus() {
    return {
      mode: 'kungfu-managed',
      label: 'Kungfu-managed work',
      nativeCourseBinding: true,
      authorityNotice: [
        'PostgreSQL owns accounts, course briefs, versions, and creator approval.',
        'Kungfu native journal state owns each delegated generation Assignment, Evidence, independent review, typed decision, and seal.',
      ].join(' '),
      lifecycle: [
        'Assignment admitted and claimed',
        'Selected generator returns an outline',
        'Exact PostgreSQL version is attached as Evidence',
        'Independent reviewer checks the Evidence',
        'Typed continuation decision is recorded',
        'Accepted work receives a portable seal',
      ],
    };
  }
}
