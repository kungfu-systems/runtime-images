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
    [/\binternal\s*:\s*true/iu, 'host-disconnected networks cannot serve the localhost Web contract'],
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
    '${HUB_BIND_ADDRESS:-127.0.0.1}:${HUB_PORT:-8080}:8080',
    'condition: service_completed_successfully',
    'COURSE_DB_MIGRATION_PASSWORD_FILE: /install-config/database-migration-password',
    'COURSE_DB_APP_PASSWORD_FILE: /install-config/database-app-password',
    'POSTGRES_PASSWORD_FILE: /install-config/database-migration-password',
    'install-config:/install-config',
    'hub-state:/state',
    'course-models:/models',
    'course-postgres:/var/lib/postgresql/data',
    'driver: bridge',
  ]) {
    if (!text.includes(required)) throw new Error(`compose safety invariant missing: ${required}`);
  }
  const database = text.match(/^  database:\n([\s\S]*?)(?=^  hub:)/mu)?.[1] ?? '';
  if (/^    ports:/mu.test(database)) {
    throw new Error('PostgreSQL host-port publication is forbidden');
  }
  if (/\b(?:POSTGRES_PASSWORD|COURSE_DB_APP_PASSWORD):/u.test(text)) {
    throw new Error('inline database passwords are forbidden');
  }
  return true;
}
