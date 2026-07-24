// SPDX-License-Identifier: Apache-2.0

export function validateImageReference(reference) {
  if (typeof reference !== 'string' || !/^[a-z0-9./-]+@sha256:[0-9a-f]{64}$/u.test(reference)) {
    throw new Error('image reference must be one lowercase registry path plus an exact sha256 digest');
  }
  return reference;
}

export function validateComposeText(text) {
  const forbidden = [
    [/privileged\s*:\s*true/iu, 'privileged containers are forbidden'],
    [/network_mode\s*:\s*host/iu, 'host networking is forbidden'],
    [/docker\.sock/iu, 'Docker socket mounts are forbidden'],
    [/cap_add\s*:/iu, 'Linux capability additions are forbidden'],
    [/(?:0\.0\.0\.0|::):\$?\{?HUB_PORT/iu, 'non-loopback publication is forbidden'],
    [/\buser\s*:\s*["']?root/iu, 'root runtime users are forbidden'],
    [/\/~\/\.kungfu|\/home\/[^/]+\/\.kungfu/iu, 'real Kungfu homes are forbidden'],
  ];
  for (const [pattern, message] of forbidden) {
    if (pattern.test(text)) throw new Error(message);
  }
  for (const required of [
    'read_only: true',
    'no-new-privileges:true',
    '127.0.0.1:${HUB_PORT:-8080}:8080',
    'hub-state:/state',
  ]) {
    if (!text.includes(required)) throw new Error(`compose safety invariant missing: ${required}`);
  }
  return true;
}
