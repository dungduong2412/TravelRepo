#!/usr/bin/env node

throw new Error(
  'Deprecated: V2 uses Supabase Auth as its only password store. ' +
  'Domain password columns must remain null and must not be backfilled.',
);
