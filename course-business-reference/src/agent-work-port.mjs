// SPDX-License-Identifier: Apache-2.0

export const AGENT_WORK_CONTRACT = 'course.agent-work-port/v2';
export const STATUSES = new Set([
  'ready',
  'needs_evidence',
  'evidence_submitted',
  'accepted',
  'sealed',
]);
export const COMMANDS = new Set([
  'provision',
  'generate_outline',
  'revise_outline',
  'run_first_submission',
  'submit_evidence',
  'request_review',
  'seal',
]);
export const VIEW_ACTIONS = new Set([
  'generate_outline',
  'revise_outline',
  'run_first_submission',
  'submit_evidence',
  'request_review',
  'seal',
]);

export class AgentWorkPort {
  async health() {
    throw new Error('AgentWorkPort.health must be implemented');
  }

  async execute(_command) {
    throw new Error('AgentWorkPort.execute must be implemented');
  }

  async read(_bindingId) {
    throw new Error('AgentWorkPort.read must be implemented');
  }
}

export function assertCommand(command) {
  if (command?.contract !== AGENT_WORK_CONTRACT) throw new Error('unsupported AgentWorkPort contract');
  if (!COMMANDS.has(command.type)) throw new Error('unsupported AgentWorkPort command');
  if (!command.idempotencyKey || !command.sourceIdentity) throw new Error('command identity is required');
}

export function backendKindForBinding(bindingId) {
  const value = String(bindingId ?? '');
  if (value.startsWith('mock:')) return 'mock';
  if (value.startsWith('openai:')) return 'openai-compatible';
  throw new Error('unsupported AgentWorkPort binding');
}

export function assertAgentWorkView(view) {
  if (view?.contract !== AGENT_WORK_CONTRACT) throw new Error('unsupported AgentWorkPort view');
  if (!STATUSES.has(view.status)) throw new Error('unsupported AgentWorkPort status');
  if (!view.backend || !view.bindingId || !view.transitionId) {
    throw new Error('AgentWorkPort view identity is required');
  }
  if (!Array.isArray(view.allowedActions) || !Array.isArray(view.evidence) || !Array.isArray(view.audit)) {
    throw new Error('AgentWorkPort view collections are required');
  }
  if (view.allowedActions.some((action) => !VIEW_ACTIONS.has(action))) {
    throw new Error('unsupported AgentWorkPort allowed action');
  }
  if (typeof view.simulated !== 'boolean') throw new Error('AgentWorkPort authority label is required');
  return view;
}
