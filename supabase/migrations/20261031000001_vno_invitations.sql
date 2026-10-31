-- Invitations table for admin-created Merchant/Partner account claim
CREATE TABLE public.invitations (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type              text        NOT NULL CHECK (entity_type IN ('merchant', 'collaborator')),
  entity_id                uuid        NOT NULL,
  owner_email              text        NOT NULL,
  status                   text        NOT NULL DEFAULT 'pending'
                                       CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invite_link              text,
  created_by_auth_user_id  uuid        REFERENCES auth.users(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  expires_at               timestamptz NOT NULL DEFAULT now() + interval '7 days',
  accepted_at              timestamptz,
  accepted_by_auth_user_id uuid        REFERENCES auth.users(id),
  revoked_at               timestamptz,
  revoked_by_auth_user_id  uuid        REFERENCES auth.users(id)
);

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON public.invitations
  FOR ALL TO service_role USING (true);

-- Only one pending invitation per entity at a time
CREATE UNIQUE INDEX invitations_entity_pending_uq
  ON public.invitations (entity_type, entity_id)
  WHERE status = 'pending';
