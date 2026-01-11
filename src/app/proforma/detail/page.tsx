// src/app/proforma/list/page.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

import jsPDF from "jspdf";
// @ts-ignore
import autoTable from "jspdf-autotable";

type DevRole = AppRole;

interface ProformaListItem {
  id: string;
  invoiceNo: string;
  poNo?: string | null;
  buyerName?: string | null;
  currency?: string | null;
  createdAt?: string | null;
  subtotal: number;
}

function safeTrim(v: any) {
  return (v ?? "").toString().trim();
}

function firstNonEmpty(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== null && v !== undefined && safeTrim(v) !== "") return v;
  }
  return null;
}

function escapeIlikePattern(v: string) {
  return v.replace(/[%_]/g, (m) => `\\${m}`);
}

export default function ProformaListPage() {
  const router = useRouter();
  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);

  const [loading, setLoading] = React.useState(true);
  const [role, setRole] = React.useState<DevRole | null>(null);

  const [keyword, setKeyword] = React.useState("");
  const [searching, setSearching] = React.useState(false);
  const [items, setItems] = React.useState<ProformaListItem[]>([]);
  const [exportingId, setExportingId] = React.useState<string | null>(null);

  // ------------------------------
  // Auth & Role
  // ------------------------------
  React.useEffect(() => {
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/login?redirectTo=/proforma/list");
        return;
      }

      const meta = (session.user.user_metadata || {}) as any;
      const r: AppRole = meta.role || "viewer";

      setRole(r as DevRole);
      setLoading(false);

      if (r === "viewer") {
        alert("You do not have permission to view Proforma Invoices.");
        router.replace("/");
      }
    })();
  }, [router, supabase]);

  // ------------------------------
  // List Load
  // ------------------------------
  const fetchList = React.useCallback(async (kw: string) => {
    setSearching(true);
    try {
      const params = new URLSearchParams();
      if (kw.trim()) params.set("keyword", kw.trim());

      const res = await fetch(`/api/proforma/list?${params.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        console.error("Failed to load proforma list:", data);
        alert((data && (data.error || data.message)) || `Failed to load list (status ${res.status}).`);
        return;
      }

      setItems((data?.items as ProformaListItem[]) || []);
    } catch (err) {
      console.error("Unexpected error loading proforma list:", err);
      alert("Unexpected error while loading proforma list.");
    } finally {
      setSearching(false);
    }
  }, []);

  React.useEffect(() => {
    if (!loading && role && role !== "viewer") fetchList("");
  }, [loading, role, fetchList]);

  // ------------------------------
  // Companies(Buyer) helper
  // ------------------------------
  async function loadBuyerCompanyById(companyId: string) {
    const select1 = [
      "id",
      "company_name",
      "code",
      "buyer_consignee",
      "buyer_notify_party",
      "buyer_final_destination",
      "buyer_payment_term",
      "buyer_default_incoterm",
      "buyer_default_ship_mode",
      "origin_mark",
      "factory_sea_port",
      "factory_air_port",
    ].join(",");

    const r1 = await supabase.from("companies").select(select1).eq("id", companyId).maybeSingle();
    if (!r1.error) return r1.data;

    console.warn("Failed to load buyer company:", r1.error);
    return null;
  }

  async function loadBuyerCompanyByName(companyName: string) {
    const name = safeTrim(companyName);
    if (!name) return null;

    const pattern = `%${escapeIlikePattern(name)}%`;

    const select = [
      "id",
      "company_name",
      "code",
      "buyer_consignee",
      "buyer_notify_party",
      "buyer_final_destination",
      "buyer_payment_term",
      "buyer_default_incoterm",
      "buyer_default_ship_mode",
      "origin_mark",
      "factory_sea_port",
      "factory_air_port",
    ].join(",");

    const r = await supabase.from("companies").select(select).ilike("company_name", pattern).maybeSingle();
    if (!r.error) return r.data;

    console.warn("Failed to load buyer company by name:", r.error);
    return null;
  }

  // ------------------------------
  // PDF Export (jsPDF)
  // ------------------------------
  const handleExportPdf = async (pi: ProformaListItem) => {
    try {
      setExportingId(pi.id);

      // 1) Detail
      const params = new URLSearchParams();
      params.set("invoiceNo", pi.invoiceNo);

      const res = await fetch(`/api/proforma/detail?${params.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        console.error("Failed to load proforma detail:", data);
        alert((data && (data.error || data.message)) || `Failed to load detail (status ${res.status}).`);
        return;
      }

      const header = data?.header || {};
      const lines = (data?.lines || []) as Array<any>;

      // 2) Buyer company (companies 테이블만)
      const buyerCompanyId =
        firstNonEmpty(header, ["buyerCompanyId", "buyer_company_id", "buyerId", "buyer_id"]) || null;

      const buyerName =
        safeTrim(firstNonEmpty(header, ["buyerName", "buyer_name"])) ||
        safeTrim(pi.buyerName) ||
        "";

      let buyerCompany: any | null = null;
      if (buyerCompanyId) buyerCompany = await loadBuyerCompanyById(String(buyerCompanyId));
      if (!buyerCompany && buyerName) buyerCompany = await loadBuyerCompanyByName(buyerName);

      const consigneeText =
        safeTrim(firstNonEmpty(header, ["consigneeText", "consignee_text"])) ||
        safeTrim(buyerCompany?.buyer_consignee) ||
        buyerName ||
        "-";

      const notifyPartyText =
        safeTrim(firstNonEmpty(header, ["notifyPartyText", "notify_party_text"])) ||
        safeTrim(buyerCompany?.buyer_notify_party) ||
        consigneeText ||
        "-";

      const finalDestinationText =
        safeTrim(firstNonEmpty(header, ["finalDestinationText", "final_destination", "destination"])) ||
        safeTrim(buyerCompany?.buyer_final_destination) ||
        "-";

      const paymentTerm =
        safeTrim(firstNonEmpty(header, ["paymentTerm", "payment_term"])) ||
        safeTrim(buyerCompany?.buyer_payment_term) ||
        "-";

      const incoterm =
        safeTrim(firstNonEmpty(header, ["incoterm"])) ||
        safeTrim(buyerCompany?.buyer_default_incoterm) ||
        "-";

      const shipMode =
        safeTrim(firstNonEmpty(header, ["shipMode", "ship_mode"])) ||
        safeTrim(buyerCompany?.buyer_default_ship_mode) ||
        "-";

      const invoiceNo =
        safeTrim(firstNonEmpty(header, ["invoiceNo", "invoice_no"])) || pi.invoiceNo;

      const poNo =
        safeTrim(firstNonEmpty(header, ["poNo", "po_no", "po_reference"])) ||
        safeTrim(pi.poNo) ||
        "";

      const createdAt = firstNonEmpty(header, ["createdAt", "created_at"]) as any;
      const dateText = createdAt ? new Date(createdAt).toLocaleDateString() : "-";

      const currencyCode =
        safeTrim(firstNonEmpty(header, ["currency"])) ||
        safeTrim(pi.currency) ||
        "USD";

      const subtotal = lines.reduce((sum: number, l: any) => sum + Number(l?.amount ?? 0), 0);

      const toPlainLines = (txt?: string | null) =>
        (txt || "")
          .replace(/\r\n/g, "\n")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);

      // ------------------------------
      // PDF
      // ------------------------------
      const doc = new jsPDF("p", "mm", "a4");
      const pageWidth = doc.internal.pageSize.getWidth();
      const marginLeft = 8;
      const contentWidth = pageWidth - marginLeft * 2;
      const halfWidth = contentWidth / 2;

      let y = 15;

      doc.setFontSize(20);
      doc.setFont("helvetica", "bold");
      doc.text("Proforma Invoice", pageWidth / 2, y, { align: "center" });
      y += 12;

      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.text(`Buyer: ${buyerName || "-"}`, marginLeft, y);
      doc.text(`Invoice No: ${invoiceNo}`, pageWidth - marginLeft, y, { align: "right" });
      y += 6;
      doc.text(`PO No: ${poNo || "-"}`, marginLeft, y);
      doc.text(`Date: ${dateText}`, pageWidth - marginLeft, y, { align: "right" });
      y += 10;

      // Shipper/Terms box (간단 버전)
      const shipperBlock = "JM INTERNATIONAL CO.,LTD";
      const shipperLines = doc.splitTextToSize(shipperBlock, halfWidth - 4);
      const termsLines = doc.splitTextToSize(
        [`Terms: ${paymentTerm}`, `Incoterm: ${incoterm}`, `Ship Mode: ${shipMode}`].join("\n"),
        halfWidth - 4
      );

      const lh = 4;
      const boxH = Math.max(shipperLines.length, termsLines.length) * lh + 10;

      doc.rect(marginLeft, y, halfWidth, boxH);
      doc.rect(marginLeft + halfWidth, y, halfWidth, boxH);

      doc.setFont("helvetica", "bold");
      doc.text("Shipper / Exporter", marginLeft + 2, y + 5);
      doc.text("Invoice & Terms", marginLeft + halfWidth + 2, y + 5);
      doc.setFont("helvetica", "normal");

      doc.text(shipperLines, marginLeft + 2, y + 10);
      doc.text(termsLines, marginLeft + halfWidth + 2, y + 10);

      y += boxH + 4;

      // Consignee/Notify
      const consLines = doc.splitTextToSize(toPlainLines(consigneeText).join("\n") || "-", halfWidth - 4);
      const notiLines = doc.splitTextToSize(toPlainLines(notifyPartyText).join("\n") || "-", halfWidth - 4);
      const boxH2 = Math.max(consLines.length, notiLines.length) * lh + 10;

      doc.rect(marginLeft, y, halfWidth, boxH2);
      doc.rect(marginLeft + halfWidth, y, halfWidth, boxH2);

      doc.setFont("helvetica", "bold");
      doc.text("Consignee", marginLeft + 2, y + 5);
      doc.text("Notify Party", marginLeft + halfWidth + 2, y + 5);
      doc.setFont("helvetica", "normal");

      doc.text(consLines, marginLeft + 2, y + 10);
      doc.text(notiLines, marginLeft + halfWidth + 2, y + 10);

      y += boxH2 + 4;

      // Final destination
      doc.rect(marginLeft, y, contentWidth, 14);
      doc.setFont("helvetica", "bold");
      doc.text("Final Destination", marginLeft + 2, y + 5);
      doc.setFont("helvetica", "normal");
      doc.text(finalDestinationText || "-", marginLeft + 2, y + 10);
      y += 20;

      // Table
      const head = [["PO #", "Buyer Style", "Description", "HS Code", "Qty", "UOM", "Unit Price", "Amount"]];
      const body = lines.map((l: any) => {
        const qty = Number(l?.qty ?? 0);
        const up = Number(l?.unit_price ?? 0);
        const amt = Number(l?.amount ?? qty * up);

        return [
          poNo || "",
          l?.buyer_style_no || "",
          l?.description || "",
          l?.hs_code || "",
          qty ? qty.toLocaleString("en-US") : "",
          l?.uom || "",
          up ? up.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00",
          amt ? amt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00",
        ];
      });

      (autoTable as any)(doc, {
        startY: y,
        margin: { left: marginLeft, right: marginLeft },
        head,
        body,
        theme: "grid",
        styles: { fontSize: 8, cellPadding: 1.8, halign: "center", valign: "middle" },
        headStyles: { fontStyle: "bold", halign: "center" },
        columnStyles: {
          4: { halign: "right" },
          6: { halign: "right" },
          7: { halign: "right" },
        },
      });

      const lastY = (doc as any).lastAutoTable?.finalY || y + 20;

      doc.setFontSize(10);
      doc.text("Subtotal", marginLeft, lastY + 8);
      doc.text(
        `${currencyCode} ${subtotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        pageWidth - marginLeft,
        lastY + 8,
        { align: "right" }
      );

      doc.save(`${invoiceNo || "proforma"}.pdf`);
    } catch (err) {
      console.error("Unexpected error exporting proforma PDF:", err);
      alert("Unexpected error while exporting Proforma Invoice.");
    } finally {
      setExportingId(null);
    }
  };

  if (loading || !role) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="text-sm text-slate-500">Loading...</div>
      </div>
    );
  }

  return (
    <AppShell role={role} title="Proforma Invoices" description="List of Proforma Invoices">
      <div className="p-4">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle className="text-xl">Proforma Invoices</CardTitle>
              <p className="text-xs text-zinc-500 mt-1">
                Search and export Proforma Invoices (PDF).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 px-3 text-xs"
                onClick={() => router.push("/proforma")}
              >
                Go to /proforma
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 px-3 text-xs"
                onClick={() => router.push("/po/create")}
              >
                Go to PO Create
              </Button>
            </div>
          </CardHeader>

          <CardContent>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="Search by Invoice No, PO No, Buyer..."
                className="max-w-xs text-sm"
              />
              <Button
                type="button"
                size="sm"
                onClick={() => fetchList(keyword)}
                disabled={searching}
                className="h-8 px-3 text-xs"
              >
                {searching ? "Searching..." : "Search"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setKeyword("");
                  fetchList("");
                }}
                className="h-8 px-3 text-xs"
              >
                Reset
              </Button>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-zinc-50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Invoice No</th>
                    <th className="px-3 py-2 text-left font-medium">PO No</th>
                    <th className="px-3 py-2 text-left font-medium">Buyer</th>
                    <th className="px-3 py-2 text-left font-medium">Created At</th>
                    <th className="px-3 py-2 text-right font-medium">Subtotal</th>
                    <th className="px-3 py-2 text-center font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                        No Proforma Invoice found.
                      </td>
                    </tr>
                  )}

                  {items.map((pi) => (
                    <tr key={pi.id} className="border-b last:border-0">
                      <td className="px-3 py-2">{pi.invoiceNo}</td>
                      <td className="px-3 py-2">
                        {pi.poNo ? pi.poNo : <span className="text-zinc-400">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {pi.buyerName ? pi.buyerName : <span className="text-zinc-400">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {pi.createdAt ? (
                          new Date(pi.createdAt).toLocaleString()
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {(pi.currency || "USD") + " "}
                        {Number(pi.subtotal || 0).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-3 text-[11px]"
                            onClick={() =>
                              pi.poNo
                                ? router.push(`/po/create?poNo=${encodeURIComponent(pi.poNo)}`)
                                : alert("This Proforma has no linked PO No.")
                            }
                          >
                            Open PO
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            className="h-7 px-3 text-[11px]"
                            onClick={() => handleExportPdf(pi)}
                            disabled={exportingId === pi.id}
                          >
                            {exportingId === pi.id ? "Making PDF..." : "PDF"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
