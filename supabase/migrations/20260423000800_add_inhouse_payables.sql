create table if not exists public.inhouse_payables (
  id uuid primary key default gen_random_uuid(),
  work_sheet_id uuid references public.work_sheet_headers(id),
  work_sheet_line_id uuid references public.work_sheet_lines(id),
  work_sheet_material_spec_id uuid references public.work_sheet_material_specs(id),
  vendor_id uuid references public.companies(id),
  po_no text,
  work_sheet_no text,
  vendor_name text,
  style_no text,
  buyer_style text,
  payable_type text not null check (payable_type in ('MATERIAL', 'PROCESSING')),
  source_type text not null default 'WORK_SHEET' check (source_type in ('WORK_SHEET', 'EXTRA')),
  reason_code text,
  entry_date date not null,
  item_name text not null,
  spec_text text,
  qty numeric(18, 2) not null default 0,
  currency text not null default 'CNY',
  unit_cost numeric(18, 4) not null default 0,
  gross_amount numeric(18, 2) generated always as (round(qty * unit_cost, 2)) stored,
  payment_terms_days integer not null default 60,
  due_date date not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'PAID', 'VOID')),
  paid_amount numeric(18, 2) not null default 0,
  paid_date date,
  payment_account_id uuid references public.cash_accounts(id),
  payment_method text,
  cash_transaction_id uuid references public.cash_transactions(id),
  note text,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_inhouse_payables_due_date
  on public.inhouse_payables (due_date);

create index if not exists idx_inhouse_payables_vendor
  on public.inhouse_payables (vendor_id);

create index if not exists idx_inhouse_payables_work_sheet
  on public.inhouse_payables (work_sheet_id);

create index if not exists idx_inhouse_payables_work_sheet_line
  on public.inhouse_payables (work_sheet_line_id);

create index if not exists idx_inhouse_payables_material_spec
  on public.inhouse_payables (work_sheet_material_spec_id);

create index if not exists idx_inhouse_payables_cash_transaction
  on public.inhouse_payables (cash_transaction_id);

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception
  when others then
    null;
end;
$$;
