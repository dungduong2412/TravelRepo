import { z } from 'zod';

// PostgreSQL's uuid type accepts the full 8-4-4-4-12 hexadecimal form. V1
// source GUIDs do not consistently carry RFC version/variant bits, so Zod 4's
// stricter z.guid() would reject valid, already-preserved legacy identities.
export const PostgresUuidSchema = z.string().trim().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  'Expected a PostgreSQL UUID',
);
