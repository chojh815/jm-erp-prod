create table if not exists subcontract_advances (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references companies(id),
  vendor_name text,
  advance_date date not null,
  currency text not null default 'CNY',
  amount numeric(18, 2) not null default 0,
  applied_amount numeric(18, 2) not null default 0,
  status text not null default 'OPEN' check (status in ('OPEN', 'APPLIED', 'VOID')),
  payment_account_id uuid references cash_accounts(id),
  payment_method text,
  cash_transaction_id uuid references cash_transactions(id),
  note text,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_subcontract_advances_vendor on subcontract_advances(vendor_id);
create index if not exists idx_subcontract_advances_date on subcontract_advances(advance_date);
create index if not exists idx_subcontract_advances_status on subcontract_advances(status);

alter table receipt_headers
  add column if not exists responsible_vendor_id uuid references companies(id),
  add column if not exists responsible_vendor_name text,
  add column if not exists subcontract_deduction_amount numeric(18, 2) not null default 0;

alter table subcontract_payables
  add column if not exists advance_applied_amount numeric(18, 2) not null default 0,
  add column if not exists claim_receipt_header_id uuid references receipt_headers(id),
  add column if not exists payment_batch_no text;

notify pgrst, 'reload schema';
