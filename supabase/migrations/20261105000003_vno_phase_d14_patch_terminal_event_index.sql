-- D14 patch 2: fix transaction_events_real_terminal_once_uq index.
--
-- The original index was:
--   CREATE UNIQUE INDEX ... ON transaction_events (transaction_id)
--   WHERE event_type IN ('real_transaction_confirmed',
--                        'real_transaction_cancelled',
--                        'real_transaction_reversed');
--
-- This incorrectly blocks the CONFIRMED→REVERSED lifecycle path:
-- inserting a 'real_transaction_reversed' row fails because a
-- 'real_transaction_confirmed' row with the same transaction_id already
-- satisfies the partial predicate, violating uniqueness on transaction_id.
--
-- Fix: index on (transaction_id, event_type) instead of just (transaction_id).
-- This allows at most one event of each terminal type per transaction while
-- correctly permitting the confirmed + reversed pair.
--
-- UNDO:
--   DROP INDEX IF EXISTS public.transaction_events_real_terminal_once_uq;
--   CREATE UNIQUE INDEX transaction_events_real_terminal_once_uq
--     ON public.transaction_events (transaction_id)
--     WHERE event_type IN ('real_transaction_confirmed',
--                          'real_transaction_cancelled',
--                          'real_transaction_reversed');

begin;

drop index if exists public.transaction_events_real_terminal_once_uq;

create unique index transaction_events_real_terminal_once_uq
  on public.transaction_events (transaction_id, event_type)
  where event_type in (
    'real_transaction_confirmed',
    'real_transaction_cancelled',
    'real_transaction_reversed'
  );

commit;
