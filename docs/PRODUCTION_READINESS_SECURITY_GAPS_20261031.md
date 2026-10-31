# Production-readiness security gaps (recorded, not UAT blockers)

Accepted for shared UAT only. Each must be closed before Production.

1. **Invitation link stored in plaintext.** `invitations.invite_link` holds the Supabase Auth action link (a bearer credential) and the Admin drawer displays it ("UAT mail-capture"). Anyone with the link can sign in as the invited owner for the Auth OTP lifetime, and an Admin could impersonate an owner. Before Production: deliver by email only, stop persisting and displaying it (store only a hash/reference).
2. **Revoking an invitation does not invalidate the Auth link.** The holder still obtains a verified session, but cannot claim anything. Before Production: regenerate or invalidate the Auth link on revoke.
3. **Custom SMTP is deferred.** Emailed invitations and self-service recovery are untested and unavailable until SMTP exists.
4. Hosted Auth hardening checks still to confirm by the owner: minimum password length and leaked-password protection (D13 found 6 and disabled).
