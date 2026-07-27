// SPDX-License-Identifier: Apache-2.0

export class HubStarterClient {
  constructor({ baseUrl = 'http://127.0.0.1:8080', fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
    this.baseUrl = baseUrl.replace(/\/$/u, '');
    this.fetch = fetchImpl;
  }

  async state() {
    return this.#request('/api/state');
  }

  async settleDemo() {
    return this.#request('/api/settle', { method: 'POST' });
  }

  async submitClaim() {
    return this.#request('/api/coursework/claim', { method: 'POST' });
  }

  async submitEvidence() {
    return this.#request('/api/coursework/evidence', { method: 'POST' });
  }

  async #request(path, init = {}) {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { accept: 'application/json', ...(init.headers || {}) },
    });
    const payload = await response.json();
    if (!response.ok) {
      const error = new Error(payload.message || `Hub Starter request failed: ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }
}
