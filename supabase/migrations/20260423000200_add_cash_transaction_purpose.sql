alter table public.cash_transactions
  add column if not exists purpose_code text,
  add column if not exists purpose_group text;

create index if not exists idx_cash_transactions_purpose_code
  on public.cash_transactions (purpose_code);

create index if not exists idx_cash_transactions_purpose_group
  on public.cash_transactions (purpose_group);
