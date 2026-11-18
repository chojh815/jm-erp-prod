begin;

-- Lock the company to serialize saves of its sites. This function runs as a
-- single transaction, so a failed save restores the previous default.
create or replace function public.save_company_sites(p_company_id uuid, p_sites jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  site public.company_sites%rowtype;
begin
  perform 1 from public.companies where id = p_company_id for update;
  if not found then
    raise exception 'Company not found.' using errcode = 'P0002';
  end if;

  if (select count(*) from jsonb_populate_recordset(null::public.company_sites, p_sites)
      where is_default is true) > 1 then
    raise exception 'Select only one Default Site.' using errcode = '22023';
  end if;

  if exists (select 1 from jsonb_populate_recordset(null::public.company_sites, p_sites)
             where is_default is true) then
    update public.company_sites
    set is_default = false, updated_at = now()
    where company_id = p_company_id and is_default is true
      and id is distinct from (
        select id from jsonb_populate_recordset(null::public.company_sites, p_sites)
        where is_default is true
      );
  end if;

  for site in select * from jsonb_populate_recordset(null::public.company_sites, p_sites)
  loop
    if site.id is null then
      insert into public.company_sites (
        company_id, site_name, origin_code, country, city, state, address1, address2,
        phone, tax_id, bank_name, bank_account, account_holder_name, swift, currency,
        exporter_of_record, origin_country, is_default, air_port_loading, sea_port_loading,
        updated_at, created_at
      ) values (
        p_company_id, site.site_name, site.origin_code, site.country, site.city, site.state,
        site.address1, site.address2, site.phone, site.tax_id, site.bank_name, site.bank_account,
        site.account_holder_name, site.swift, site.currency, site.exporter_of_record,
        site.origin_country, site.is_default, site.air_port_loading, site.sea_port_loading,
        site.updated_at, site.updated_at
      );
    else
      update public.company_sites
      set (site_name, origin_code, country, city, state, address1, address2,
           phone, tax_id, bank_name, bank_account, account_holder_name, swift, currency,
           exporter_of_record, origin_country, is_default, air_port_loading, sea_port_loading,
           updated_at) =
          (site.site_name, site.origin_code, site.country, site.city, site.state,
           site.address1, site.address2, site.phone, site.tax_id, site.bank_name, site.bank_account,
           site.account_holder_name, site.swift, site.currency, site.exporter_of_record,
           site.origin_country, site.is_default, site.air_port_loading, site.sea_port_loading,
           site.updated_at)
      where company_id = p_company_id and id = site.id;
      if not found then
        raise exception 'Company site not found.' using errcode = 'P0002';
      end if;
    end if;
  end loop;
end;
$$;

revoke execute on function public.save_company_sites(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_company_sites(uuid, jsonb) to service_role;
notify pgrst, 'reload schema';

commit;
