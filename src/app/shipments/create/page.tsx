"use client";

import * as React from "react";
import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";

type DevRole = AppRole;

type ShipMode = "SEA" | "AIR" | "COURIER";

function safe(v: any) {
  return (v ?? "").toString().trim();
}
function num(v: any, fallback = 0) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function money(v: any, currency = "USD") {
  const n = num(v, 0);
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}
function normalizeMode(v: any): ShipMode {
  const s = safe(v).toUpperCase();
  if (s.includes("AIR")) return "AIR";
  if (s.includes("COURIER") || s.includes("DHL") || s.includes("FEDEX") || s.includes("UPS"))
    return "COURIER";
  // default SEA
  return "SEA";
}
function pickFirst(obj: any, keys: string[]) {
  for (const k of keys) {
    const val = obj?.[k];
    if (val !== null && val !== undefined && safe(val) !== "") return val;
  }
  return "";
}

type PoHeader = any;
type PoLine = any;

type AllocationRow = {
  id: string; // client local id
  po_id: string;
  po_no: string;
  po_line_id: string;
  line_no: number | null;

  style_no: string;
  description: string;
  color: string;
  size: string;

  order_qty: number;
  shipped_qty: number;

  unit_price: number;
  amount: number;

  cartons: number;
  gw_per_ctn: number;
  nw_per_ctn: number;

  include: boolean;

  ship_mode: ShipMode;
  carrier: string;
  tracking_no: string;
};

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export default function ShipmentsCreateFromPoPage() {
  const role: DevRole = "admin" as any; // keep consistent with your other pages
  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);

  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  // PO list
  const [poKeyword, setPoKeyword] = React.useState("");
  const [poHeaders, setPoHeaders] = React.useState<PoHeader[]>([]);
  const [selectedPoIds, setSelectedPoIds] = React.useState<string[]>([]);

  // Loaded details
  const [selectedHeaders, setSelectedHeaders] = React.useState<PoHeader[]>([]);
  const [allocs, setAllocs] = React.useState<AllocationRow[]>([]);

  const selectedBuyerId = React.useMemo(() => {
    const h = selectedHeaders?.[0];
    return (
      pickFirst(h, ["buyer_company_id", "buyer_id", "company_id"]) || ""
    );
  }, [selectedHeaders]);

  // ---- Load PO headers (CONFIRMED only if column exists) ----
  const loadPoList = React.useCallback(async () => {
    setLoading(true);
    try {
      // Try to filter by status/is_deleted if columns exist (fallback safely)
      let q = supabase.from("po_headers").select("*").order("created_at", { ascending: false }).limit(500);

      // best-effort: apply is_deleted=false if exists (ignore errors by retry)
      const tryRun = async (qq: any) => {
        const { data, error } = await qq;
        if (error) throw error;
        return data ?? [];
      };

      try {
        const data = await tryRun(q.eq("is_deleted", false));
        setPoHeaders(data);
        return;
      } catch {}

      try {
        const data = await tryRun(q);
        setPoHeaders(data);
      } catch (e: any) {
        console.error(e);
        alert(`PO list load failed: ${e?.message ?? e}`);
      }
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  React.useEffect(() => {
    loadPoList();
  }, [loadPoList]);

  const filteredPoHeaders = React.useMemo(() => {
    const kw = safe(poKeyword).toUpperCase();
    if (!kw) return poHeaders;
    return poHeaders.filter((h) => {
      const poNo = safe(pickFirst(h, ["po_no", "poNo"])).toUpperCase();
      const buyer = safe(pickFirst(h, ["buyer_name", "buyerName"])).toUpperCase();
      const brand = safe(pickFirst(h, ["buyer_brand_name", "brand"])).toUpperCase();
      return poNo.includes(kw) || buyer.includes(kw) || brand.includes(kw);
    });
  }, [poHeaders, poKeyword]);

  const togglePo = (po_id: string, checked: boolean) => {
    setSelectedPoIds((prev) => {
      if (checked) return prev.includes(po_id) ? prev : [...prev, po_id];
      return prev.filter((x) => x !== po_id);
    });
  };

  // When selection changes: load headers + lines
  React.useEffect(() => {
    (async () => {
      if (selectedPoIds.length === 0) {
        setSelectedHeaders([]);
        setAllocs([]);
        return;
      }
      setLoading(true);
      try {
        const { data: headers, error: hErr } = await supabase
          .from("po_headers")
          .select("*")
          .in("id", selectedPoIds);

        if (hErr) throw hErr;

        const hs = headers ?? [];
        // Enforce "same buyer" rule
        const buyerKey = pickFirst(hs[0], ["buyer_company_id", "buyer_id", "company_id"]);
        const allSameBuyer = hs.every((x) => {
          const b = pickFirst(x, ["buyer_company_id", "buyer_id", "company_id"]);
          return safe(b) === safe(buyerKey);
        });
        if (!allSameBuyer) {
          alert("한 Shipment에는 같은 Buyer의 PO만 선택 가능합니다. (Different Buyer detected)");
          setSelectedPoIds([hs[0]?.id].filter(Boolean));
          return;
        }

        setSelectedHeaders(hs);

        const { data: lines, error: lErr } = await supabase
          .from("po_lines")
          .select("*")
          .in("po_header_id", selectedPoIds);

        if (lErr) throw lErr;

        const headerMode = normalizeMode(pickFirst(hs[0], ["ship_mode", "shipMode", "shipmode"]));

        const rows: AllocationRow[] = (lines ?? [])
          .filter((ln) => {
            const isDel = ln?.is_deleted;
            return isDel === undefined ? true : isDel === false;
          })
          .map((ln: PoLine) => {
            const po_id = ln.po_header_id;
            const header = hs.find((x) => x.id === po_id);
            const po_no = pickFirst(header, ["po_no", "poNo"]);
            const mode = normalizeMode(pickFirst(ln, ["ship_mode", "shipMode"]) || pickFirst(header, ["ship_mode", "shipMode"]) || headerMode);

            const orderQty = num(pickFirst(ln, ["qty", "order_qty", "orderQty"]), 0);
            const unitPrice = num(pickFirst(ln, ["unit_price", "unitPrice"]), 0);
            const amt = num(pickFirst(ln, ["amount"]), orderQty * unitPrice);

            const style = pickFirst(ln, ["buyer_style_no", "buyer_style_code", "style_no", "jm_style_no", "jm_style_code"]);

            return {
              id: uid(),
              po_id,
              po_no: safe(po_no),
              po_line_id: ln.id,
              line_no: ln.line_no ?? null,
              style_no: safe(style),
              description: safe(pickFirst(ln, ["description"])),
              color: safe(pickFirst(ln, ["color"])),
              size: safe(pickFirst(ln, ["size"])),
              order_qty: orderQty,
              shipped_qty: orderQty,
              unit_price: unitPrice,
              amount: amt,
              cartons: 0,
              gw_per_ctn: 0,
              nw_per_ctn: 0,
              include: true,
              ship_mode: mode,
              carrier: "",
              tracking_no: "",
            };
          });

        // sort stable: PO -> line_no
        rows.sort((a, b) => {
          if (a.po_no !== b.po_no) return a.po_no.localeCompare(b.po_no);
          return (a.line_no ?? 0) - (b.line_no ?? 0);
        });

        setAllocs(rows);
      } catch (e: any) {
        console.error(e);
        alert(`Load failed: ${e?.message ?? e}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedPoIds, supabase]);

  const summary = React.useMemo(() => {
    const inc = allocs.filter((r) => r.include && num(r.shipped_qty, 0) > 0);
    const totalCartons = inc.reduce((acc, r) => acc + num(r.cartons, 0), 0);
    const totalGW = inc.reduce((acc, r) => acc + num(r.cartons, 0) * num(r.gw_per_ctn, 0), 0);
    const totalNW = inc.reduce((acc, r) => acc + num(r.cartons, 0) * num(r.nw_per_ctn, 0), 0);
    const currency = safe(pickFirst(selectedHeaders?.[0], ["currency"])) || "USD";
    const totalAmount = inc.reduce((acc, r) => acc + num(r.shipped_qty, 0) * num(r.unit_price, 0), 0);

    const byMode: Record<ShipMode, { qty: number; amount: number }> = {
      SEA: { qty: 0, amount: 0 },
      AIR: { qty: 0, amount: 0 },
      COURIER: { qty: 0, amount: 0 },
    };
    for (const r of inc) {
      const m = r.ship_mode;
      byMode[m].qty += num(r.shipped_qty, 0);
      byMode[m].amount += num(r.shipped_qty, 0) * num(r.unit_price, 0);
    }

    return { totalCartons, totalGW, totalNW, totalAmount, currency, byMode };
  }, [allocs, selectedHeaders]);

  const updateAlloc = (id: string, patch: Partial<AllocationRow>) => {
    setAllocs((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const splitRow = (id: string) => {
    const row = allocs.find((r) => r.id === id);
    if (!row) return;

    const max = num(row.shipped_qty, 0);
    if (max <= 0) {
      alert("Shipped Qty가 0이면 split 할 수 없습니다.");
      return;
    }
    const input = window.prompt(`Split qty (0 ~ ${max})`, String(Math.floor(max / 2)));
    if (input === null) return;

    const splitQty = num(input, NaN as any);
    if (!Number.isFinite(splitQty) || splitQty <= 0 || splitQty >= max) {
      alert("Invalid split qty");
      return;
    }

    // current row becomes splitQty, new row is remainder
    const remain = max - splitQty;

    setAllocs((prev) => {
      const next: AllocationRow[] = [];
      for (const r of prev) {
        if (r.id !== id) {
          next.push(r);
          continue;
        }
        next.push({ ...r, shipped_qty: splitQty });
        next.push({
          ...r,
          id: uid(),
          shipped_qty: remain,
          // keep same line_no but visually it is a split allocation
        });
      }
      return next;
    });
  };

  const removeRow = (id: string) => {
    setAllocs((prev) => prev.filter((r) => r.id !== id));
  };

  const save = async () => {
    const po_ids = selectedHeaders.map((h) => h.id).filter(Boolean);
    if (po_ids.length === 0) {
      alert("PO를 선택하세요.");
      return;
    }

    const lines = allocs
      .filter((r) => r.include && num(r.shipped_qty, 0) > 0)
      .map((r) => ({
        po_id: r.po_id,
        po_line_id: r.po_line_id,
        shipped_qty: num(r.shipped_qty, 0),
        ship_mode: r.ship_mode,
        carrier: safe(r.carrier),
        tracking_no: safe(r.tracking_no),
      }));

    if (lines.length === 0) {
      alert("출고할 라인이 없습니다. (Shipped Qty > 0 필요)");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/shipments/create-from-po", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ po_ids, lines }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }

      const created = json?.created ?? [];
      const ids = created.map((x: any) => x.shipment_id).filter(Boolean);

      alert(`Saved. Created Shipment(s): ${created.length}`);
      // After create, go to first shipment detail if you want:
      if (ids.length === 1) {
        window.location.href = `/shipments/${ids[0]}`;
      } else if (ids.length > 1) {
        // stay; user can see list
        // reload PO list maybe
      }
    } catch (e: any) {
      console.error(e);
      alert(`Save failed: ${e?.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  const header0 = selectedHeaders?.[0] ?? null;
  const buyerName = safe(pickFirst(header0, ["buyer_name", "buyerName"]));
  const currency = safe(pickFirst(header0, ["currency"])) || "USD";
  const shipDate = safe(pickFirst(header0, ["requested_ship_date", "ship_date", "shipDate"]));
  const incoterm = safe(pickFirst(header0, ["incoterm"]));
  const paymentTerm = safe(pickFirst(header0, ["payment_term", "paymentTerm"]));
  const destination = safe(pickFirst(header0, ["final_destination", "destination"]));
  const shippingOrigin = safe(pickFirst(header0, ["shipping_origin", "origin"]));

  return (
    <AppShell role={role} title="Shipments" description="Create Shipment from PO (A-plan: split by mode)">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>1. Select PO(s)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Input
                value={poKeyword}
                onChange={(e) => setPoKeyword(e.target.value)}
                placeholder="Search PO / Buyer / Brand..."
              />
              <Button variant="secondary" onClick={loadPoList} disabled={loading}>
                Refresh
              </Button>
            </div>

            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[70px]">Select</TableHead>
                    <TableHead>PO No</TableHead>
                    <TableHead>Buyer</TableHead>
                    <TableHead>Order Date</TableHead>
                    <TableHead>Ship Date</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPoHeaders.map((h) => {
                    const id = h.id;
                    const checked = selectedPoIds.includes(id);
                    const poNo = safe(pickFirst(h, ["po_no", "poNo"]));
                    const buyer = safe(pickFirst(h, ["buyer_name", "buyerName"]));
                    const od = safe(pickFirst(h, ["order_date", "created_at", "orderDate"])).slice(0, 10);
                    const sd = safe(pickFirst(h, ["requested_ship_date", "ship_date", "shipDate"])).slice(0, 10);
                    const cur = safe(pickFirst(h, ["currency"])) || "USD";
                    const st = safe(pickFirst(h, ["status"])) || "";
                    return (
                      <TableRow key={id}>
                        <TableCell>
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => togglePo(id, Boolean(v))}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{poNo}</TableCell>
                        <TableCell>{buyer}</TableCell>
                        <TableCell>{od}</TableCell>
                        <TableCell>{sd}</TableCell>
                        <TableCell>{cur}</TableCell>
                        <TableCell>{st}</TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredPoHeaders.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-muted-foreground">
                        No PO found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="text-sm text-muted-foreground">
              * 한 Shipment에는 같은 Buyer의 PO만 선택 가능합니다.
            </div>
          </CardContent>
        </Card>

        {selectedPoIds.length > 0 && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>2. Shipment Details from Selected PO(s)</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-sm font-semibold">PO(s)</div>
                  <div className="text-sm">{selectedHeaders.length} — {selectedHeaders.map(h=>safe(pickFirst(h,["po_no"]))).join(", ")}</div>
                </div>
                <div>
                  <div className="text-sm font-semibold">Buyer</div>
                  <div className="text-sm">{buyerName || "-"}</div>
                </div>
                <div>
                  <div className="text-sm font-semibold">Currency</div>
                  <div className="text-sm">{currency}</div>
                </div>
                <div>
                  <div className="text-sm font-semibold">Ship Date</div>
                  <div className="text-sm">{shipDate ? shipDate.slice(0,10) : "-"}</div>
                </div>

                <div>
                  <div className="text-sm font-semibold">Incoterm</div>
                  <div className="text-sm">{incoterm || "-"}</div>
                </div>
                <div>
                  <div className="text-sm font-semibold">Payment Term</div>
                  <div className="text-sm">{paymentTerm || "-"}</div>
                </div>
                <div>
                  <div className="text-sm font-semibold">Destination</div>
                  <div className="text-sm">{destination || "-"}</div>
                </div>
                <div>
                  <div className="text-sm font-semibold">Shipping Origin</div>
                  <div className="text-sm">{shippingOrigin || "-"}</div>
                </div>

                <div className="md:col-span-4">
                  <Separator className="my-2" />
                  <div className="text-sm text-muted-foreground">
                    ✅ A안: 라인별 Ship Mode(SEA/AIR/COURIER)로 선택 → 저장 시 Mode별 Shipment가 자동 생성됩니다.
                    (같은 PO 라인도 split 가능)
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>3. Shipment Lines & Totals (Split by Mode)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <div className="text-sm font-semibold">Total Cartons</div>
                    <Input value={String(summary.totalCartons)} readOnly />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">Total G.W. (KGS)</div>
                    <Input value={summary.totalGW.toFixed(2)} readOnly />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">Total N.W. (KGS)</div>
                    <Input value={summary.totalNW.toFixed(2)} readOnly />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="text-sm">
                    <span className="font-semibold">SEA</span>{" "}
                    <span className="text-muted-foreground">
                      Qty {summary.byMode.SEA.qty.toLocaleString()} / {money(summary.byMode.SEA.amount, summary.currency)}
                    </span>
                  </div>
                  <div className="text-sm">
                    <span className="font-semibold">AIR</span>{" "}
                    <span className="text-muted-foreground">
                      Qty {summary.byMode.AIR.qty.toLocaleString()} / {money(summary.byMode.AIR.amount, summary.currency)}
                    </span>
                  </div>
                  <div className="text-sm">
                    <span className="font-semibold">COURIER</span>{" "}
                    <span className="text-muted-foreground">
                      Qty {summary.byMode.COURIER.qty.toLocaleString()} / {money(summary.byMode.COURIER.amount, summary.currency)}
                    </span>
                  </div>
                </div>

                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[52px]">Use</TableHead>
                        <TableHead className="w-[110px]">PO No</TableHead>
                        <TableHead className="w-[60px]">Line</TableHead>
                        <TableHead className="w-[110px]">Style No</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="w-[90px]">Color</TableHead>
                        <TableHead className="w-[70px]">Size</TableHead>
                        <TableHead className="w-[90px] text-right">Order Qty</TableHead>
                        <TableHead className="w-[120px]">Shipped Qty</TableHead>
                        <TableHead className="w-[110px] text-right">Unit Price</TableHead>
                        <TableHead className="w-[120px] text-right">Amount</TableHead>
                        <TableHead className="w-[120px]">Mode</TableHead>
                        <TableHead className="w-[120px]">Carrier</TableHead>
                        <TableHead className="w-[140px]">Tracking</TableHead>
                        <TableHead className="w-[80px]">Split</TableHead>
                        <TableHead className="w-[70px]">Del</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allocs.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>
                            <Checkbox
                              checked={r.include}
                              onCheckedChange={(v) => updateAlloc(r.id, { include: Boolean(v) })}
                            />
                          </TableCell>
                          <TableCell>{r.po_no}</TableCell>
                          <TableCell>{r.line_no ?? "-"}</TableCell>
                          <TableCell className="font-medium">{r.style_no}</TableCell>
                          <TableCell className="whitespace-pre-wrap">{r.description}</TableCell>
                          <TableCell>{r.color || "-"}</TableCell>
                          <TableCell>{r.size || "-"}</TableCell>
                          <TableCell className="text-right">{r.order_qty.toLocaleString()}</TableCell>
                          <TableCell>
                            <Input
                              value={String(r.shipped_qty)}
                              onChange={(e) => updateAlloc(r.id, { shipped_qty: num(e.target.value, 0) })}
                              disabled={!r.include}
                            />
                          </TableCell>
                          <TableCell className="text-right">{money(r.unit_price, summary.currency)}</TableCell>
                          <TableCell className="text-right">
                            {money(num(r.shipped_qty, 0) * num(r.unit_price, 0), summary.currency)}
                          </TableCell>
                          <TableCell>
                            <Select
                              value={r.ship_mode}
                              onValueChange={(v) => updateAlloc(r.id, { ship_mode: v as ShipMode })}
                              disabled={!r.include}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Mode" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="SEA">SEA</SelectItem>
                                <SelectItem value="AIR">AIR</SelectItem>
                                <SelectItem value="COURIER">COURIER</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Input
                              value={r.carrier}
                              onChange={(e) => updateAlloc(r.id, { carrier: e.target.value })}
                              placeholder={r.ship_mode === "COURIER" ? "DHL/UPS/..." : ""}
                              disabled={!r.include}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={r.tracking_no}
                              onChange={(e) => updateAlloc(r.id, { tracking_no: e.target.value })}
                              disabled={!r.include}
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => splitRow(r.id)}
                              disabled={!r.include || num(r.shipped_qty, 0) <= 0}
                            >
                              Split
                            </Button>
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeRow(r.id)}
                            >
                              ✕
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {allocs.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={16} className="text-muted-foreground">
                            No lines.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex justify-end">
                  <Button onClick={save} disabled={saving || loading}>
                    {saving ? "Saving..." : "Save Shipment"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
