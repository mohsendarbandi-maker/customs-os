begin;
alter table public.messenger_connections drop constraint if exists messenger_connections_secret_ref_check;
alter table public.messenger_connections add constraint messenger_connections_secret_ref_check check(secret_ref ~ '^(vault:[0-9a-fA-F-]{36}|[A-Z][A-Z0-9_]{2,99})$');
alter table public.messenger_connections drop constraint if exists messenger_connections_webhook_secret_ref_check;
alter table public.messenger_connections add constraint messenger_connections_webhook_secret_ref_check check(webhook_secret_ref ~ '^(vault:[0-9a-fA-F-]{36}|[A-Z][A-Z0-9_]{2,99})$');
alter table public.messenger_connections drop constraint if exists messenger_connections_verify_token_ref_check;
alter table public.messenger_connections add constraint messenger_connections_verify_token_ref_check check(verify_token_ref is null or verify_token_ref ~ '^(vault:[0-9a-fA-F-]{36}|[A-Z][A-Z0-9_]{2,99})$');
alter table public.messenger_connections drop constraint if exists messenger_connections_app_secret_ref_check;
alter table public.messenger_connections add constraint messenger_connections_app_secret_ref_check check(app_secret_ref is null or app_secret_ref ~ '^(vault:[0-9a-fA-F-]{36}|[A-Z][A-Z0-9_]{2,99})$');
create or replace function public.messenger_vault_create_secret(p_secret text,p_name text,p_description text default null)
returns uuid language plpgsql security definer set search_path=public,vault,pg_catalog as $$
declare v_id uuid; begin
 if p_secret is null or length(p_secret)=0 or length(p_secret)>10000 then raise exception 'INVALID_SECRET_INPUT' using errcode='22023'; end if;
 select vault.create_secret(p_secret,left(coalesce(p_name,'messenger-secret'),200),left(coalesce(p_description,'Customs OS messenger credential'),500),null) into v_id;
 return v_id; end; $$;
create or replace function public.messenger_vault_update_secret(p_secret_id uuid,p_secret text,p_name text,p_description text default null)
returns uuid language plpgsql security definer set search_path=public,vault,pg_catalog as $$
declare v_id uuid; begin
 if p_secret_id is null or p_secret is null or length(p_secret)=0 or length(p_secret)>10000 then raise exception 'INVALID_SECRET_INPUT' using errcode='22023'; end if;
 select vault.update_secret(p_secret_id,p_secret,left(coalesce(p_name,'messenger-secret'),200),left(coalesce(p_description,'Customs OS messenger credential'),500),null) into v_id;
 return v_id; end; $$;
create or replace function public.messenger_vault_get_secrets(p_secret_ids uuid[])
returns table(secret_id uuid,decrypted_secret text) language sql security definer set search_path=public,vault,pg_catalog as $$
select d.id,d.decrypted_secret from vault.decrypted_secrets d where d.id=any(coalesce(p_secret_ids,array[]::uuid[])); $$;
revoke all on function public.messenger_vault_create_secret(text,text,text) from public,anon,authenticated;
revoke all on function public.messenger_vault_update_secret(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.messenger_vault_get_secrets(uuid[]) from public,anon,authenticated;
grant execute on function public.messenger_vault_create_secret(text,text,text) to service_role;
grant execute on function public.messenger_vault_update_secret(uuid,text,text,text) to service_role;
grant execute on function public.messenger_vault_get_secrets(uuid[]) to service_role;
comment on function public.messenger_vault_create_secret(text,text,text) is 'Creates encrypted messenger credential; service-role only.';
comment on function public.messenger_vault_get_secrets(uuid[]) is 'Reads decrypted messenger credentials for gateway server only; service-role only.';
commit;