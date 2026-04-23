create table if not exists public.buyer_credits (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null,
  buyer_name text null,
  buyer_code text null,
  invoice_id uuid null,
  invoice_no text null,
  source_receipt_header_id uuid null,
  amount_total numeric(18,2) not null default 0,
  applied_to_invoice_amount numeric(18,2) not null default 0,
  applied_to_receipts_amount numeric(18,2) not null default 0,
  available_amount numeric(18,2) not null default 0,
  status text not null default 'OPEN',
  reference_no text null,
  note text null,
  responsible_vendor_id uuid null,
  responsible_vendor_name text null,
  subcontract_deduction_amount numeric(18,2) not null default 0,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_buyer_credits_buyer_id
  on public.buyer_credits (buyer_id);

create index if not exists idx_buyer_credits_invoice_id
  on public.buyer_credits (invoice_id);

create index if not exists idx_buyer_credits_status
  on public.buyer_credits (status);

alter table public.receipt_headers
  add column if not exists credit_applied_amount numeric(18,2) not null default 0;

notify pgrst, 'reload schema';
