alter table public.cash_accounts
  add column if not exists account_holder_name text,
  add column if not exists swift_code text,
  add column if not exists bank_address text,
  add column if not exists beneficiary_address text,
  add column if not exists bank_detail_note text;
