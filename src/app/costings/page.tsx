'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import AppShell from '@/components/layout/AppShell';
import type { AppRole } from '@/config/menuConfig';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import { createSupabaseBrowserClient } from '@/lib/supabaseClient';

type DevRole = AppRole;

type CostingListRow = {
  id: string;
  style_no?: string | null;
  buyer_name?: string | null;
  buyer_code?: string | null;
  buyer_brand_name?: string | null;
  stage?: string | null;
  status?: string | null;
  updated_at?: string | null;
  created_at?: string | null;

  base_currency?: string | null;
  fx_cny_per_usd?: number | null;
  target_margin_pct?: number | null;
  offer_usd?: number | null;

  // delete guard
  quotation_id?: string | null;
  quotation_line_id?: string | null;
};

function n(v: unknown, fallback = 0) {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function fmtDate(s?: string | null) {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s);
  return d.toISOString().slice(0, 10);
}

function fmtNum(x: unknown, digits = 2) {
  const v = n(x, NaN);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export default function CostingsListPage() {
  const router = useRouter();
  const [role] = React.useState<DevRole>('admin' as DevRole);

  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [q, setQ] = React.useState('');
  const [rows, setRows] = React.useState<CostingListRow[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // ✅ IMPORTANT: select must match real DB columns
      const { data, error } = await supabase
        .from('costing_headers')
        .select(
          'id, style_no, buyer_name, buyer_code, stage, status, updated_at, created_at, buyer_brand_name, base_currency, fx_cny_per_usd, offer_usd, target_margin_pct, quotation_id, quotation_line_id'
        )
        .order('updated_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw error;
      setRows((data ?? []) as CostingListRow[]);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => {
      const hay = [
        r.id,
        r.style_no,
        r.buyer_name,
        r.buyer_code,
        r.buyer_brand_name,
        r.stage,
        r.status,
        r.base_currency,
      ]
        .map((x) => (x ?? '').toString().toLowerCase())
        .join(' ');
      return hay.includes(s);
    });
  }, [rows, q]);

  async function createNew() {
    setError(null);
    try {
      const tempStyle = `TMP-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;

      const { data, error } = await supabase
        .from('costing_headers')
        .insert([{ style_no: tempStyle, stage: 'SAMPLE', status: 'DRAFT', currency: 'CNY', base_currency: 'CNY' }])
        .select('id')
        .single();

      if (error) throw error;
      const id = data?.id;
      if (id) router.push(`/costings/${id}`);
      else throw new Error('Created but missing id');
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }


async function deleteRow(r: CostingListRow) {
  if (r.quotation_id || r.quotation_line_id) return;

  const ok = window.confirm('Delete this costing? (Only allowed when not linked to a Quotation)');
  if (!ok) return;

  setError(null);
  try {
    const { error } = await supabase.from('costing_headers').delete().eq('id', r.id);
    if (error) throw error;
    await load();
  } catch (e: any) {
    setError(e?.message ?? String(e));
  }
}


  return (
    <AppShell role={role}>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-2xl font-semibold">Costings</div>
            <div className="text-sm text-muted-foreground">List</div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={load} disabled={loading}>
              Refresh
            </Button>
            <Button onClick={createNew}>+ New</Button>
          </div>
        </div>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        ) : null}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Search</CardTitle>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search style / buyer / brand / status..."
              className="max-w-sm"
            />
          </CardHeader>

          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Updated</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Style</TableHead>
                    <TableHead>Buyer</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead className="text-right">Offer (USD)</TableHead>
                    <TableHead className="text-right">Margin %</TableHead>
                    <TableHead className="text-right">FX (CNY/USD)</TableHead>
                    <TableHead className="text-right">Delete</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {filtered.map((r) => (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => router.push(`/costings/${r.id}`)}
                    >
                      <TableCell className="whitespace-nowrap">{fmtDate(r.updated_at ?? r.created_at)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{(r.status ?? '—').toString()}</Badge>
                      </TableCell>
                      <TableCell>{(r.stage ?? '—').toString()}</TableCell>
                      <TableCell className="font-medium">{(r.style_no ?? '—').toString()}</TableCell>
                      <TableCell>{(r.buyer_name ?? r.buyer_code ?? '—').toString()}</TableCell>
                      <TableCell>{(r.buyer_brand_name ?? '—').toString()}</TableCell>
                      <TableCell className="text-right">{r.offer_usd == null ? '—' : fmtNum(r.offer_usd, 4)}</TableCell>
                      <TableCell className="text-right">
                        {r.target_margin_pct == null ? '—' : fmtNum(r.target_margin_pct, 2)}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.fx_cny_per_usd == null ? '—' : fmtNum(r.fx_cny_per_usd, 4)}
                      </TableCell>

<TableCell
  className="text-right"
  onClick={(e) => {
    e.stopPropagation();
  }}
>
  {r.quotation_id || r.quotation_line_id ? (
    <span className="text-xs text-muted-foreground">Linked</span>
  ) : (
    <Button
      type="button"
      variant="destructive"
      size="sm"
      onClick={(e) => {
        e.stopPropagation();
        deleteRow(r);
      }}
    >
      Delete
    </Button>
  )}
</TableCell>
                    </TableRow>
                  ))}

                  {!filtered.length ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center text-muted-foreground">
                        {loading ? 'Loading...' : 'No rows'}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>

            <div className="mt-3 text-xs text-muted-foreground">
              Tip: Offer/Margin/FX가 “—”면, 해당 row의 DB 값이 NULL이거나(저장 안 됨), Detail Save 로직이 컬럼명을 잘못 쓰는 경우입니다.
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
