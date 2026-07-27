// SPDX-License-Identifier: Apache-2.0

export const AGENT_WORK_CONTRACT = 'course.agent-work-port/v1';
export const COMMANDS = new Set([
  'provision',
  'run_first_submission',
  'submit_evidence',
  'request_review',
  'seal',
]);

export class AgentWorkPort {
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
