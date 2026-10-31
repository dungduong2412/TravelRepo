import fs from 'node:fs';
import path from 'node:path';
import { EVIDENCE_DIR, RUN_ID } from './env';
import { redact } from './redact';

export type Status = 'PASS' | 'FAIL' | 'SKIP' | 'BLOCKED';
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const LOG = path.join(EVIDENCE_DIR, `steps-${RUN_ID}.jsonl`);

export function record(id: string, title: string, status: Status, detail: unknown = '') {
  const row = { run: RUN_ID, id, title, status, detail: redact(detail), at: new Date().toISOString() };
  fs.appendFileSync(LOG, JSON.stringify(row) + '\n');
  console.log(`[${status}] ${id} ${title}${detail ? ' — ' + redact(detail).slice(0, 200) : ''}`);
  return row;
}
export function logPath() { return LOG; }
