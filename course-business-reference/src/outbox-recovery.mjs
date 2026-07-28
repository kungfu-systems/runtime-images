// SPDX-License-Identifier: Apache-2.0

export function projectedStatusAfterDeliveryFailure({
  commandType,
  attempts,
  backendBindingId,
}) {
  if (attempts < 5) return null;
  if (commandType === 'provision') return 'failed';
  if (
    backendBindingId
    && ['generate_outline', 'revise_outline'].includes(commandType)
  ) return 'ready';
  return null;
}
