#!/usr/bin/env node

throw new Error(
  'Disabled: orphan cleanup is destructive and this legacy script used obsolete key columns. ' +
  'Use a reviewed, dry-run reconciliation tied to an approved migration batch.',
);
