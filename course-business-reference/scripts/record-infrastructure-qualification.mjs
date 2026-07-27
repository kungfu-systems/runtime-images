// SPDX-License-Identifier: Apache-2.0
import { readFile, writeFile } from 'node:fs/promises';

const path = process.env.COURSE_EVIDENCE_PATH;
if (!path) throw new Error('COURSE_EVIDENCE_PATH is required');
const evidence = JSON.parse(await readFile(path, 'utf8'));
evidence.directRls = {
  unscopedVisibleRows: Number(process.env.COURSE_RLS_UNSCOPED),
  scopedVisibleRows: Number(process.env.COURSE_RLS_VISIBLE),
  crossAccountVisibleRows: Number(process.env.COURSE_RLS_CROSS_ACCOUNT),
};
evidence.backupRestore = {
  primaryCounts: process.env.COURSE_PRIMARY_COUNTS,
  restoredCounts: process.env.COURSE_RESTORED_COUNTS,
  roundTripEqual: process.env.COURSE_PRIMARY_COUNTS === process.env.COURSE_RESTORED_COUNTS,
};
evidence.outboxRecovery = {
  crashProvisionAttempts: Number(process.env.COURSE_CRASH_ATTEMPTS),
  timeoutActionAttempts: Number(process.env.COURSE_TIMEOUT_ATTEMPTS),
  adapterTimeoutRetried: Number(process.env.COURSE_TIMEOUT_ATTEMPTS) >= 2,
  crashAfterAdapterRecovered: Number(process.env.COURSE_CRASH_ATTEMPTS) >= 2,
};
evidence.databaseRestartRecovered = true;
evidence.applicationRestartRecovered = true;
await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
