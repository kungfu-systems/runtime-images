// SPDX-License-Identifier: Apache-2.0
import {
  AgentWorkPort,
  backendKindForBinding,
} from './agent-work-port.mjs';

export class AgentWorkRouter extends AgentWorkPort {
  constructor({ defaultBackend, adapters }) {
    super();
    this.defaultBackend = defaultBackend;
    this.adapters = new Map(Object.entries(adapters));
    if (!this.adapters.has(defaultBackend)) {
      throw new Error(`default AgentWorkPort backend is unavailable: ${defaultBackend}`);
    }
  }

  adapter(kind) {
    const adapter = this.adapters.get(kind);
    if (!adapter) throw new Error(`AgentWorkPort backend is unavailable: ${kind}`);
    return adapter;
  }

  hasBackend(kind) {
    return this.adapters.has(kind);
  }

  async health(kind = this.defaultBackend) {
    return this.adapter(kind).health();
  }

  async execute(command) {
    const kind = command.bindingId
      ? backendKindForBinding(command.bindingId)
      : command.backendKind ?? this.defaultBackend;
    return this.adapter(kind).execute(command);
  }

  async read(bindingId) {
    return this.adapter(backendKindForBinding(bindingId)).read(bindingId);
  }
}
