-- ============================================================================
-- CoVoit — patch v5
-- FIX: ride creation was failing for everyone.
-- The app sends a `start_date` field when publishing a ride, but the `rides`
-- table never had that column, so every INSERT was rejected by the schema
-- cache ("Could not find the 'start_date' column of 'rides'").
-- This adds the missing column and refreshes PostgREST's schema cache.
-- Safe to run multiple times.
-- Paste this whole file into the Supabase SQL editor and run it once.
-- ============================================================================

alter table public.rides add column if not exists start_date date;

-- Make sure the API roles still have privileges on the table (harmless if set).
grant all on public.rides to anon, authenticated;

-- Tell PostgREST to reload its schema cache immediately so the new column is
-- usable without waiting / restarting.
notify pgrst, 'reload schema';

-- Done. Ride creation will work again right away.
