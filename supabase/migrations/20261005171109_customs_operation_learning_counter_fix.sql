-- Keep the learning function idempotent per declaration.
-- The canonical function body is refined in the database migration applied for this change.
-- Re-grant the intended API boundary explicitly.
revoke execute on function public.record_customs_operation_learning(uuid) from public,anon;
grant execute on function public.record_customs_operation_learning(uuid) to authenticated;