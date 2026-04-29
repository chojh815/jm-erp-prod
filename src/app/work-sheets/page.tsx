// src/app/work-sheets/page.tsx
"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type DevRole = AppRole;

type Row = {
  id: string;
  po_no: string | null;
  ws_no?: string | null;
  buyer_name: string | null;
  buyer_code: string | null;
  buyer_style?: string | null;
  jm_style?: string | null;
  qty?: number | null;
  lp_currency?: string | null;
  lp_unit?: number | null;
  production_mode?: string | null;
  delivery_date?: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const UI_STATE_KEY = "ws_list_ui_state_v1";

function fmtDate(s: string | null) {
  if (!s) return "-";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toISOString().slice(0, 10);
}

function fmtNum(n: any) {
  if (n === null || n === undefined || n === "") return "-";
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return "-";
  return v.toLocaleString();
}

function fmtMoney(cur: any, n: any) {
  if (n === null || n === undefined || n === "") return "-";
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return "-";
  const c = String(cur ?? "").trim() || "CNY";
  return `${c} ${v.toFixed(2)}`;
}

function fmtMode(m?: string | null) {
  const v = String(m ?? "").toUpperCase();
  if (!v) return "-";
  return v === "OUTSOURCED" ? "OUT" : v === "IN_HOUSE" ? "IN" : v;
}

function statusBadge(st?: string | null) {
  const v = String(st ?? "").toUpperCase();
  const base = "inline-block rounded px-2 py-0.5 text-xs font-medium";

  if (v === "SENT") {
    return <span className={`${base} bg-blue-100 text-blue-700`}>SENT</span>;
  }
  if (v === "READY") {
    return <span className={`${base} bg-amber-100 text-amber-700`}>READY</span>;
  }
  if (v === "CLOSED") {
    return <span className={`${base} bg-gray-200 text-gray-700`}>CLOSED</span>;
  }
  return <span className={`${base} bg-green-100 text-green-700`}>DRAFT</span>;
}

function buildQueryString(params: {
  q?: string;
  status?: string;
  selectedId?: string | null;
}) {
  const sp = new URLSearchParams();
  if (params.q && params.q.trim()) sp.set("q", params.q.trim());
  if (params.status && params.status !== "ALL") sp.set("status", params.status);
  if (params.selectedId) sp.set("selected_id", params.selectedId);
  return sp.toString();
}

export default function WorkSheetsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const role: DevRole = "admin";

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<Row[]>([]);

  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<string>("ALL");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const rowRefs = React.useRef<Record<string, HTMLTableRowElement | null>>({});
  const restoredScrollRef = React.useRef(false);

  // URL -> state
  React.useEffect(() => {
    setQ(searchParams.get("q") ?? "");
    setStatus(searchParams.get("status") ?? "ALL");
    setSelectedId(searchParams.get("selected_id") ?? null);
  }, [searchParams]);

  // load list from current URL state
  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      const qParam = searchParams.get("q") ?? "";
      const statusParam = searchParams.get("status") ?? "ALL";

      if (qParam.trim()) sp.set("q", qParam.trim());
      if (statusParam !== "ALL") sp.set("status", statusParam);

      const res = await fetch(`/api/work-sheets/list?${sp.toString()}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || "Load failed");
      setRows(Array.isArray(json.rows) ? json.rows : []);
    } catch (e: any) {
      setError(e?.message ?? "Error");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  React.useEffect(() => {
    load();
  }, [load]);

  // Restore selected row + scroll after rows load
  React.useEffect(() => {
    if (loading || rows.length === 0 || restoredScrollRef.current) return;

    try {
      const raw = window.sessionStorage.getItem(UI_STATE_KEY);
      if (!raw) return;

      const state = JSON.parse(raw) as {
        pathname?: string;
        q?: string;
        status?: string;
        selectedId?: string | null;
        scrollY?: number;
      };

      const currentQ = searchParams.get("q") ?? "";
      const currentStatus = searchParams.get("status") ?? "ALL";

      const samePage =
        state?.pathname === pathname &&
        (state?.q ?? "") === currentQ &&
        (state?.status ?? "ALL") === currentStatus;

      if (!samePage) return;

      if (state?.selectedId) {
        setSelectedId(state.selectedId);
      }

      window.requestAnimationFrame(() => {
        if (typeof state?.scrollY === "number") {
          window.scrollTo({ top: state.scrollY, behavior: "auto" });
        } else if (state?.selectedId && rowRefs.current[state.selectedId]) {
          rowRefs.current[state.selectedId]?.scrollIntoView({
            block: "center",
            behavior: "auto",
          });
        }
      });

      restoredScrollRef.current = true;
    } catch {
      // ignore restore failure
    }
  }, [loading, rows, pathname, searchParams]);

  const persistUiState = React.useCallback(
    (nextSelectedId?: string | null) => {
      try {
        const state = {
          pathname,
          q: searchParams.get("q") ?? "",
          status: searchParams.get("status") ?? "ALL",
          selectedId: nextSelectedId ?? selectedId ?? null,
          scrollY: window.scrollY,
        };
        window.sessionStorage.setItem(UI_STATE_KEY, JSON.stringify(state));
      } catch {
        // ignore persist failure
      }
    },
    [pathname, searchParams, selectedId]
  );

  const handleSearch = React.useCallback(() => {
    restoredScrollRef.current = false;
    const qs = buildQueryString({
      q,
      status,
      selectedId: null,
    });
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [pathname, q, router, status]);

  const handleRefresh = React.useCallback(() => {
    load();
  }, [load]);

  const handleRowClick = React.useCallback(
    (id: string) => {
      setSelectedId(id);
      const qs = buildQueryString({
        q,
        status,
        selectedId: id,
      });
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, q, router, status]
  );

  function openPdf(id: string) {
    persistUiState(id);
    window.open(`/work-sheets/${id}/pdf`, "_blank", "noopener,noreferrer");
  }

  function openDetail(id: string) {
    persistUiState(id);
    router.push(`/work-sheets/${id}`);
  }

  return (
    <AppShell role={role}>
      <div className="p-6 space-y-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Work Sheets</CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={handleRefresh} disabled={loading}>
                Refresh
              </Button>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="w-[280px]"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSearch();
                }}
                placeholder="Search PO / WS / Buyer / Style"
              />
              <div className="w-[180px]">
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All</SelectItem>
                    <SelectItem value="DRAFT">DRAFT</SelectItem>
                    <SelectItem value="READY">READY</SelectItem>
                    <SelectItem value="SENT">SENT</SelectItem>
                    <SelectItem value="CLOSED">CLOSED</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleSearch} disabled={loading}>
                Search
              </Button>
            </div>

            {error ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                {error}
              </div>
            ) : null}

            <div className="overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="p-2 text-left">PO No</th>
                    <th className="p-2 text-left">WS No</th>
                    <th className="p-2 text-left">Buyer</th>
                    <th className="p-2 text-left">Style</th>
                    <th className="p-2 text-right">Qty</th>
                    <th className="p-2 text-left">L.P</th>
                    <th className="p-2 text-left">Mode</th>
                    <th className="p-2 text-left">Delivery</th>
                    <th className="p-2 text-left">Status</th>
                    <th className="p-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td className="p-4 text-muted-foreground" colSpan={10}>
                        Loading...
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td className="p-4 text-muted-foreground" colSpan={10}>
                        No work sheets.
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => {
                      const selected = selectedId === r.id;
                      return (
                        <tr
                          key={r.id}
                          ref={(el) => {
                            rowRefs.current[r.id] = el;
                          }}
                          className={`border-t cursor-pointer hover:bg-sky-50 ${
                            selected ? "bg-sky-50" : ""
                          }`}
                          onClick={() => handleRowClick(r.id)}
                        >
                          <td className="p-2 font-medium">{r.po_no ?? "-"}</td>
                          <td className="p-2">{r.ws_no ?? "-"}</td>
                          <td className="p-2">
                            {r.buyer_name ?? "-"}{" "}
                            {r.buyer_code ? (
                              <span className="text-xs text-muted-foreground">
                                ({r.buyer_code})
                              </span>
                            ) : null}
                          </td>
                          <td className="p-2">
                            <div className="leading-tight">
                              <div className="font-medium">{r.buyer_style ?? "-"}</div>
                              {r.jm_style ? (
                                <div className="text-xs text-muted-foreground">{r.jm_style}</div>
                              ) : null}
                            </div>
                          </td>
                          <td className="p-2 text-right tabular-nums">{fmtNum(r.qty)}</td>
                          <td className="p-2 tabular-nums">{fmtMoney(r.lp_currency, r.lp_unit)}</td>
                          <td className="p-2">{fmtMode(r.production_mode)}</td>
                          <td className="p-2">{fmtDate(r.delivery_date ?? null)}</td>
                          <td className="p-2">{statusBadge(r.status)}</td>
                          <td className="p-2 text-right">
                            <div className="inline-flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openDetail(r.id);
                                }}
                              >
                                Detail
                              </Button>
                              <Button
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openPdf(r.id);
                                }}
                              >
                                PDF (Vendor)
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="text-xs text-muted-foreground">
              PDF(Vendor)는 새 탭에서 자동 생성/인쇄됩니다. (Buyer 가격/마진 없음)
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
