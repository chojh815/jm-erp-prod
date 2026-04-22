create or replace function public.profitability_fact_app(
  p_start date default null,
  p_end date default null,
  p_preset text default null,
  p_buyer_ids uuid[] default null,
  p_vendor_ids uuid[] default null,
  p_site_ids uuid[] default null,
  p_q text default null,
  p_limit integer default 500
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  from public.profitability_fact(
    p_start,
    p_end,
    p_preset,
    p_buyer_ids,
    p_vendor_ids,
    p_site_ids,
    p_q,
    p_limit
  ) as t;
$$;

grant execute on function public.profitability_fact_app(
  date,
  date,
  text,
  uuid[],
  uuid[],
  uuid[],
  text,
  integer
) to anon, authenticated, service_role;
