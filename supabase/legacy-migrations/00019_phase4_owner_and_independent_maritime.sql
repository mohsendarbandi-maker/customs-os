-- Phase 4: separate cargo-owner registry + independent maritime shipment file
-- EPL passwords are stored through Supabase Vault, never plaintext in public tables.

alter table public.shipments alter column case_id drop not null;

create table if not exists public.client_epl_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  epl_username text not null check (char_length(trim(epl_username)) >= 2),
  vault_secret_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id)
);

alter table public.client_epl_credentials enable row level security;
create policy client_epl_credentials_select on public.client_epl_credentials for select to authenticated using (organization_id = public.user_org_id() and public.user_role() in ('owner','admin','broker'));
create policy client_epl_credentials_insert on public.client_epl_credentials for insert to authenticated with check (organization_id = public.user_org_id() and public.user_role() in ('owner','admin','broker'));
create policy client_epl_credentials_update on public.client_epl_credentials for update to authenticated using (organization_id = public.user_org_id() and public.user_role() in ('owner','admin','broker')) with check (organization_id = public.user_org_id() and public.user_role() in ('owner','admin','broker'));
create policy client_epl_credentials_delete on public.client_epl_credentials for delete to authenticated using (organization_id = public.user_org_id() and public.user_role() in ('owner','admin'));
revoke all on table public.client_epl_credentials from anon, public;
grant select, insert, update, delete on table public.client_epl_credentials to authenticated;

create or replace function public.create_client_workflow(p_name text, p_national_id text default null)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_org uuid:=public.user_org_id(); v_id uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if v_org is null or public.user_role() not in ('owner','admin','broker') then raise exception 'Insufficient access'; end if;
 if nullif(trim(p_name),'') is null then raise exception 'Client name is required'; end if;
 select id into v_id from public.clients where organization_id=v_org and lower(trim(name))=lower(trim(p_name)) limit 1;
 if v_id is null then insert into public.clients(organization_id,name,national_id) values(v_org,trim(p_name),nullif(trim(p_national_id),'')) returning id into v_id;
 else update public.clients set national_id=coalesce(nullif(trim(p_national_id),''),national_id),updated_at=now() where id=v_id; end if;
 return v_id;
end; $$;
revoke all on function public.create_client_workflow(text,text) from public,anon;
grant execute on function public.create_client_workflow(text,text) to authenticated;

create or replace function public.save_client_epl_credentials(p_client_id uuid,p_epl_username text,p_epl_password text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=public.user_org_id(); v_id uuid; v_secret uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if v_org is null or public.user_role() not in ('owner','admin','broker') then raise exception 'Insufficient access'; end if;
 if not exists(select 1 from public.clients where id=p_client_id and organization_id=v_org) then raise exception 'Client not found or access denied'; end if;
 if nullif(trim(p_epl_username),'') is null then raise exception 'EPL username is required'; end if;
 if nullif(p_epl_password,'') is null then raise exception 'EPL password is required'; end if;
 select id,vault_secret_id into v_id,v_secret from public.client_epl_credentials where organization_id=v_org and client_id=p_client_id for update;
 if v_secret is null then v_secret:=vault.create_secret(p_epl_password,'epl_client_'||p_client_id::text,'Customs OS EPL credential'); else perform vault.update_secret(v_secret,p_epl_password,'epl_client_'||p_client_id::text,'Customs OS EPL credential'); end if;
 if v_id is null then insert into public.client_epl_credentials(organization_id,client_id,epl_username,vault_secret_id) values(v_org,p_client_id,trim(p_epl_username),v_secret) returning id into v_id; else update public.client_epl_credentials set epl_username=trim(p_epl_username),vault_secret_id=v_secret,updated_at=now() where id=v_id; end if;
 return v_id;
end; $$;
revoke all on function public.save_client_epl_credentials(uuid,text,text) from public,anon;
grant execute on function public.save_client_epl_credentials(uuid,text,text) to authenticated;

create or replace function public.get_client_epl_credentials(p_client_id uuid)
returns table(epl_username text,epl_password text) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=public.user_org_id();
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if v_org is null or public.user_role() not in ('owner','admin','broker') then raise exception 'Insufficient access'; end if;
 if not exists(select 1 from public.clients where id=p_client_id and organization_id=v_org) then raise exception 'Client not found or access denied'; end if;
 return query select c.epl_username,ds.decrypted_secret from public.client_epl_credentials c join vault.decrypted_secrets ds on ds.id=c.vault_secret_id where c.organization_id=v_org and c.client_id=p_client_id;
end; $$;
revoke all on function public.get_client_epl_credentials(uuid) from public,anon;
grant execute on function public.get_client_epl_credentials(uuid) to authenticated;

create or replace function public.update_shipment_maritime_data(p_case_id uuid,p_shipping_line text,p_bill_of_lading_no text,p_bill_of_lading_year smallint,p_vessel_name text,p_vessel_imo text default null,p_vessel_flag_code text default null,p_voyage_no text default null,p_origin_port text default null,p_destination_port text default null,p_cargo_count numeric default null,p_cargo_count_unit text default null,p_net_weight_kg numeric default null,p_gross_weight_kg numeric default null,p_tally_no text default null,p_release_invoice_no text default null,p_release_invoice_date date default null,p_release_status text default null,p_electronic_release_no text default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid; v_shipment uuid; v_vessel uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 v_org:=public.user_org_id(); if v_org is null or public.user_role() not in ('owner','admin','broker') then raise exception 'Insufficient access'; end if;
 if p_case_id is not null and not exists(select 1 from public.cases where id=p_case_id and organization_id=v_org) then raise exception 'Case not found or access denied'; end if;
 if nullif(trim(p_shipping_line),'') is null then raise exception 'Shipping line is required'; end if;
 if nullif(trim(p_bill_of_lading_no),'') is null then raise exception 'B/L number is required'; end if;
 if p_bill_of_lading_year<2000 or p_bill_of_lading_year>2100 then raise exception 'Invalid B/L year'; end if;
 if nullif(trim(p_vessel_name),'') is null then raise exception 'Vessel name is required'; end if;
 if p_gross_weight_kg is not null and p_gross_weight_kg<=0 then raise exception 'Gross weight must be positive'; end if;
 if p_net_weight_kg is not null and p_net_weight_kg<0 then raise exception 'Net weight cannot be negative'; end if;
 if p_vessel_imo is not null and trim(p_vessel_imo)<>'' and trim(p_vessel_imo)!~'^[0-9]{7}$' then raise exception 'IMO number must contain 7 digits'; end if;
 if p_vessel_flag_code is not null and trim(p_vessel_flag_code)<>'' and upper(trim(p_vessel_flag_code))!~'^[A-Z]{2}$' then raise exception 'Vessel flag must be a 2-letter ISO country code'; end if;
 select id into v_vessel from public.vessels where organization_id=v_org and lower(trim(name))=lower(trim(p_vessel_name)) limit 1;
 if v_vessel is null then insert into public.vessels(organization_id,name,imo_number,flag_code,flag) values(v_org,trim(p_vessel_name),nullif(trim(p_vessel_imo),''),upper(nullif(trim(p_vessel_flag_code),'')),upper(nullif(trim(p_vessel_flag_code),''))) returning id into v_vessel;
 else update public.vessels set imo_number=coalesce(nullif(trim(p_vessel_imo),''),imo_number),flag_code=coalesce(upper(nullif(trim(p_vessel_flag_code),'')),flag_code),flag=coalesce(upper(nullif(trim(p_vessel_flag_code),'')),flag) where id=v_vessel and organization_id=v_org; end if;
 select id into v_shipment from public.shipments where organization_id=v_org and bill_of_lading_year=p_bill_of_lading_year and lower(trim(shipping_line))=lower(trim(p_shipping_line)) and lower(trim(bill_of_lading_no))=lower(trim(p_bill_of_lading_no)) limit 1;
 if v_shipment is null then insert into public.shipments(organization_id,case_id,vessel_id,transport_mode,bill_of_lading_no,bill_of_lading_year,shipping_line,gross_weight_kg,origin_port,destination_port,voyage_no,cargo_count,cargo_count_unit,net_weight_kg,tally_no,release_invoice_no,release_invoice_date,release_status,electronic_release_no,current_status) values(v_org,p_case_id,v_vessel,'sea',trim(p_bill_of_lading_no),p_bill_of_lading_year,trim(p_shipping_line),coalesce(p_gross_weight_kg,1),nullif(trim(p_origin_port),''),nullif(trim(p_destination_port),''),nullif(trim(p_voyage_no),''),p_cargo_count,nullif(trim(p_cargo_count_unit),''),p_net_weight_kg,nullif(trim(p_tally_no),''),nullif(trim(p_release_invoice_no),''),p_release_invoice_date,p_release_status,nullif(trim(p_electronic_release_no),''),'draft') returning id into v_shipment;
 else update public.shipments set case_id=coalesce(p_case_id,case_id),vessel_id=v_vessel,shipping_line=trim(p_shipping_line),voyage_no=nullif(trim(p_voyage_no),''),origin_port=nullif(trim(p_origin_port),''),destination_port=nullif(trim(p_destination_port),''),cargo_count=p_cargo_count,cargo_count_unit=nullif(trim(p_cargo_count_unit),''),net_weight_kg=p_net_weight_kg,gross_weight_kg=coalesce(p_gross_weight_kg,gross_weight_kg),tally_no=nullif(trim(p_tally_no),''),release_invoice_no=nullif(trim(p_release_invoice_no),''),release_invoice_date=p_release_invoice_date,release_status=p_release_status,electronic_release_no=nullif(trim(p_electronic_release_no),'') where id=v_shipment and organization_id=v_org; end if;
 return v_shipment;
end; $$;
revoke all on function public.update_shipment_maritime_data(uuid,text,text,smallint,text,text,text,text,text,text,numeric,text,numeric,numeric,text,text,date,text,text) from public,anon;
grant execute on function public.update_shipment_maritime_data(uuid,text,text,smallint,text,text,text,text,text,text,numeric,text,numeric,numeric,text,text,date,text,text) to authenticated;
