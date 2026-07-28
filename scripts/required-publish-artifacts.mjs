// SPDX-License-Identifier: Apache-2.0

import { appendFile } from 'node:fs/promises';

const artifacts = [
  {
    group: 'image',
    kind: 'oci',
    name: 'ghcr.io/kungfu-systems/runtime-images/hub-starter',
    ref_template: 'v{version}',
  },
  {
    group: 'application',
    kind: 'oci',
    name: 'ghcr.io/kungfu-systems/runtime-images/hub-starter',
    ref_template: 'compose-v{version}',
  },
];

const json = JSON.stringify(artifacts);
const outputIndex = process.argv.indexOf('--github-output');

if (outputIndex >= 0) {
  const outputPath = process.argv[outputIndex + 1];
  if (!outputPath) throw new Error('--github-output requires a path');
  await appendFile(outputPath, `json=${json}\n`);
} else {
  process.stdout.write(`${json}\n`);
}
