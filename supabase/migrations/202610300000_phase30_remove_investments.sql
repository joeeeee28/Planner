-- Phase 30 / cleanup migration 1. Apply once in the Supabase SQL editor.
-- Idempotent exact-key removal. Does not delete user_data rows, auth users,
-- Money transactions/accounts, plans, journals, settings or other domains.
-- The client also performs the same cleanup for its own row after login;
-- this administrator migration retires data for inactive accounts as well.
begin;
update public.user_data
set data = (data
  - 'investmentInstruments' - 'investmentHoldings' - 'investmentTransactions'
  - 'investmentPlans' - 'investmentMigrationVersion' - 'cachedMarketQuotes'
  - 'lastMarketRefresh'),
    updated_at = now()
where data ?| array['investmentInstruments','investmentHoldings','investmentTransactions',
  'investmentPlans','investmentMigrationVersion','cachedMarketQuotes','lastMarketRefresh'];

update public.user_data
set data = jsonb_set(data, '{settings,homeWidgets}', (data #> '{settings,homeWidgets}') - 'investments'),
    updated_at = now()
where data #> '{settings,homeWidgets}' ? 'investments';

update public.user_data set data = jsonb_set(data, '{phase30CleanupVersion}', '1'::jsonb)
where coalesce(data->>'phase30CleanupVersion', '') <> '1';
commit;
