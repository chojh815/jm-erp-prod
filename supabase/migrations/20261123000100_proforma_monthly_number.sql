begin;

create table if not exists public.proforma_number_counters (
  buyer_code text not null,
  issue_month date not null,
  last_number integer not null check (last_number > 0),
  primary key (buyer_code, issue_month)
);

alter table public.proforma_number_counters enable row level security;
revoke all on public.proforma_number_counters from public, anon, authenticated;
grant select, insert, update on public.proforma_number_counters to service_role;

create unique index if not exists proforma_monthly_invoice_no_unique
  on public.proforma_headers (invoice_no)
  where invoice_no ~ '^PI-(.+-)?[0-9]{4}-[0-9]{3,}$';

create or replace function public.save_proforma_with_monthly_number(
  p_header jsonb,
  p_lines jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_input public.proforma_headers;
  v_saved public.proforma_headers;
  v_now timestamptz;
  v_issue_date date;
  v_month date;
  v_buyer_code text;
  v_prefix text;
  v_seq integer;
  v_number text;
  v_updated boolean := false;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one proforma line is required.' using errcode = '22023';
  end if;

  v_input := jsonb_populate_record(null::public.proforma_headers, p_header);
  if v_input.buyer_id is null or nullif(btrim(v_input.currency), '') is null then
    raise exception 'Buyer and currency are required.' using errcode = '22023';
  end if;
  v_input.po_no := nullif(btrim(v_input.po_no), '');

  if v_input.po_no is not null then
    -- Keep concurrent saves of the same PO on the same document.
    perform pg_advisory_xact_lock(hashtextextended('proforma:' || v_input.po_no, 0));
    begin
      select h.* into strict v_saved
      from public.proforma_headers h
      where h.po_no = v_input.po_no
      for update;
    exception
      when no_data_found then null;
      when too_many_rows then
        raise exception 'More than one Proforma Invoice exists for this PO.' using errcode = '21000';
    end;
  end if;

  if v_saved.id is not null then
    v_updated := true;
    update public.proforma_headers h
    set buyer_id = v_input.buyer_id,
        buyer_name = v_input.buyer_name,
        currency = v_input.currency,
        payment_term = v_input.payment_term,
        ship_mode = v_input.ship_mode,
        destination = v_input.destination,
        incoterm = v_input.incoterm,
        shipping_origin_code = coalesce(v_input.shipping_origin_code, h.shipping_origin_code),
        origin_code = coalesce(v_input.origin_code, h.origin_code)
    where h.id = v_saved.id
    returning h.* into v_saved;
  else
    v_now := clock_timestamp();
    v_issue_date := (v_now at time zone 'Asia/Seoul')::date;
    v_month := date_trunc('month', v_issue_date::timestamp)::date;
    select upper(btrim(c.code)) into v_buyer_code
    from public.companies c where c.id = v_input.buyer_id;
    v_buyer_code := coalesce(v_buyer_code, '');
    v_prefix := 'PI-' || case when v_buyer_code = '' then '' else v_buyer_code || '-' end
      || to_char(v_month, 'YYMM') || '-';

    loop
      insert into public.proforma_number_counters as c (buyer_code, issue_month, last_number)
        values (v_buyer_code, v_month, 1)
      on conflict (buyer_code, issue_month)
        do update set last_number = c.last_number + 1
      returning last_number into v_seq;

      v_number := v_prefix || lpad(v_seq::text, greatest(3, length(v_seq::text)), '0');
      exit when not exists (
        select 1 from public.proforma_headers h where h.invoice_no = v_number
      );
    end loop;

    insert into public.proforma_headers (
      invoice_no, invoice_date, po_no, buyer_id, buyer_name, currency, payment_term,
      ship_mode, destination, incoterm, created_by, created_by_email, created_at,
      shipping_origin_code, origin_code
    ) values (
      v_number, v_issue_date, v_input.po_no, v_input.buyer_id, v_input.buyer_name,
      v_input.currency, v_input.payment_term, v_input.ship_mode, v_input.destination,
      v_input.incoterm, v_input.created_by, v_input.created_by_email, v_now,
      v_input.shipping_origin_code, v_input.origin_code
    ) returning * into v_saved;
  end if;

  delete from public.proforma_lines where proforma_header_id = v_saved.id;
  insert into public.proforma_lines (
    proforma_header_id, line_no, buyer_style_no, jm_style_no, description, color, size,
    hs_code, qty, uom, unit_price, currency, amount, upc_code
  )
  select v_saved.id, l.line_no, l.buyer_style_no, l.jm_style_no, l.description, l.color,
         l.size, l.hs_code, l.qty, l.uom, l.unit_price, l.currency, l.amount, l.upc_code
  from jsonb_populate_recordset(null::public.proforma_lines, p_lines) as l;

  return jsonb_build_object('header_id', v_saved.id, 'invoice_no', v_saved.invoice_no, 'updated', v_updated);
end;
$$;

revoke all on function public.save_proforma_with_monthly_number(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_proforma_with_monthly_number(jsonb, jsonb) to service_role;

notify pgrst, 'reload schema';

commit;
