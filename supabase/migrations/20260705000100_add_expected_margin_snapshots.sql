create table if not exists public.expected_margin_fx_rates (
  id uuid primary key default gen_random_uuid(),
  effective_month date not null unique,
  cny_per_usd numeric(18, 6) not null check (cny_per_usd > 0),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_email text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_email text
);

create table if not exists public.expected_margin_snapshots (
  id uuid primary key default gen_random_uuid(),
  po_header_id uuid not null references public.po_headers(id) on delete cascade,
  po_line_id uuid not null references public.po_lines(id) on delete cascade,
  po_no text,
  line_no integer,
  jm_style_no text,
  buyer_style_no text,
  qty numeric(18, 4) not null default 0,
  unit_price_usd numeric(18, 6) not null default 0,
  revenue_usd numeric(18, 2) not null default 0,
  source_cost_currency text,
  source_unit_cost_local numeric(18, 6),
  cny_per_usd numeric(18, 6),
  expected_unit_cost_usd numeric(18, 6),
  optional_unit_cost_usd numeric(18, 6) not null default 0,
  total_unit_cost_usd numeric(18, 6),
  expected_cogs_usd numeric(18, 2),
  expected_margin_usd numeric(18, 2),
  expected_margin_pct numeric(18, 8),
  cost_source text not null default 'PRODUCT_DEVELOPMENT',
  snapshot_at timestamptz not null default now(),
  confirmed_at timestamptz,
  created_by uuid,
  created_by_email text,
  constraint expected_margin_snapshots_po_line_unique unique (po_line_id)
);

create index if not exists expected_margin_snapshots_po_header_idx
  on public.expected_margin_snapshots(po_header_id);

create index if not exists expected_margin_snapshots_po_no_idx
  on public.expected_margin_snapshots(po_no);

create index if not exists expected_margin_fx_rates_month_idx
  on public.expected_margin_fx_rates(effective_month desc);

alter table public.expected_margin_fx_rates enable row level security;
alter table public.expected_margin_snapshots enable row level security;

comment on table public.expected_margin_fx_rates is
  'Monthly management FX rate expressed as CNY per 1 USD.';

comment on table public.expected_margin_snapshots is
  'Immutable order-confirmation expected margin snapshot by PO line.';
