import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function csvEscape(v: any) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  const escaped = s.replace(/"/g, '""'); // " -> ""
  // 콤마/따옴표/개행 있으면 CSV 규칙상 전체를 "..."로 감싸야 함
  if (/[",\n\r]/.test(escaped)) return `"${escaped}"`;
  return escaped;
}

function toCsv(rows: Record<string, any>[]) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const header = cols.map(csvEscape).join(',');
  const body = rows.map(r => cols.map(c => csvEscape(r[c])).join(',')).join('\n');
  return `${header}\n${body}\n`;
}

function getEnv(name: string) {
  return process.env[name] || '';
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return new NextResponse('Invalid quotation id', { status: 400 });

  const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL') || getEnv('SUPABASE_URL');
  const serviceKey =
    getEnv('SUPABASE_SERVICE_ROLE_KEY') ||
    getEnv('SUPABASE_SERVICE_KEY') ||
    getEnv('SUPABASE_SERVICE_ROLE') ||
    getEnv('SUPABASE_SECRET');

  if (!supabaseUrl || !serviceKey) {
    return new NextResponse('Missing SUPABASE env (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)', {
      status: 500,
    });
  }

  const supabase = createSupabaseClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const headerRes = await supabase.from('quotation_headers').select('*').eq('id', id).maybeSingle();
  if (headerRes.error) return new NextResponse(headerRes.error.message, { status: 500 });
  if (!headerRes.data) return new NextResponse('Quotation not found', { status: 404 });
  const h: any = headerRes.data;

  // Lines (prefer quotation_variant_lines if present; fallback to quotation_lines)
  let lines: any[] = [];
  const vlRes = await supabase
    .from('quotation_variant_lines')
    .select('*')
    .eq('quotation_id', id)
    .order('line_no', { ascending: true });

  if (!vlRes.error && Array.isArray(vlRes.data) && vlRes.data.length) {
    lines = vlRes.data as any[];
  } else {
    const lRes = await supabase
      .from('quotation_lines')
      .select('*')
      .eq('quotation_id', id)
      .order('line_no', { ascending: true });
    if (!lRes.error && Array.isArray(lRes.data)) lines = lRes.data as any[];
  }

  // Buyer display (optional)
  let buyer = '';
  if (h.buyer_id) {
    const bRes = await supabase.from('companies').select('code,name').eq('id', h.buyer_id).maybeSingle();
    if (!bRes.error && bRes.data) {
      buyer = `${bRes.data.code || ''}${bRes.data.code ? ' - ' : ''}${bRes.data.name || ''}`.trim();
    }
  }

  const base = {
    quotation_no: h.quotation_no || h.quote_no || '',
    status: h.status || '',
    received_date: h.received_date || h.created_at || '',
    buyer,
    brand: h.brand_name || h.brand || h.buyer_brand_name || '',
    subject: h.subject || '',
    remarks: h.remarks || '',
  };

  const rows = (lines.length ? lines : [{}]).map((ln, idx) => ({
    ...base,
    line_no: ln.line_no ?? idx + 1,
    style_no: ln.style_no || ln.buyer_style_no || ln.jm_style_no || '',
    description: ln.description || ln.style_name || ln.item_name || '',
    qty: ln.qty ?? ln.quantity ?? '',
    offer_price_usd: ln.offer_price_usd ?? ln.offer_usd ?? ln.price_usd ?? '',
    margin_pct: ln.margin_pct ?? ln.margin_percent ?? '',
    cost_cny: ln.cost_cny ?? ln.total_cost_cny ?? '',
    cost_usd: ln.cost_usd ?? ln.total_cost_usd ?? '',
    fx_rate_to_usd: ln.fx_rate_to_usd ?? ln.fx_rate ?? '',
  }));

  const csv = toCsv(rows);
  const filename = `${base.quotation_no || 'quotation'}.csv`;

  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
