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

      const res = await fetch(`/api/proforma/list?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        alert("Failed to load list.");
        return;
      }

      setItems((data?.items as ProformaListItem[]) || []);
    } finally {
      setSearching(false);
    }
  }, []);

  React.useEffect(() => {
    if (!loading && role && role !== "viewer") fetchList("");
  }, [loading, role, fetchList]);

  // ------------------------------
  // PDF Export (jsPDF)
  // ------------------------------
  const handleExportPdf = async (pi: ProformaListItem) => {
    try {
      setExportingId(pi.id);

      const params = new URLSearchParams();
      params.set("invoiceNo", pi.invoiceNo);

      const res = await fetch(`/api/proforma/detail?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await res.json();

      const header = data?.header || {};
      const lines = data?.lines || [];

      const buyerName = safeTrim(header.buyer_name || pi.buyerName || "-");
      const invoiceNo = safeTrim(header.invoice_no || pi.invoiceNo);
      const poNo = safeTrim(header.po_no || pi.poNo || "-");
      const dateText = header.created_at
        ? new Date(header.created_at).toLocaleDateString()
        : "-";

      // ✅ 핵심 수정 포인트
      const portOfLoading = safeTrim(header.port_of_loading || "-");
      const finalDestination = safeTrim(header.final_destination || "-");

      const shipMode = safeTrim(header.ship_mode || "SEA");
      const incoterm = safeTrim(header.incoterm || "-");
      const paymentTerm = safeTrim(header.payment_term || "-");

      const currency = safeTrim(header.currency || pi.currency || "USD");
      const subtotal = lines.reduce(
        (s: number, l: any) => s + Number(l.amount || 0),
        0
      );

      const doc = new jsPDF("p", "mm", "a4");
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 10;
      let y = 15;

      doc.setFontSize(20);
      doc.setFont("helvetica", "bold");
      doc.text("Proforma Invoice", pageWidth / 2, y, { align: "center" });
      y += 12;

      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.text(`Buyer: ${buyerName}`, margin, y);
      doc.text(`Invoice No: ${invoiceNo}`, pageWidth - margin, y, {
        align: "right",
      });
      y += 6;
      doc.text(`PO No: ${poNo}`, margin, y);
      doc.text(`Date: ${dateText}`, pageWidth - margin, y, {
        align: "right",
      });
      y += 10;

      // Shipper / Terms
      doc.rect(margin, y, (pageWidth - margin * 2) / 2, 28);
      doc.rect(
        margin + (pageWidth - margin * 2) / 2,
        y,
        (pageWidth - margin * 2) / 2,
        28
      );

      doc.setFont("helvetica", "bold");
      doc.text("Shipper / Exporter", margin + 2, y + 5);
      doc.text(
        "Invoice & Terms",
        margin + (pageWidth - margin * 2) / 2 + 2,
        y + 5
      );

      doc.setFont("helvetica", "normal");
      doc.text("JM INTERNATIONAL CO., LTD", margin + 2, y + 11);

      doc.text(
        `Terms: ${paymentTerm}\nIncoterm: ${incoterm}\nShip Mode: ${shipMode}`,
        margin + (pageWidth - margin * 2) / 2 + 2,
        y + 11
      );

      y += 34;

      // Port / Destination
      doc.rect(margin, y, pageWidth - margin * 2, 20);
      doc.setFont("helvetica", "bold");
      doc.text("Port of Loading / Final Destination", margin + 2, y + 5);
      doc.setFont("helvetica", "normal");
      doc.text(
        `Port of Loading: ${portOfLoading}\nFinal Destination: ${finalDestination}`,
        margin + 2,
        y + 11
      );

      y += 26;

      // COO
      doc.rect(margin, y, pageWidth - margin * 2, 16);
      doc.setFont("helvetica", "bold");
      doc.text("COO / Certification", margin + 2, y + 5);
      doc.setFont("helvetica", "normal");
      doc.text(
        "COO: -\nWE CERTIFY THERE IS NO WOOD PACKING MATERIAL USED IN THIS SHIPMENT.",
        margin + 2,
        y + 11
      );

      y += 24;

      // Table
      autoTable(doc, {
        startY: y,
        head: [["PO #", "Buyer Style", "Description", "HS Code", "Qty", "UOM", "Unit Price", "Amount"]],
        body: lines.map((l: any) => [
          poNo,
          l.buyer_style_no || "",
          l.description || "",
          l.hs_code || "",
          Number(l.qty || 0).toLocaleString(),
          l.uom || "",
          Number(l.unit_price || 0).toFixed(2),
          Number(l.amount || 0).toFixed(2),
        ]),
        styles: { fontSize: 8 },
      });

      const lastY = (doc as any).lastAutoTable.finalY + 8;

      doc.text("Subtotal", margin, lastY);
      doc.text(
        `${currency} ${subtotal.toFixed(2)}`,
        pageWidth - margin,
        lastY,
        { align: "right" }
      );

      doc.save(`${invoiceNo}.pdf`);
    } finally {
      setExportingId(null);
    }
  };


// ------------------------------
// Open PO (navigate to PO detail)
// ------------------------------
const handleOpenPo = (pi: ProformaListItem) => {
  const poNo = safeTrim(pi.poNo);
  if (!poNo) {
    alert("PO No is missing.");
    return;
  }
  // ✅ IMPORTANT: include /po prefix (do NOT navigate to root "/{poNo}")
  router.push(`/po/${encodeURIComponent(poNo)}`);
};

  if (loading || !role) return null;

  return (
    <AppShell role={role} title="Proforma Invoices">
      <div className="p-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
      <div>
        <CardTitle>Proforma Invoices</CardTitle>
        <div className="text-xs text-muted-foreground">
          Search and open Proforma Invoices created from Purchase Orders.
        </div>
      </div>
      <Button onClick={() => router.push("/po/create")}>Go to PO Create</Button>
    </CardHeader>
          <CardContent>
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th>Invoice No</th>
                  <th>PO No</th>
                  <th>Buyer</th>
                  <th>Created</th>
                  <th className="text-right">Subtotal</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((pi) => (
                  <tr key={pi.id}>
                    <td>{pi.invoiceNo}</td>
                    <td>{pi.poNo || "-"}</td>
                    <td>{pi.buyerName || "-"}</td>
                    <td>{pi.createdAt}</td>
                    <td className="text-right">
                      {(pi.currency || "USD") + " "}
                      {Number(pi.subtotal).toFixed(2)}
                    </td>
                    <td className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        <Button size="sm" variant="secondary" onClick={() => handleOpenPo(pi)}>
                          Open PO
                        </Button>
                        <Button size="sm" onClick={() => handleExportPdf(pi)} disabled={exportingId === pi.id}>
                          {exportingId === pi.id ? "Exporting..." : "PDF"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
