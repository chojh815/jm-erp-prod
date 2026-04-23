alter table public.subcontract_payables
  add column if not exists claim_deduction_amount numeric(18, 2) not null default 0,
  add column if not exists other_deduction_amount numeric(18, 2) not null default 0;

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception
  when others then
    null;
end;
$$;
