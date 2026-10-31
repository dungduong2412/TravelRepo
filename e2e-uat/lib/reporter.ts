import fs from 'node:fs';
import path from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { EVIDENCE_DIR, RUN_ID } from './env';
import { redact } from './redact';

// Clear PASS / FAIL / SKIP output. Nothing that did not run is reported as PASS.
export default class UatReporter implements Reporter {
  private rows: { title: string; status: string; note: string }[] = [];
  onTestEnd(t: TestCase, r: TestResult) {
    const skipped = r.status === 'skipped';
    const status = skipped ? 'SKIP' : r.status === 'passed' ? 'PASS' : 'FAIL';
    const note = skipped ? (t.annotations.find((a) => a.type === 'skip')?.description ?? '') : redact(r.error?.message ?? '').split('\n')[0];
    this.rows.push({ title: t.titlePath().slice(2).join(' › '), status, note });
  }
  onEnd(_: FullResult) {
    const n = (s: string) => this.rows.filter((r) => r.status === s).length;
    const md = [`# VNO UAT E2E report — run ${RUN_ID}`, '', `PASS ${n('PASS')} · FAIL ${n('FAIL')} · SKIP ${n('SKIP')}`, '', '| Status | Test | Note |', '|---|---|---|', ...this.rows.map((r) => `| ${r.status} | ${r.title} | ${r.note.replace(/\|/g, '/')} |`)].join('\n');
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE_DIR, `report-${RUN_ID}.md`), md + '\n');
    console.log('\n' + md);
  }
}
