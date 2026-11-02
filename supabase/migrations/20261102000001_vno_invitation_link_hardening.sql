-- Invitation Auth action links are bearer credentials and are no longer persisted by the application.
-- Clear any value stored by earlier releases. NOT applied automatically: owner approval required for the shared UAT database.
UPDATE public.invitations SET invite_link = NULL WHERE invite_link IS NOT NULL;
COMMENT ON COLUMN public.invitations.invite_link IS 'Deprecated: always NULL. The Auth action link is shown once to the creating Admin (capture mode) or e-mailed by Supabase Auth.';
