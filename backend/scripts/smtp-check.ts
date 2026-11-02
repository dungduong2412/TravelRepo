// Read-only SMTP readiness check for the activation runbook: validates the SMTP_* variables and opens an authenticated, encrypted session
// (connect + EHLO + STARTTLS/TLS + AUTH) and then closes it. It sends NO message and needs no recipient.
// Usage (variables from the shell or Railway): npm run smtp:check
import { createSmtpTransport, describeSmtp, readSmtpSettings, classifySmtpError } from '../src/modules/auth-email-hook/smtp-config';
(async () => {
  let settings;
  try { settings = readSmtpSettings(); } catch (e: any) { console.error(`CONFIG FAIL: ${e.message}`); process.exit(2); }
  console.log(`config OK: ${describeSmtp(settings)}${settings.replyTo ? ` reply-to=${settings.replyTo}` : ''}`);
  try { await createSmtpTransport(settings).verify(); console.log('session OK: encrypted channel + authentication accepted (no message sent)'); }
  catch (e) { console.error(`SESSION FAIL: ${classifySmtpError(e)}`); process.exit(1); }
})();
