alter table public.subcontract_payables
  add column if not exists payment_account_id uuid references public.cash_accounts(id),
  add column if not exists payment_method text,
  add column if not exists cash_transaction_id uuid references public.cash_transactions(id);

create index if not exists idx_subcontract_payables_payment_account
  on public.subcontract_payables (payment_account_id);

create index if not exists idx_subcontract_payables_cash_transaction
  on public.subcontract_payables (cash_transaction_id);

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception
  when others then
    null;
end;
$$;
