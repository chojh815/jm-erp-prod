"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

type DevRole = AppRole;

type CostingListRow = {
  id: string;
  style_no?: string | null;
  buyer_name?: string | null;
  buyer_code?: string | null;
  buyer_brand_name?: string | null;
  stage?: string | null;
  status?: string | null;
  base_currency?: string | null;

  // ✅ DB 스키마 기준 정답 컬럼명
  fx_cny_per_usd?: number | null;
  target_margin_pct?: number | null;
  offer_usd?: number | null;

  // delete guard: only delete when not linked to quotation
  quotation_id?: string | null;
  quotation_line_id?: string | null;

  updated_at?: string | null;
  created_at?: string | null;
};

function num(x: any): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function fmtDate(s?: string | null) {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s);
  return d.toISOString().slice(0, 10);
}
function safeText(s?: any) {
  return (s ?? "").toString().trim();
}

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  let j: any = null;
  try {
    j = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) {
    const msg =
      j?.message ||
      j?.error_description ||
      j?.hint ||
      j?.details ||
      text ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return j;
}

function getRestBase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  return `${url.replace(/\/$/, "")}/rest/v1`;
}
function getAnonKey() {
  const k = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!k) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return k;
}

export default function CostingsListPage() {
  const router = useRouter();
  const [role] = React.useState<DevRole>("admin" as DevRole);

  const [rows, setRows] = React.useState<CostingListRow[]>([]);
  const [q, setQ] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const base = getRestBase();
      const anon = getAnonKey();

      // ✅ "실제 존재하는 컬럼명"으로만 select 구성 (이제 400 안 남)
      const select = [
        "id",
        "style_no",
        "buyer_name",
        "buyer_code",
        "stage",
        "status",
        "updated_at",
        "created_at",
        "buyer_brand_name",
        "base_currency",
        "fx_cny_per_usd",
        "offer_usd",
        "target_margin_pct",
        "quotation_id",
        "quotation_line_id",

      ].join(",");

      const url = `${base}/costing_headers?select=${encodeURIComponent(
        select
      )}&order=updated_at.desc,created_at.desc&limit=200`;

      const init = {
        headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      };

      const data = await fetchJson(url, init);
      const list = (Array.isArray(data) ? data : []) as CostingListRow[];
      setRows(list);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
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
        .map((x) => (x ?? "").toString().toLowerCase())
        .join(" ");
      return hay.includes(s);
    });
  }, [rows, q]);

  async function createNew() {
    setError(null);
    try {
      const base = getRestBase();
      const anon = getAnonKey();
      const init = {
        method: "POST",
        headers: {
          apikey: anon,
          Authorization: `Bearer ${anon}`,
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          style_no: `TMP-${new Date()
            .toISOString()
            .replace(/[-:TZ.]/g, "")
            .slice(0, 14)}`,
          status: "DRAFT",
          stage: "SAMPLE",
        }),
      };

      const data = await fetchJson(`${base}/costing_headers`, init);
      const created = Array.isArray(data) ? data[0] : data;
      const id = created?.id;
      if (id) router.push(`/costings/${id}`);
      else throw new Error("Created, but missing id");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }


async function deleteRow(r: CostingListRow) {
  if (r.quotation_id || r.quotation_line_id) {
    setError("Delete is allowed only when NOT linked to a Quotation.");
    return;
  }

  const ok = window.confirm("Delete this costing? (Only allowed when not linked to a Quotation)");
  if (!ok) return;

  setError(null);
  setLoading(true);
  try {
    const base = getRestBase();
    const anon = getAnonKey();
    const headers = { apikey: anon, Authorization: `Bearer ${anon}` };

    // Best-effort: delete child rows first (ignore failures if table doesn't exist)
    const childTables = [
      { table: "costing_material_lines", fk: "costing_id" },
      { table: "costing_operation_lines", fk: "costing_id" },
      { table: "costing_fx_valuations", fk: "costing_id" },
    ];

    for (const t of childTables) {
      try {
        const url = `${base}/${t.table}?${t.fk}=eq.${encodeURIComponent(r.id)}`;
        const res = await fetch(url, { method: "DELETE", headers });
        // Ignore 404/400 (missing table / no route), but keep real errors
        if (!res.ok && res.status >= 500) {
          const txt = await res.text().catch(() => "");
          throw new Error(txt || `Failed deleting ${t.table}`);
        }
      } catch {
        // ignore
      }
    }

    // Delete header
    const url = `${base}/costing_headers?id=eq.${encodeURIComponent(r.id)}`;
    const res = await fetch(url, { method: "DELETE", headers });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(txt || `Delete failed (HTTP ${res.status})`);
    }

    await load();
  } catch (e: any) {
    setError(e?.message ?? String(e));
  } finally {
    setLoading(false);
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
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
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
                      <TableCell className="whitespace-nowrap">
                        {fmtDate(r.updated_at ?? r.created_at)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{safeText(r.status || "—")}</Badge>
                      </TableCell>
                      <TableCell>{safeText(r.stage || "—")}</TableCell>
                      <TableCell className="font-medium">
                        {safeText(r.style_no || "—")}
                      </TableCell>
                      <TableCell>{safeText(r.buyer_name || r.buyer_code || "—")}</TableCell>
                      <TableCell>{safeText(r.buyer_brand_name || "—")}</TableCell>

                      {/* ✅ DB 컬럼명으로 출력 */}
                      <TableCell className="text-right">
                        {r.offer_usd == null ? "—" : num(r.offer_usd).toFixed(4)}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.target_margin_pct == null ? "—" : num(r.target_margin_pct).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.fx_cny_per_usd == null ? "—" : num(r.fx_cny_per_usd).toFixed(4)}
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
                        {loading ? "Loading..." : "No rows"}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
