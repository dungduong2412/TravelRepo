// Writes every Auth e-mail template (html + text) with dummy values, for review and the mobile render check. Sends nothing.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeMessage } from '../src/modules/auth-email-hook/email-policy';
const out = process.argv[2] || 'email-previews'; mkdirSync(out, { recursive: true });
const WEB = 'https://vno-web-uat.up.railway.app';
const redirect: Record<string, string> = { signup: `${WEB}/merchant/onboard?confirmed=1`, recovery: `${WEB}/reset-password`, invite: `${WEB}/claim/merchant/00000000-0000-4000-8000-000000000000`, magiclink: `${WEB}/login`, email_change: `${WEB}/login`, reauthentication: '' };
for (const type of Object.keys(redirect)) {
  const m = composeMessage('https://projectref.supabase.co', { user: { id: 'u', email: 'tester+example@example.org' }, email_data: { token: '482915', token_hash: 'EXAMPLE_TOKEN_HASH', email_action_type: type, redirect_to: redirect[type] || undefined } }, '[UAT] ');
  writeFileSync(join(out, `${type}.html`), m.html); writeFileSync(join(out, `${type}.txt`), `Subject: ${m.subject}\n\n${m.text}\n`);
}
console.log(`wrote ${Object.keys(redirect).length} templates to ${out}`);
