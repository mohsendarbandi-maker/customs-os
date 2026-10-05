# Legacy Supabase migrations

These SQL files are historical repository migrations whose version is not recorded in the live production migration history. They are preserved for audit/reference but intentionally kept outside `supabase/migrations` so Supabase Preview and deployment do not replay already-applied baseline migrations against the live schema.
