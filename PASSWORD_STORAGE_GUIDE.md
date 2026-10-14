# Password storage and authentication

V2 uses Supabase Auth as the only password verifier and password store for Admin, Merchant, and Collaborator accounts.

## Rules

- Never persist plaintext or bcrypt password values in `merchant_details.owner_password` or `collaborators.collaborators_password`. These legacy columns remain `NULL` for new and migrated V2 rows.
- Never import ASP.NET Identity password hashes, security stamps, OpenID tokens, refresh tokens, or other reusable credential material from V1.
- Backend login calls Supabase Auth and then loads the active `user_profiles` role and linked merchant/collaborator entity.
- Authorization is based on the verified Supabase Auth user plus the active V2 profile. Client-supplied roles are not trusted.
- New passwords and recovery passwords require at least 12 characters with uppercase, lowercase, numeric, and symbol characters.
- Production must enable leaked-password protection before customer onboarding.

## Recovery

The frontend requests recovery with `resetPasswordForEmail` and redirects only to an allow-listed `/reset-password` URL. The recovery page updates the authenticated recovery session through Supabase Auth, signs out, and requires a fresh login. The request screen uses a non-enumerating confirmation message.

Configure production SMTP, Site URL, Redirect URLs, recovery templates, rate limits, and support handling in Supabase before sending any customer-facing reset. Migration/import scripts do not send recovery or invitation mail.

## Test accounts

Use only authorized local or UAT test accounts. Supply passwords through environment variables; do not commit or print them. The supported isolated checks are:

```bash
node migration/v2/test-password-reset.mjs
node migration/v2/test-authorization.mjs
```

Legacy scripts that read or write domain password columns are disabled.
