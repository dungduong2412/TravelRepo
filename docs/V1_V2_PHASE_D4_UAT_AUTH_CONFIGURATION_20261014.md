# VNO Phase D4 — UAT Auth and recovery configuration

Date: 2026-10-14 (Asia/Ho_Chi_Minh)

Target: Supabase project `hsezyogfxgnkpweoqqny` (`VietnamNumberOne`). This is an operator checklist, not authorization to change hosted settings or send mail.

## Current verified state

- Project status: `ACTIVE_HEALTHY`, PostgreSQL 17.6.1.
- Security Advisor still reports `auth_leaked_password_protection`: **Leaked Password Protection Disabled**.
- Hosted custom SMTP, redirect allow-list and recovery delivery have not been verified.
- Local recovery regression: **PASS** with Mailpit and a throwaway `example.invalid` account. Email capture, recovery link, password update and login all passed; the user was removed and no external email was sent.

## Administrator actions requiring approval

1. Open the [password security settings](https://supabase.com/dashboard/project/hsezyogfxgnkpweoqqny/auth/providers) and enable **Prevent use of leaked passwords** for Email/Password Auth. Save, rerun Security Advisor, and retain the timestamped result. A PASS requires the `auth_leaked_password_protection` finding to disappear.
2. Open **Authentication → SMTP Settings** and configure the approved UAT provider, sender address and sender name. Use a UAT-only sending domain/subdomain. Disable provider link tracking because it can rewrite single-use Auth links. Keep credentials in the platform secret store; never add them to the repository.
3. After the UAT web domain exists, set **Site URL** to the exact HTTPS UAT origin and allow only the exact recovery redirect `https://<uat-web-domain>/reset-password` plus any explicitly required callback. Do not add wildcard production domains.
4. Set the Recovery email subject and body from `supabase/templates/recovery.html`. Review the rendered link and brand text in a UAT inbox before any wider use.
5. In **Authentication → Rate Limits**, keep the recovery resend minimum at 60 seconds or stricter. Start with 30 combined auth emails/hour for the UAT custom SMTP provider, 360 verification requests/hour/IP, and 1,800 token requests/hour/IP. Reduce the email limit if the test provider has a lower quota.
6. Run exactly one recovery against a designated authorized UAT account. Verify delivery, redirect origin, recovery session, password update, subsequent login and audit timestamps. Do not use a migrated/customer address and do not activate imported accounts.

Supabase references: [password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), and [production checklist/rate limits](https://supabase.com/docs/guides/deployment/going-into-prod).

## Acceptance record

Record only non-secret evidence: operator, UTC/local timestamps, UAT origin, provider name (not credentials), Security Advisor result, rate-limit values, test-account identifier digest, SMTP message ID digest, delivery result, redirect host, password-update result and login result. Any customer email, unexpected redirect host, delivery to a non-test recipient or leaked-password warning is a hard stop.
