import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { passwordGrantStatus, setPasswordAsAdmin } from './admin-auth';

/**
 * Password rotation for the long-lived synthetic accounts. Tests that change a password must NOT put a shared/previously known one back:
 * they rotate the account to a fresh random password and record it only in the git-ignored, owner-only (0600) .env.uat.local.
 * The new value is registered under an E2E_*PASSWORD* name so redact() masks it, and is never printed or returned to callers' logs.
 */
const ENV_FILE = path.resolve(__dirname, '..', '.env.uat.local');

/** 24 chars, always satisfies the policy (>= 8, letter + digit). */
export const freshPassword = () => `Vn${randomBytes(15).toString('base64url')}7`;

function writeEnvValue(key: string, value: string) {
  const lines = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8').split('\n') : [];
  const re = new RegExp(`^\\s*${key}\\s*=`);
  let found = false;
  const next = lines.map((l) => (re.test(l) ? ((found = true), `${key}=${value}`) : l));
  if (!found) next.push(`${key}=${value}`);
  const tmp = `${ENV_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, next.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, ENV_FILE);
}

/** Rotates one account's password (admin API), proves the grant works, and records it for the harness. Returns only the HTTP status of the proof. */
export async function rotateAccountPassword(opts: { envKey: 'E2E_MERCHANT_PASSWORD' | 'E2E_PARTNER_PASSWORD' | 'E2E_OUTSIDER_PASSWORD'; userId: string; email: string; anon: string }): Promise<number> {
  const pw = freshPassword();
  process.env[`E2E_ROTATED_${opts.envKey}`] = pw; // masks the value in every log line from now on
  await setPasswordAsAdmin(opts.userId, pw);
  const ok = await passwordGrantStatus(opts.email, pw, opts.anon);
  if (ok === 200) { writeEnvValue(opts.envKey, pw); process.env[opts.envKey] = pw; }
  return ok;
}
