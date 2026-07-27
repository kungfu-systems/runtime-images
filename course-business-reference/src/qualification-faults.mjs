// SPDX-License-Identifier: Apache-2.0
import { writeFile } from 'node:fs/promises';

function markerPath(config, fault) {
  return `${config.stateDir}/qualification-${config.qualificationRunId}-${fault}.marker`;
}

async function firstAttempt(config, fault) {
  try {
    await writeFile(markerPath(config, fault), `${new Date().toISOString()}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

export function createQualificationFaults(config) {
  const hooks = {
    processingStaleSeconds: config.outboxProcessingStaleSeconds,
    async beforeExecute(message) {
      if (
        config.qualificationTimeoutOnce
        && message.command_type === config.qualificationTimeoutOnce
        && await firstAttempt(config, `timeout-${message.command_type}`)
      ) {
        throw new Error('qualification-only simulated adapter timeout');
      }
    },
    async afterExecute(message) {
      if (
        config.qualificationCrashAfterAdapterOnce
        && message.command_type === 'provision'
        && await firstAttempt(config, 'crash-after-adapter')
      ) {
        process.exit(86);
      }
    },
  };
  if (!config.qualificationRunId) {
    delete hooks.beforeExecute;
    delete hooks.afterExecute;
  }
  return Object.freeze(hooks);
}
