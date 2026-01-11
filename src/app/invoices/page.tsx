// src/app/invoices/page.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

import jsPDF from "jspdf";
// @ts-ignore
import autoTable from "jspdf-autotable";

type DevRole = AppRole;

type InvoiceRow = {
  id: string;
  invoice_no: string | null;
  buyer_name: string | null;
  buyer_code: string | null;
  currency: string | null;
  total_amount: number | null;
  status: string | null;
  etd: string | null;
  eta: string | null;
  created_at: string | null;
};

type PackingRow = {
  id: string;
  packing_list_no: string | null;
  invoice_no: string | null;
  buyer_name: string | null;
  buyer_code: string | null;
  shipping_origin_code: string | null;
  final_destination: string | null;
  status: string | null;
  etd: string | null;
  eta: string | null;
  created_at: string | null;
};

type ApiInvoiceHeader = {
  id: string;
  invoice_no: string | null;
  invoice_date: string | null;
  status: string | null;

  buyer_id: string | null;
  buyer_name: string | null;

  currency: string | null;
  total_amount: number | null;

  // ✅ invoice detail 기준 컬럼
  remarks: string | null;
  consignee_text: string | null;
  notify_party_text: string | null;

  payment_term?: string | null;
  destination?: string | null;
  incoterm?: string | null;
  shipping_origin_code?: string | null;

  etd?: string | null;
  eta?: string | null;
};

type ApiInvoiceLine = {
  id?: string;
  invoice_id?: string;
  line_no?: number;

  po_no: string | null;
  style_no: string | null;
  description: string | null;

  material: string | null;
  hs_code: string | null;

  uom: string | null;
  qty: number | null;
  unit_price: number | null;
  amount: number | null;

  is_deleted?: boolean | null;
};

function fmtDate10(v?: string | null) {
  if (!v) return "-";
  try {
    return String(v).slice(0, 10);
  } catch {
    return String(v);
  }
}

function fmtMoney(v: any) {
  return Number(v || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtQty(v: any) {
  return Number(v || 0).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
}

// ✅ Material/HS는 기본 표시 (비어있어도 컬럼 유지)
const ALWAYS_SHOW_MAT_HS = true;

function uniqSorted(values: (string | null | undefined)[]) {
  const s = new Set<string>();
  for (const v of values) {
    const t = (v ?? "").trim();
    if (t) s.add(t);
  }
  return Array.from(s).sort((a, b) => a.localeCompare(b));
}

export default function InvoicesPage() {
  const router = useRouter();

  const [role, setRole] = React.useState<DevRole>("viewer");
  const [loading, setLoading] = React.useState(true);

  const [tab, setTab] = React.useState<"invoices" | "packing">("invoices");

  // invoices list
  const [invRows, setInvRows] = React.useState<InvoiceRow[]>([]);
  const [invQ, setInvQ] = React.useState(""); // keyword
  const [invBuyer, setInvBuyer] = React.useState<string>(""); // buyer filter
  const [invStatus, setInvStatus] = React.useState<string>(""); // status filter
  const [exportingId, setExportingId] = React.useState<string | null>(null);

  // packing list
  const [plRows, setPlRows] = React.useState<PackingRow[]>([]);
  const [plQ, setPlQ] = React.useState(""); // keyword
  const [plBuyer, setPlBuyer] = React.useState<string>(""); // buyer filter
  const [plStatus, setPlStatus] = React.useState<string>(""); // status filter

  React.useEffect(() => {
    // 프로젝트 공통 role 로딩 로직이 있으면 여기를 교체
    setRole("admin");
  }, []);

  // ✅ keyword/buyer/status를 받아 서버 검색 가능하게
  const loadInvoiceList = React.useCallback(
    async (keyword?: string, buyer?: string, status?: string) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();

        const k = (keyword ?? "").trim();
        const b = (buyer ?? "").trim();
        const s = (status ?? "").trim();

        if (k) params.set("keyword", k);
        if (b) params.set("buyer", b);
        if (s) params.set("status", s);

        const qs = params.toString() ? `?${params.toString()}` : "";
        const res = await fetch(`/api/invoices/list${qs}`, { cache: "no-store" });
        const json = await res.json().catch(() => null);

        if (!res.ok || (json && json.success === false)) {
          console.error("Failed to load invoices list:", json);
          alert(json?.error || "Failed to load invoices list.");
          setInvRows([]);
          return;
        }

        // ✅ 너 API: invoices/items
        const list: InvoiceRow[] =
          json?.invoices ?? json?.items ?? json?.rows ?? json?.data ?? json ?? [];

        setInvRows(Array.isArray(list) ? list : []);
      } catch (e) {
        console.error(e);
        alert("Failed to load invoices list.");
        setInvRows([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // ✅ keyword/buyer/status를 받아 서버 검색 가능하게
  const loadPackingList = React.useCallback(
    async (keyword?: string, buyer?: string, status?: string) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();

        const k = (keyword ?? "").trim();
        const b = (buyer ?? "").trim();
        const s = (status ?? "").trim();

        if (k) params.set("keyword", k);
        if (b) params.set("buyer", b);
        if (s) params.set("status", s);

        const qs = params.toString() ? `?${params.toString()}` : "";
        const res = await fetch(`/api/packing-lists/list${qs}`, { cache: "no-store" });
        const json = await res.json().catch(() => null);

        if (!res.ok || (json && json.success === false)) {
          console.error("Failed to load packing list:", json);
          alert(json?.error || "Failed to load packing list.");
          setPlRows([]);
          return;
        }

        // ✅ packingLists/items/rows/data 모두 호환
        const list: PackingRow[] =
          json?.packingLists ?? json?.items ?? json?.rows ?? json?.data ?? json ?? [];

        setPlRows(Array.isArray(list) ? list : []);
      } catch (e) {
        console.error(e);
        alert("Failed to load packing list.");
        setPlRows([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // ✅ 탭 전환 시: 현재 필터 값 기준으로 로드
  React.useEffect(() => {
    if (tab === "invoices") loadInvoiceList(invQ, invBuyer, invStatus);
    else loadPackingList(plQ, plBuyer, plStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // ✅ 드롭다운 옵션(현재 rows 기준)
  const invBuyerOptions = React.useMemo(
    () => uniqSorted(invRows.map((r) => r.buyer_name)),
    [invRows]
  );
  const invStatusOptions = React.useMemo(
    () => uniqSorted(invRows.map((r) => r.status)),
    [invRows]
  );

  const plBuyerOptions = React.useMemo(
    () => uniqSorted(plRows.map((r) => r.buyer_name)),
    [plRows]
  );
  const plStatusOptions = React.useMemo(
    () => uniqSorted(plRows.map((r) => r.status)),
    [plRows]
  );

  // ✅ 서버검색 결과를 다시 클라 필터로 좁혀도 되게(기존 스타일 유지)
  const invFiltered = React.useMemo(() => {
    const s = invQ.trim().toLowerCase();
    return invRows.filter((r) => {
      // keyword
      const a = (r.invoice_no ?? "").toLowerCase();
      const b = (r.buyer_name ?? "").toLowerCase();
      const c = (r.buyer_code ?? "").toLowerCase();
      const okKeyword = !s || a.includes(s) || b.includes(s) || c.includes(s);

      // buyer/status
      const okBuyer = !invBuyer || (r.buyer_name ?? "") === invBuyer;
      const okStatus = !invStatus || (r.status ?? "") === invStatus;

      return okKeyword && okBuyer && okStatus;
    });
  }, [invRows, invQ, invBuyer, invStatus]);

  const plFiltered = React.useMemo(() => {
    const s = plQ.trim().toLowerCase();
    return plRows.filter((r) => {
      const a = (r.packing_list_no ?? "").toLowerCase();
      const b = (r.invoice_no ?? "").toLowerCase();
      const c = (r.buyer_name ?? "").toLowerCase();
      const d = (r.buyer_code ?? "").toLowerCase();
      const okKeyword = !s || a.includes(s) || b.includes(s) || c.includes(s) || d.includes(s);

      const okBuyer = !plBuyer || (r.buyer_name ?? "") === plBuyer;
      const okStatus = !plStatus || (r.status ?? "") === plStatus;

      return okKeyword && okBuyer && okStatus;
    });
  }, [plRows, plQ, plBuyer, plStatus]);

  const handleExportCIPdf = React.useCallback(async (inv: InvoiceRow) => {
    try {
      setExportingId(inv.id);

      const res = await fetch(`/api/invoices/${encodeURIComponent(inv.id)}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        console.error("Failed to load invoice detail:", data);
        alert(data?.error || `Failed to load invoice detail (status ${res.status})`);
        return;
      }

      if (!data || !data.header) {
        console.error("Invoice detail response has no header:", data);
        alert("Invoice detail API response is missing header. (API endpoint mismatch)");
        return;
      }

      const header = data.header as ApiInvoiceHeader;
      const linesRaw = (data.lines || []) as ApiInvoiceLine[];
      const lines = (linesRaw || []).filter((l) => !l?.is_deleted);

      const currency = header.currency || inv.currency || "USD";
      const subtotal =
        header.total_amount ??
        lines.reduce((sum, r) => sum + Number(r.amount || 0), 0);

      const doc = new jsPDF("p", "mm", "a4");
      const pageWidth = doc.internal.pageSize.getWidth();
      const marginLeft = 8;
      const contentWidth = pageWidth - marginLeft * 2;
      const halfWidth = contentWidth / 2;

      let cursorY = 15;

      doc.setFontSize(20);
      doc.setFont("helvetica", "bold");
      doc.text("COMMERCIAL INVOICE", pageWidth / 2, cursorY, { align: "center" });
      cursorY += 12;

      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");

      doc.text(`Buyer: ${header.buyer_name || "-"}`, marginLeft, cursorY);
      doc.text(`Invoice No: ${header.invoice_no || "-"}`, pageWidth - marginLeft, cursorY, {
        align: "right",
      });
      cursorY += 6;

      doc.text(`Date: ${fmtDate10(header.invoice_date ?? null)}`, pageWidth - marginLeft, cursorY, {
        align: "right",
      });
      cursorY += 8;

      const consignee = (header.consignee_text || "").trim() || "-";
      const notify = (header.notify_party_text || "").trim() || "-";

      const cellH = 30;
      doc.rect(marginLeft, cursorY, halfWidth, cellH);
      doc.rect(marginLeft + halfWidth, cursorY, halfWidth, cellH);

      doc.setFont("helvetica", "bold");
      doc.text("Consignee", marginLeft + 2, cursorY + 6);
      doc.text("Notify Party", marginLeft + halfWidth + 2, cursorY + 6);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(doc.splitTextToSize(consignee, halfWidth - 4), marginLeft + 2, cursorY + 12);
      doc.text(
        doc.splitTextToSize(notify, halfWidth - 4),
        marginLeft + halfWidth + 2,
        cursorY + 12
      );

      cursorY += cellH + 6;

      const originCode = (header.shipping_origin_code || "").toUpperCase();
      const originDisplay =
        originCode.includes("VN")
          ? "MADE IN VIETNAM"
          : originCode.includes("KR")
          ? "MADE IN KOREA"
          : originCode.includes("CN")
          ? "MADE IN CHINA"
          : header.shipping_origin_code || "-";

      const cooH = 20;
      doc.rect(marginLeft, cursorY, contentWidth, cooH);
      doc.setFont("helvetica", "bold");
      doc.text("COO / Certification", marginLeft + 2, cursorY + 6);
      doc.setFont("helvetica", "normal");
      doc.text(`COO: ${originDisplay}`, marginLeft + 2, cursorY + 12);
      doc.text(
        "WE CERTIFY THERE IS NO WOOD PACKING MATERIAL USED IN THIS SHIPMENT.",
        marginLeft + 2,
        cursorY + 17
      );

      cursorY += cooH + 6;

      const headBase = ["PO No", "Style No", "Description"];
      const headMatHs = ALWAYS_SHOW_MAT_HS ? ["Material", "HS Code"] : [];
      const headTail = ["Qty", "Unit Price", "Amount"];
      const head = [[...headBase, ...headMatHs, ...headTail]];

      const body = lines.map((l) => {
        const row: any[] = [l.po_no || "", l.style_no || "", l.description || ""];
        if (ALWAYS_SHOW_MAT_HS) row.push(l.material || "", l.hs_code || "");
        row.push(fmtQty(l.qty), fmtMoney(l.unit_price), fmtMoney(l.amount));
        return row;
      });

      autoTable(doc, {
        startY: cursorY,
        margin: { left: marginLeft, right: marginLeft },
        head,
        body,
        theme: "grid",
        styles: { fontSize: 8, cellPadding: 1.8, halign: "center", valign: "middle" },
        headStyles: { fontStyle: "bold" },
        columnStyles: {
          [head[0].length - 3]: { halign: "right" },
          [head[0].length - 2]: { halign: "right" },
          [head[0].length - 1]: { halign: "right" },
        },
      });

      const lastY = (doc as any).lastAutoTable?.finalY ?? cursorY + 40;

      let y = lastY + 10;
      if (y > 260) {
        doc.addPage();
        y = 20;
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("Subtotal", marginLeft, y);
      doc.text(`${currency} ${fmtMoney(subtotal)}`, pageWidth - marginLeft, y, { align: "right" });

      let stampY = y + 24;
      if (stampY > 260) {
        doc.addPage();
        stampY = 40;
      }

      const stampImg = new Image();
      stampImg.src = "/images/jm_stamp_vn.jpg";

      await new Promise<void>((resolve, reject) => {
        stampImg.onload = () => resolve();
        stampImg.onerror = () => reject(new Error("Stamp image load error"));
      });

      const stampWidth = 60;
      const stampHeight = 30;
      const stampX = pageWidth - marginLeft - stampWidth;

      doc.addImage(stampImg, "JPEG", stampX, stampY, stampWidth, stampHeight);

      doc.setFontSize(11);
      doc.text("Signed by", pageWidth - marginLeft, stampY - 2, { align: "right" });

      doc.text("JM International Co.,Ltd", pageWidth - marginLeft, stampY + stampHeight + 6, {
        align: "right",
      });

      const fileName = `${header.invoice_no || "commercial-invoice"}.pdf`;
      doc.save(fileName);
    } catch (e) {
      console.error(e);
      alert("Failed to export Commercial Invoice PDF.");
    } finally {
      setExportingId(null);
    }
  }, []);

  const doRefresh = React.useCallback(() => {
    if (tab === "invoices") loadInvoiceList(invQ, invBuyer, invStatus);
    else loadPackingList(plQ, plBuyer, plStatus);
  }, [tab, invQ, invBuyer, invStatus, plQ, plBuyer, plStatus, loadInvoiceList, loadPackingList]);

  return (
    <AppShell role={role}>
      <Tabs value={tab} onValueChange={(v: any) => setTab(v)}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-4">
              <CardTitle>Invoices & Packing</CardTitle>
              <TabsList>
                <TabsTrigger value="invoices">Invoices</TabsTrigger>
                <TabsTrigger value="packing">Packing Lists</TabsTrigger>
              </TabsList>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={doRefresh} disabled={loading}>
                Refresh
              </Button>
              <Button onClick={() => router.push("/shipments")}>Create</Button>
            </div>
          </CardHeader>

          <CardContent>
            <TabsContent value="invoices">
              <div className="grid gap-3">
                <div className="grid gap-2">
                  <Label>Search</Label>

                  <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_220px_220px_110px]">
                    <Input
                      value={invQ}
                      onChange={(e) => setInvQ(e.target.value)}
                      placeholder="Search by invoice no / buyer / code..."
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          loadInvoiceList(invQ, invBuyer, invStatus);
                        }
                      }}
                    />

                    <Select
                      value={invBuyer || "ALL"}
                      onValueChange={(v) => setInvBuyer(v === "ALL" ? "" : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Buyer" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All Buyers</SelectItem>
                        {invBuyerOptions.map((b) => (
                          <SelectItem key={b} value={b}>
                            {b}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={invStatus || "ALL"}
                      onValueChange={(v) => setInvStatus(v === "ALL" ? "" : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All Status</SelectItem>
                        {invStatusOptions.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Button
                      variant="outline"
                      onClick={() => loadInvoiceList(invQ, invBuyer, invStatus)}
                      disabled={loading}
                      className="shrink-0"
                    >
                      Search
                    </Button>
                  </div>
                </div>

                <Separator />

                {loading ? (
                  <div className="text-sm text-muted-foreground">Loading...</div>
                ) : invFiltered.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No invoices.</div>
                ) : (
                  <div className="w-full overflow-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40">
                        <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
                          <th className="min-w-[170px]">Invoice No</th>
                          <th className="min-w-[160px]">Buyer</th>
                          <th className="min-w-[90px]">Currency</th>
                          <th className="min-w-[120px] text-right">Total</th>
                          <th className="min-w-[120px]">Status</th>
                          <th className="min-w-[110px]">ETD</th>
                          <th className="min-w-[110px]">ETA</th>
                          <th className="min-w-[170px]">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invFiltered.map((r) => {
                          const busy = exportingId === r.id;
                          return (
                            <tr
                              key={r.id}
                              className="border-t [&>td]:px-3 [&>td]:py-2 hover:bg-muted/20"
                            >
                              <td className="font-medium">{r.invoice_no ?? "-"}</td>
                              <td>
                                {r.buyer_name ?? "-"}
                                {r.buyer_code ? (
                                  <span className="text-muted-foreground"> ({r.buyer_code})</span>
                                ) : null}
                              </td>
                              <td>{r.currency ?? "-"}</td>
                              <td className="text-right">
                                {r.total_amount != null ? fmtMoney(r.total_amount) : "-"}
                              </td>
                              <td>{r.status ?? "-"}</td>
                              <td>{fmtDate10(r.etd)}</td>
                              <td>{fmtDate10(r.eta)}</td>
                              <td className="flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => router.push(`/invoices/${r.id}`)}
                                >
                                  Detail
                                </Button>
                                <Button size="sm" onClick={() => handleExportCIPdf(r)} disabled={busy}>
                                  {busy ? "PDF..." : "PDF"}
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="packing">
              <div className="grid gap-3">
                <div className="grid gap-2">
                  <Label>Search</Label>

                  <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_220px_220px_110px]">
                    <Input
                      value={plQ}
                      onChange={(e) => setPlQ(e.target.value)}
                      placeholder="Search by packing no / invoice no / buyer / code..."
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          loadPackingList(plQ, plBuyer, plStatus);
                        }
                      }}
                    />

                    <Select
                      value={plBuyer || "ALL"}
                      onValueChange={(v) => setPlBuyer(v === "ALL" ? "" : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Buyer" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All Buyers</SelectItem>
                        {plBuyerOptions.map((b) => (
                          <SelectItem key={b} value={b}>
                            {b}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={plStatus || "ALL"}
                      onValueChange={(v) => setPlStatus(v === "ALL" ? "" : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All Status</SelectItem>
                        {plStatusOptions.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Button
                      variant="outline"
                      onClick={() => loadPackingList(plQ, plBuyer, plStatus)}
                      disabled={loading}
                      className="shrink-0"
                    >
                      Search
                    </Button>
                  </div>
                </div>

                <Separator />

                {loading ? (
                  <div className="text-sm text-muted-foreground">Loading...</div>
                ) : plFiltered.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No packing lists.</div>
                ) : (
                  <div className="w-full overflow-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40">
                        <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
                          <th className="min-w-[180px]">Packing No</th>
                          <th className="min-w-[160px]">Invoice No</th>
                          <th className="min-w-[170px]">Buyer</th>
                          <th className="min-w-[120px]">Origin</th>
                          <th className="min-w-[220px]">Final Destination</th>
                          <th className="min-w-[120px]">Status</th>
                          <th className="min-w-[110px]">ETD</th>
                          <th className="min-w-[110px]">ETA</th>
                          <th className="min-w-[170px]">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plFiltered.map((r) => (
                          <tr
                            key={r.id}
                            className="border-t [&>td]:px-3 [&>td]:py-2 hover:bg-muted/20"
                          >
                            <td className="font-medium">{r.packing_list_no ?? "-"}</td>
                            <td>{r.invoice_no ?? "-"}</td>
                            <td>
                              {r.buyer_name ?? "-"}
                              {r.buyer_code ? (
                                <span className="text-muted-foreground"> ({r.buyer_code})</span>
                              ) : null}
                            </td>
                            <td>{r.shipping_origin_code ?? "-"}</td>
                            <td>{r.final_destination ?? "-"}</td>
                            <td>{r.status ?? "-"}</td>
                            <td>{fmtDate10(r.etd)}</td>
                            <td>{fmtDate10(r.eta)}</td>
                            <td className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => router.push(`/packing-lists/${r.id}`)}
                              >
                                Detail
                              </Button>
                              {/* ✅ 여기만 통일: 리스트에서 바로 새 탭 열기 (detail 페이지가 autoPdf 감지해서 생성) */}
                              <Button
                                size="sm"
                                onClick={() => window.open(`/packing-lists/${r.id}?autoPdf=1`, "_blank")}
                              >
                                PDF
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </TabsContent>
          </CardContent>
        </Card>
      </Tabs>
    </AppShell>
  );
}
