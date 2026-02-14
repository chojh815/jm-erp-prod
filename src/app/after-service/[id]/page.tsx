"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STATUS_OPTIONS = ["OPEN", "NEGOTIATING", "APPROVED", "REJECTED", "CLOSED"] as const;
const ISSUE_OPTIONS = ["DEFECT","DAMAGE","MISSING","SHORT_SHIP","WRONG_LABEL","WRONG_ITEM","PACKING_ERROR","DOCUMENT_ERROR","OTHER"] as const;
const RESPONSIBLE_OPTIONS = ["VENDOR","INTERNAL","BUYER","FORWARDER","UNKNOWN"] as const;
const RESOLUTION_OPTIONS = ["CREDIT_NOTE","DISCOUNT_NEXT_ORDER","REMAKE","REWORK","REPLACE","REFUND","NO_ACTION","OTHER"] as const;

type Header = any;
type Line = any;
type Event = any;

function n(v: any, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function fmtMoney(v: any) {
  const x = Number(v ?? 0);
  if (!Number.isFinite(x)) return "0.00";
  return x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AfterServiceDetailPage({ params }: any) {
  const id = params?.id as string;

  const [loading, setLoading] = useState(false);
  const [header, setHeader] = useState<Header | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [events, setEvents] = useState<Event[]>([]);

const [poDerived, setPoDerived] = useState<{ buyer: boolean; vendor: boolean; origin: boolean }>({
  buyer: false,
  vendor: false,
  origin: false,
});

const [shipmentsLoading, setShipmentsLoading] = useState(false);
const [shipments, setShipments] = useState<any[]>([]);
const [invoicesLoading, setInvoicesLoading] = useState(false);
const [invoices, setInvoices] = useState<any[]>([]);
const [poLinesLoading, setPoLinesLoading] = useState(false);
const [poLines, setPoLines] = useState<any[]>([]);
const [poLinesError, setPoLinesError] = useState<string | null>(null);



  const totals = useMemo(() => {
    const amount = lines.reduce((s, ln) => s + n(ln.amount, n(ln.qty) * n(ln.unit_price)), 0);
    return { amount };
  }, [lines]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/after-service/${id}`, { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Load failed");
      setHeader(json.header);
      setLines(json.lines || []);
      setEvents(json.events || []);
    } catch (e: any) {
      alert(e?.message || "Load failed");
    } finally {
      setLoading(false);
    }
  }

  
async function fetchPoLines(poNo: string) {
  const po = (poNo || "").toString().trim();
  if (!po || po.toUpperCase() === "TBD") {
    setPoLines([]);
    setPoLinesError(null);
    setPoDerived({ buyer: false, vendor: false, origin: false });
    setShipments([]);
    setInvoices([]);
    return;
  }
  setPoLinesLoading(true);
  setPoLinesError(null);
  try {
    const res = await fetch(`/api/after-service/po-lines?po_no=${encodeURIComponent(po)}`, { cache: "no-store" });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Failed to load PO lines");

    const rows = Array.isArray(json.rows) ? json.rows : [];
    setPoLines(rows);

    // Apply PO context to header (buyer/vendor/origin) and lock fields when resolved
    const ctx = json.context || null;
    if (ctx) {
      setHeader((h: any) => {
        const next: any = { ...(h || {}) };
        if (ctx.buyer_id || ctx.buyer_name) {
          next.buyer_id = ctx.buyer_id || next.buyer_id;
          next.buyer_name = ctx.buyer_name || next.buyer_name;
        }
        if (ctx.vendor_id || ctx.vendor_name) {
          next.vendor_id = ctx.vendor_id || next.vendor_id;
          next.vendor_name = ctx.vendor_name || next.vendor_name;
        }
        if (ctx.shipping_origin_code) {
          next.shipping_origin_code = ctx.shipping_origin_code;
        }
        // if multiple headers exist, keep existing po_header_id unless empty
        if (!next.po_header_id && rows?.[0]?.po_header_id) next.po_header_id = rows[0].po_header_id;
        return next;
      });

      setPoDerived({
        buyer: !!(ctx.buyer_id || ctx.buyer_name),
        vendor: !!(ctx.vendor_id || ctx.vendor_name),
        origin: !!ctx.shipping_origin_code,
      });
    } else {
      setPoDerived({ buyer: false, vendor: false, origin: false });
    }

    // Load shipment options for this PO
    await fetchShipments(po);
  } catch (e: any) {
    setPoLines([]);
    setPoLinesError(e?.message || "Failed to load PO lines");
    setPoDerived({ buyer: false, vendor: false, origin: false });
    setShipments([]);
    setInvoices([]);
  } finally {
    setPoLinesLoading(false);
  }
}

async function fetchShipments(poNo: string) {
  const po = (poNo || "").toString().trim();
  if (!po) {
    setShipments([]);
    return;
  }
  setShipmentsLoading(true);
  try {
    const res = await fetch(`/api/after-service/shipments?po_no=${encodeURIComponent(po)}`, { cache: "no-store" });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Failed to load shipments");
    setShipments(Array.isArray(json.rows) ? json.rows : []);
  } catch {
    setShipments([]);
  } finally {
    setShipmentsLoading(false);
  }
}

async function fetchInvoices(shipmentId: string) {
  const sid = (shipmentId || "").toString().trim();
  if (!sid) {
    setInvoices([]);
    return;
  }
  setInvoicesLoading(true);
  try {
    const res = await fetch(`/api/after-service/invoices?shipment_id=${encodeURIComponent(sid)}`, { cache: "no-store" });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Failed to load invoices");
    setInvoices(Array.isArray(json.rows) ? json.rows : []);
  } catch {
    setInvoices([]);
  } finally {
    setInvoicesLoading(false);
  }
}

useEffect(() => { load(); }, [id]);

useEffect(() => {
  if (!header) return;
  const po = (header.po_no || "").toString().trim();
  const t = setTimeout(() => {
    fetchPoLines(po);
  }, 250);
  return () => clearTimeout(t);
}, [header?.po_no]);



  function updateHeader(key: string, value: any) {
    setHeader((h: any) => ({ ...(h || {}), [key]: value }));
  }

  function updateLine(idx: number, key: string, value: any) {
    setLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: value };
      // auto calc
      const qty = n(next[idx].qty);
      const up = n(next[idx].unit_price);
      next[idx].amount = Number.isFinite(Number(next[idx].amount)) ? n(next[idx].amount) : qty * up;
      if (key === "qty" || key === "unit_price") next[idx].amount = qty * up;
      return next;
    });
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      {
        style_no: "",
        buyer_style_no: "",
        issue_type: "OTHER",
        description: "",
        qty: 0,
        unit: "pcs",
        unit_price: 0,
        amount: 0,
      },
    ]);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  async function save() {
    if (!header) return;
const po = (header.po_no || "").toString().trim();
if (!po || po.toUpperCase() === "TBD") {
  alert("PO No is required (set a real PO No, not TBD).");
  return;
}
const badIdx = (lines || []).findIndex((ln: any) => !(ln?.buyer_style_no || "").toString().trim());
if (badIdx >= 0) {
  alert(`Buyer Style is required on line ${badIdx + 1}.`);
  return;
}

    setLoading(true);
    try {
      const res = await fetch(`/api/after-service/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          header: {
            title: header.title,
            description: header.description,
            status: header.status,
            issue_type: header.issue_type,
            responsible_party: header.responsible_party,

            issue_date: header.issue_date,
            reported_date: header.reported_date,
            due_date: header.due_date,

            po_no: header.po_no,
            po_header_id: header.po_header_id,
            shipment_id: header.shipment_id,
            invoice_id: header.invoice_id,

            buyer_id: header.buyer_id,
            buyer_name: header.buyer_name,
            vendor_id: header.vendor_id,
            vendor_name: header.vendor_name,
            site_id: header.site_id,
            shipping_origin_code: header.shipping_origin_code,

            currency: header.currency,
            fx_rate_to_usd: header.fx_rate_to_usd,
            claim_amount: n(header.claim_amount, 0),
            approved_amount: n(header.approved_amount, 0),
            loss_amount_usd: n(header.loss_amount_usd, 0),

            resolution_type: header.resolution_type,
            resolution_notes: header.resolution_notes,
          },
          lines,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Save failed");
      await load();
      alert("Saved");
    } catch (e: any) {
      alert(e?.message || "Save failed");
    } finally {
      setLoading(false);
    }
  }

  async function softDelete() {
    if (!confirm("Soft delete this case?")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/after-service/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Delete failed");
      window.location.href = "/after-service";
    } catch (e: any) {
      alert(e?.message || "Delete failed");
      setLoading(false);
    }
  }

  if (!header) {
    return (
      <AppShell>
        <div className="p-4">
          <div className="text-sm text-muted-foreground">{loading ? "Loading..." : "No data"}</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <div className="text-sm text-muted-foreground">
              <Link className="underline" href="/after-service">After Service</Link> /{" "}
              <span className="font-medium">{header.case_no || id.slice(0, 8)}</span>
            </div>
            <h1 className="text-xl font-semibold">{header.title || "After Service"}</h1>
            <div className="text-xs text-muted-foreground">
              Updated: {(header.updated_at || "").toString().slice(0, 19).replace("T", " ")}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={load} disabled={loading}>
              {loading ? "Loading..." : "Refresh"}
            </Button>
            <Button onClick={save} disabled={loading}>
              Save
            </Button>
            <Button variant="destructive" onClick={softDelete} disabled={loading}>
              Delete
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Header</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="space-y-1 md:col-span-2">
                <Label>Title</Label>
                <Input value={header.title || ""} onChange={(e) => updateHeader("title", e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={header.status || "OPEN"} onValueChange={(v) => updateHeader("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Issue Type</Label>
                <Select value={header.issue_type || "OTHER"} onValueChange={(v) => updateHeader("issue_type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ISSUE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Responsible</Label>
                <Select value={header.responsible_party || "UNKNOWN"} onValueChange={(v) => updateHeader("responsible_party", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RESPONSIBLE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Issue Date</Label>
                <Input type="date" value={(header.issue_date || "")?.slice?.(0,10) || ""} onChange={(e) => updateHeader("issue_date", e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label>Reported Date</Label>
                <Input type="date" value={(header.reported_date || "")?.slice?.(0,10) || ""} onChange={(e) => updateHeader("reported_date", e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label>Due Date</Label>
                <Input type="date" value={(header.due_date || "")?.slice?.(0,10) || ""} onChange={(e) => updateHeader("due_date", e.target.value)} />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea value={header.description || ""} onChange={(e) => updateHeader("description", e.target.value)} rows={4} />
            </div>

            <Separator />

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="space-y-1">
  <Label>PO No <span className="text-red-500">*</span></Label>
  <div className="flex items-center gap-2">
    <Input
      value={header.po_no || ""}
      onChange={(e) => updateHeader("po_no", e.target.value)}
      onBlur={(e) => fetchPoLines(e.target.value)}
      placeholder="PO-..."
    />
    <Button type="button" variant="secondary" onClick={() => fetchPoLines(header.po_no || "")} disabled={poLinesLoading}>
      {poLinesLoading ? "Loading..." : "Load"}
    </Button>
  </div>
  {poLinesError ? (
    <div className="text-xs text-red-600">{poLinesError}</div>
  ) : (
    <div className="text-xs text-muted-foreground">
      {poLinesLoading ? "Loading PO lines..." : `PO Lines: ${poLines.length}`}
    </div>
  )}
</div>
              <div className="space-y-1">
  <Label>Shipment</Label>
  <Select
    value={header.shipment_id || "__NONE__"}
    onValueChange={async (v) => {
      const val = v === "__NONE__" ? "" : v;
      updateHeader("shipment_id", val || null);
      updateHeader("invoice_id", null);
      setInvoices([]);
      if (val) await fetchInvoices(val);
    }}
  >
    <SelectTrigger>
      <SelectValue placeholder={shipmentsLoading ? "Loading..." : "(optional)"} />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="__NONE__">(none)</SelectItem>
      {(shipments || []).map((s: any) => (
        <SelectItem key={s.id} value={s.id}>
          {(s.shipment_no || s.id)}{s.shipment_date ? ` • ${String(s.shipment_date).slice(0,10)}` : ""}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
              <div className="space-y-1">
  <Label>Invoice</Label>
  <Select
    value={header.invoice_id || "__NONE__"}
    onValueChange={(v) => updateHeader("invoice_id", v === "__NONE__" ? null : v)}
    disabled={!header.shipment_id}
  >
    <SelectTrigger>
      <SelectValue placeholder={!header.shipment_id ? "Select shipment first" : invoicesLoading ? "Loading..." : "(optional)"} />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="__NONE__">(none)</SelectItem>
      {(invoices || []).map((inv: any) => (
        <SelectItem key={inv.id} value={inv.id}>
          {(inv.invoice_no || inv.id)}{inv.invoice_date ? ` • ${String(inv.invoice_date).slice(0,10)}` : ""}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
              <div className="space-y-1">
                <Label>Shipping Origin</Label>
                <Input value={header.shipping_origin_code || ""} onChange={(e) => updateHeader("shipping_origin_code", e.target.value)} placeholder="VN / CN..." readOnly={poDerived.origin} className={poDerived.origin ? "bg-muted/40" : ""} />
              </div>

              <div className="space-y-1">
                <Label>Buyer Name</Label>
                <Input value={header.buyer_name || ""} onChange={(e) => updateHeader("buyer_name", e.target.value)} readOnly={poDerived.buyer} className={poDerived.buyer ? "bg-muted/40" : ""} />
              </div>
              <div className="space-y-1">
                <Label>Vendor Name</Label>
                <Input value={header.vendor_name || ""} onChange={(e) => updateHeader("vendor_name", e.target.value)} readOnly={poDerived.vendor} className={poDerived.vendor ? "bg-muted/40" : ""} />
              </div>

              <div className="space-y-1">
                <Label>Claim Amount (USD)</Label>
                <Input
                  inputMode="decimal"
                  value={header.claim_amount ?? 0}
                  onChange={(e) => updateHeader("claim_amount", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Approved Amount (USD)</Label>
                <Input
                  inputMode="decimal"
                  value={header.approved_amount ?? 0}
                  onChange={(e) => updateHeader("approved_amount", e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label>Loss Amount USD</Label>
                <Input
                  inputMode="decimal"
                  value={header.loss_amount_usd ?? 0}
                  onChange={(e) => updateHeader("loss_amount_usd", e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label>Resolution Type</Label>
                <Select value={(header.resolution_type || "__NONE__")} onValueChange={(v) => updateHeader("resolution_type", v === "__NONE__" ? null : v)}>
                  <SelectTrigger><SelectValue placeholder="(optional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__NONE__">(none)</SelectItem>
                    {RESOLUTION_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1 md:col-span-4">
                <Label>Resolution Notes</Label>
                <Textarea value={header.resolution_notes || ""} onChange={(e) => updateHeader("resolution_notes", e.target.value)} rows={3} />
              </div>
            </div>

            <div className="rounded-md border p-3 text-sm">
              <div className="text-muted-foreground">Lines Total</div>
              <div className="text-lg font-semibold">US$ {fmtMoney(totals.amount)}</div>
              <div className="text-xs text-muted-foreground">
                (Phase 1: lines are for detail tracking; you can manually set Loss Amount USD in header.)
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-base">Lines</CardTitle>
            <Button onClick={addLine} variant="secondary">+ Add Line</Button>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto border rounded-md">
              <table className="min-w-[1100px] w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="p-2 w-[180px]">Buyer Style</th>
                    <th className="p-2 w-[76px]">Img</th>
                    <th className="p-2 w-[160px]">JM Style</th>
                    <th className="p-2 w-[160px]">Issue Type</th>
                    <th className="p-2">Description</th>
                    <th className="p-2 w-[90px] text-right">Qty</th>
                    <th className="p-2 w-[90px]">Unit</th>
                    <th className="p-2 w-[110px] text-right">Unit Price</th>
                    <th className="p-2 w-[120px] text-right">Amount</th>
                    <th className="p-2 w-[80px]"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr>
                      <td className="p-4 text-muted-foreground" colSpan={10}>No lines.</td>
                    </tr>
                  ) : (
                    lines.map((ln, idx) => (
                      <tr key={idx} className="border-t align-top">
                        <td className="p-2">
                          <Select
  value={ln.po_line_id || "__MANUAL__"}
  onValueChange={(v) => {
    if (v === "__MANUAL__") {
      updateLine(idx, "po_line_id", null);
      return;
    }
    const picked = (poLines || []).find((x: any) => x.po_line_id === v);
    if (!picked) return;
    updateLine(idx, "po_line_id", picked.po_line_id);
    updateLine(idx, "buyer_style_no", picked.buyer_style_no || "");
    updateLine(idx, "style_no", picked.style_no || "");
    if (picked.color) updateLine(idx, "color", picked.color);
    if (picked.size) updateLine(idx, "size", picked.size);
    if (picked.qty != null) updateLine(idx, "qty", picked.qty);
    if (picked.unit) updateLine(idx, "unit", picked.unit);
  }}
>
  <SelectTrigger>
    <SelectValue placeholder="Pick from PO (recommended)" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="__MANUAL__">Manual input</SelectItem>
    {(poLines || [])
      .filter((x: any) => (x.buyer_style_no || "").toString().trim())
      .map((x: any) => (
        <SelectItem key={x.po_line_id} value={x.po_line_id}>
          {(x.buyer_style_no || "-")} {x.style_no ? ` • ${x.style_no}` : ""}
        </SelectItem>
      ))}
  </SelectContent>
</Select>
<div className="mt-1">
  <Input
    value={ln.buyer_style_no || ""}
    onChange={(e) => updateLine(idx, "buyer_style_no", e.target.value)}
    placeholder="buyer_style_no (required)"
  />
</div>
                        </td>
                        <td className="p-2">
                          {(() => {
                            const picked = (poLines || []).find((x: any) => x.po_line_id === ln.po_line_id);
                            const url = picked?.images?.[0] || null;
                            return url ? (
                              <a href={url} target="_blank" rel="noreferrer" className="block w-14 h-14 rounded border overflow-hidden">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={url} alt="img" className="w-full h-full object-cover" />
                              </a>
                            ) : (
                              <div className="w-14 h-14 rounded border bg-muted/30" />
                            );
                          })()}
                        </td>
                        <td className="p-2">
                          <Input value={ln.style_no || ""} onChange={(e) => updateLine(idx, "style_no", e.target.value)} placeholder="(optional)" />
                        </td>
                        <td className="p-2">
                          <Select value={ln.issue_type || "OTHER"} onValueChange={(v) => updateLine(idx, "issue_type", v)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {ISSUE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="p-2">
                          <Input value={ln.description || ""} onChange={(e) => updateLine(idx, "description", e.target.value)} />
                        </td>
                        <td className="p-2 text-right">
                          <Input inputMode="decimal" value={ln.qty ?? 0} onChange={(e) => updateLine(idx, "qty", e.target.value)} />
                        </td>
                        <td className="p-2">
                          <Input value={ln.unit || ""} onChange={(e) => updateLine(idx, "unit", e.target.value)} />
                        </td>
                        <td className="p-2 text-right">
                          <Input inputMode="decimal" value={ln.unit_price ?? 0} onChange={(e) => updateLine(idx, "unit_price", e.target.value)} />
                        </td>
                        <td className="p-2 text-right">
                          <div className="pt-2 pr-1 font-medium">US$ {fmtMoney(n(ln.qty) * n(ln.unit_price))}</div>
                        </td>
                        <td className="p-2">
                          <Button variant="destructive" onClick={() => removeLine(idx)}>Remove</Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Events</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              {events.length === 0 ? (
                <div className="text-muted-foreground">No events.</div>
              ) : (
                events.map((ev: any) => (
                  <div key={ev.id} className="border rounded-md p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium">{ev.event_type}</div>
                      <div className="text-xs text-muted-foreground">
                        {(ev.created_at || "").toString().slice(0, 19).replace("T", " ")}
                      </div>
                    </div>
                    {ev.message ? <div className="mt-1">{ev.message}</div> : null}
                    {ev.from_status || ev.to_status ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {ev.from_status || "-"} → {ev.to_status || "-"}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
