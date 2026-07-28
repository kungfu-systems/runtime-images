// SPDX-License-Identifier: Apache-2.0

const MAX_STATUS_BYTES = 32 * 1024;

export class WorkControlProjection {
  constructor(config, fetchImplementation = fetch) {
    this.config = config;
    this.fetch = fetchImplementation;
  }

  async publicStatus() {
    const base = {
      mode: 'app-only',
      label: 'App-only coordination',
      nativeCourseBinding: false,
      authorityNotice: [
        'The course app and its PostgreSQL outbox coordinate this course.',
        'No native Kungfu Assignment, Evidence Episode, independent review, decision, or seal is created.',
      ].join(' '),
      hubStarterDemo: {
        configured: this.config.enabled,
        reachable: false,
        ready: false,
        phase: this.config.enabled ? 'checking' : 'not-configured',
        browserUrl: this.config.browserUrl || '',
      },
    };
    if (!this.config.enabled) return base;
    try {
      const response = await this.fetch(this.config.statusUrl, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      const text = await response.text();
      if (Buffer.byteLength(text) > MAX_STATUS_BYTES) {
        throw new Error('Hub Starter status exceeded the response limit');
      }
      if (!response.ok) throw new Error(`Hub Starter status returned ${response.status}`);
      const value = JSON.parse(text);
      if (
        value?.schema !== 'kungfu.hub-starter.readiness/v1'
        || typeof value.ready !== 'boolean'
        || typeof value.phase !== 'string'
      ) {
        throw new Error('Hub Starter returned an unsupported readiness document');
      }
      return {
        ...base,
        hubStarterDemo: {
          ...base.hubStarterDemo,
          reachable: true,
          ready: value.ready,
          phase: value.phase.slice(0, 80),
        },
      };
    } catch {
      return {
        ...base,
        hubStarterDemo: {
          ...base.hubStarterDemo,
          phase: 'unavailable',
        },
      };
    }
  }
}
