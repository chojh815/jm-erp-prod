/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import jsPDF from "jspdf";

import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { createClient } from "@/lib/supabase/client";

type AnyRow = Record<string, any>;

function safeText(v: any) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  return String(v);
}

function safeNum(v: any) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtDate(v: any) {
  const s = safeText(v);
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function money(v: any, decimals = 2) {
  const n = safeNum(v);
  if (n === null) return "";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
}

function extFromDataUrl(dataUrl: string) {
  const m = /^data:image\/([a-zA-Z0-9+.-]+);base64,/.exec(dataUrl);
  const ext = (m?.[1] || "").toLowerCase();
  if (ext.includes("png")) return "PNG";
  if (ext.includes("webp")) return "WEBP";
  return "JPEG";
}

async function fetchQuotationAll(id: string) {
  const supabase = createClient();

  const headerQ = supabase
    .from("quotation_headers")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  const itemsQ = supabase
    .from("quotation_items")
    .select("*")
    .eq("quotation_id", id)
    .order("created_at", { ascending: true });

  const [headerR, itemsR] = await Promise.all([headerQ, itemsQ]);

  if (headerR.error) throw headerR.error;
  if (itemsR.error) throw itemsR.error;

  const header = (headerR.data ?? null) as Record<string, any> | null;
  const items = (itemsR.data ?? []) as Record<string, any>[];

  const itemIds = items.map((x) => x?.id).filter(Boolean);
  let tiers: Record<string, any>[] = [];
  if (itemIds.length) {
    const tiersR = await supabase
      .from("quotation_item_tiers")
      .select("*")
      .in("quotation_item_id", itemIds)
      .order("qty", { ascending: true });

    if (!tiersR.error && Array.isArray(tiersR.data)) {
      tiers = tiersR.data as Record<string, any>[];
    }
  }

  let buyerName = safeText(header?.buyer_name || header?.buyer || "");
  if (!buyerName && header?.buyer_id) {
    const buyerR = await supabase
      .from("companies")
      .select("company_name, code, name")
      .eq("id", header.buyer_id)
      .maybeSingle();

    if (!buyerR.error && buyerR.data) {
      buyerName =
        safeText((buyerR.data as any).company_name) ||
        safeText((buyerR.data as any).name) ||
        safeText((buyerR.data as any).code);
    }
  }

  let costingImages: Record<string, any>[] = [];
  const costingId =
    header?.costing_id ||
    header?.source_costing_id ||
    header?.costing_header_id ||
    null;

  if (costingId) {
    const imgR = await supabase
      .from("costing_images")
      .select("*")
      .eq("costing_id", costingId)
      .order("sort_order", { ascending: true });

    if (!imgR.error && Array.isArray(imgR.data)) {
      costingImages = imgR.data as Record<string, any>[];
    }
  }

  return {
    header,
    buyerName,
    items,
    tiers,
    costingImages,
  };
}

function pickPrimaryImage(costingImages: Record<string, any>[]) {
  if (!Array.isArray(costingImages) || costingImages.length === 0) return null;
  return costingImages.find((x) => !!x?.is_primary) || costingImages[0] || null;
}

async function buildPdf(payload: {
  header: Record<string, any> | null;
  buyerName: string;
  items: Record<string, any>[];
  tiers: Record<string, any>[];
  costingImages: Record<string, any>[];
}) {
  const { header, buyerName, items, tiers, costingImages } = payload;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;

  let y = 40;

  const addPage = () => {
    doc.addPage();
    y = 40;
  };

  const ensure = (h: number) => {
    if (y + h > pageH - 40) addPage();
  };

  const line = (yPos: number) => {
    doc.setDrawColor(220, 226, 232);
    doc.line(margin, yPos, pageW - margin, yPos);
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("QUOTATION", margin, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(fmtDate(header?.received_date || header?.created_at || new Date().toISOString()), pageW - margin, y - 2, {
    align: "right",
  });

  y += 18;
  doc.setFontSize(11);
  doc.setTextColor(90, 102, 118);
  doc.text("Fashion Jewelry / Buyer Proposal", margin, y);
  doc.setTextColor(0, 0, 0);

  y += 18;
  line(y);
  y += 18;

  const leftX = margin;
  const rightX = pageW / 2 + 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Quotation No", leftX, y);
  doc.text("Buyer", rightX, y);
  y += 14;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(safeText(header?.quotation_no || header?.quote_no || "DRAFT"), leftX, y);
  doc.text(buyerName || "-", rightX, y);
  y += 18;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Brand", leftX, y);
  doc.text("Currency / Incoterm", rightX, y);
  y += 14;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(
    safeText(header?.brand_name || header?.brand || header?.buyer_brand_name || "-"),
    leftX,
    y
  );
  doc.text(
    `${safeText(header?.currency || "USD")}${safeText(header?.incoterm ? ` / ${header.incoterm}` : "")}`,
    rightX,
    y
  );
  y += 18;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Subject / Style", leftX, y);
  y += 14;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(
    safeText(
      header?.subject ||
      header?.style_no ||
      items?.[0]?.style_no ||
      items?.[0]?.buyer_style_no ||
      items?.[0]?.jm_style_no ||
      "-"
    ),
    leftX,
    y
  );

  const primaryImg = pickPrimaryImage(costingImages);
  if (primaryImg?.image_url) {
    const dataUrl = await fetchImageAsDataUrl(String(primaryImg.image_url));

    if (dataUrl) {
      const imgW = 112;
      const imgH = 112;
      const x = pageW - margin - imgW;
      const imgY = 84;

      try {
        doc.addImage(dataUrl, extFromDataUrl(dataUrl), x, imgY, imgW, imgH);
      } catch (e) {
        console.warn("image add fail", e);
      }
    }
  }

  y += 30;

  const remarks = safeText(header?.remarks || "");
  if (remarks) {
    ensure(48);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Remarks", margin, y);
    y += 14;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const wrapped = doc.splitTextToSize(remarks, pageW - margin * 2);
    doc.text(wrapped, margin, y);
    y += wrapped.length * 12 + 8;
  }

  y += 6;
  line(y);
  y += 18;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Items", margin, y);
  y += 16;

  const cols = {
    style: margin,
    desc: margin + 92,
    qty: margin + 312,
    cost: margin + 378,
    offer: margin + 454,
    marginPct: margin + 530,
  };

  const widths = {
    style: 84,
    desc: 210,
    qty: 54,
    cost: 64,
    offer: 64,
    marginPct: 44,
  };

  const drawTableHeader = () => {
    ensure(28);
    doc.setFillColor(246, 248, 250);
    doc.rect(margin, y, pageW - margin * 2, 24, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("STYLE", cols.style, y + 15);
    doc.text("DESCRIPTION", cols.desc, y + 15);
    doc.text("QTY", cols.qty + widths.qty, y + 15, { align: "right" });
    doc.text("COST", cols.cost + widths.cost, y + 15, { align: "right" });
    doc.text("OFFER", cols.offer + widths.offer, y + 15, { align: "right" });
    doc.text("M%", cols.marginPct + widths.marginPct, y + 15, { align: "right" });
    y += 24;
    line(y);
    y += 12;
  };

  drawTableHeader();

  let grandTotal = 0;

  for (let i = 0; i < items.length; i++) {
    const ln = items[i] || {};
    const qty = safeNum(ln.qty ?? ln.quantity) ?? 0;
    const cost = safeNum(ln.cost_usd ?? ln.total_cost_usd ?? ln.cost_cny ?? ln.total_cost_cny) ?? 0;
    const offer = safeNum(ln.offer_price_usd ?? ln.offer_usd ?? ln.price_usd ?? ln.unit_price ?? ln.offer_price) ?? 0;
    const marginPct =
      safeNum(ln.margin_pct ?? ln.margin_percent) ??
      (offer > 0 ? ((offer - cost) / offer) * 100 : 0);

    const amount = qty * offer;
    grandTotal += amount;

    const style =
      safeText(ln.style_no || ln.buyer_style_no || ln.jm_style_no || `ITEM ${i + 1}`) || "-";
    const desc =
      safeText(ln.description || ln.style_name || ln.item_name || header?.subject || "-") || "-";

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);

    const styleLines = doc.splitTextToSize(style, widths.style);
    const descLines = doc.splitTextToSize(desc, widths.desc);
    const rowLines = Math.max(styleLines.length, descLines.length);
    const rowH = Math.max(18, rowLines * 11 + 2);
    ensure(rowH + 8);
    if (y + rowH + 8 > pageH - 40) {
      drawTableHeader();
    }

    doc.text(styleLines, cols.style, y);
    doc.text(descLines, cols.desc, y);
    doc.text(money(qty, 0), cols.qty + widths.qty, y, { align: "right" });
    doc.text(money(cost, 2), cols.cost + widths.cost, y, { align: "right" });
    doc.text(money(offer, 2), cols.offer + widths.offer, y, { align: "right" });
    doc.text(money(marginPct, 1), cols.marginPct + widths.marginPct, y, { align: "right" });

    y += rowH;
    line(y);
    y += 10;

    const myTiers = tiers.filter((t) => String(t?.quotation_item_id || "") === String(ln?.id || ""));
    if (myTiers.length) {
      ensure(40);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.text("Price Tiers", cols.desc, y);
      y += 10;

      let tx = cols.desc;
      for (const tier of myTiers) {
        const qtyTxt = safeText(tier?.qty || tier?.moq || "");
        const priceTxt = money(tier?.unit_price ?? tier?.unit_price_usd, 2);
        const badge = `${qtyTxt}: ${priceTxt}`;
        doc.setDrawColor(224, 229, 235);
        doc.roundedRect(tx, y - 8, 70, 18, 4, 4);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.text(badge, tx + 35, y + 4, { align: "center" });
        tx += 76;
        if (tx > pageW - margin - 70) {
          tx = cols.desc;
          y += 22;
        }
      }
      y += 16;
    }
  }

  ensure(70);
  y += 8;
  const totalBoxW = 180;
  const totalBoxX = pageW - margin - totalBoxW;
  doc.setFillColor(248, 249, 251);
  doc.roundedRect(totalBoxX, y, totalBoxW, 50, 8, 8, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("TOTAL AMOUNT", totalBoxX + 14, y + 18);

  doc.setFontSize(16);
  doc.text(
    `${safeText(header?.currency || "USD")} ${money(grandTotal, 2)}`,
    totalBoxX + totalBoxW - 14,
    y + 36,
    { align: "right" }
  );

  y += 70;

  ensure(60);
  line(y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(95, 105, 118);
  const footer = [
    "This quotation is for buyer review only.",
    "Final pricing, shipment schedule, and product details are subject to confirmation.",
  ].join(" ");
  const footerLines = doc.splitTextToSize(footer, pageW - margin * 2);
  doc.text(footerLines, margin, y);
  doc.setTextColor(0, 0, 0);

  const filename =
    safeText(header?.quotation_no || header?.quote_no || "quotation").replace(/[^\w.-]+/g, "_") + ".pdf";

  doc.save(filename);
}

export default function QuotationPdfPage() {
  const params = useParams();
  const router = useRouter();
  const id = (params as any)?.id as string | undefined;

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleGenerate = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchQuotationAll(id);
      await buildPdf(payload);
    } catch (e: any) {
      setError(e?.message || "Failed to generate PDF");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell>
      <div className="p-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>Quotation PDF</CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => router.back()}>
                Back
              </Button>
              <Button onClick={handleGenerate} disabled={!id || loading}>
                {loading ? "Generating..." : "Generate & Download"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground">
              Buyer-friendly quotation PDF with image, pricing table, tier badges, and total amount.
            </div>
            {error ? (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
