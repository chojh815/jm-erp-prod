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

function isUuidLike(s?: string | null) {
  if (!s) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s).trim()
  );
}

function safeText(v: any) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  return String(v);
}

// Ship-From label should match the UI logic (A안):
// code(site_code/origin_code) + site_name(name) + city/country
function shipFromLabelFromRow(site: AnyRow | null | undefined) {
  if (!site) return "";
  const s = (x: any) => safeText(x).trim();

  // Prefer stable code + concise human-readable place.
  const code = s(site.code) || s(site.site_code) || s(site.shipping_site_code);

  const name =
    s(site.name) ||
    s(site.site_name) ||
    s(site.display_name) ||
    s(site.company_name);

  const city = s(site.city) || s(site.address_city) || s(site.site_city);
  const state = s(site.state) || s(site.address_state) || s(site.site_state);

  const country =
    s(site.country) ||
    s(site.country_name) ||
    s(site.address_country) ||
    s(site.site_country);

  const placeParts = [city, state, country].filter(Boolean);
  const place = placeParts.join(", ");

  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
  const nName = norm(name);
  const nCity = norm(city);
  const nPlace = norm(place);

  // Only include `name` when it adds information (not just the city repeated).
  const includeName = !!name && (!city || nName !== nCity) && (!place || !nPlace.includes(nName));

  if (code && place) {
    return includeName ? `${code} — ${name} — ${place}` : `${code} — ${place}`;
  }
  if (code && includeName) return `${code} — ${name}`;
  if (code) return code;
  if (place) return includeName ? `${name} — ${place}` : place;
  return name;
}

function safeNum(v: any) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtMoney(v: any, decimals = 2) {
  const n = safeNum(v);
  if (n === null) return "";
  return n.toFixed(decimals);
}

function fmtInt(v: any) {
  const n = safeNum(v);
  if (n === null) return "";
  return String(Math.trunc(n));
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

async function fetchQuotationAll(id: string) {
  const supabase = createClient();

  const headerQ = supabase
    .from("quotation_headers")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  const linesQ = supabase
    .from("quotation_lines")
    .select("*")
    .eq("quotation_id", id)
    .eq("is_deleted", false)
    .order("line_no", { ascending: true });

  const variantsQ = supabase
    .from("quotation_variants")
    .select("*")
    .eq("quotation_id", id)
    .eq("is_deleted", false)
    .order("created_at", { ascending: true });

  const [headerR, linesR, variantsR] = await Promise.all([headerQ, linesQ, variantsQ]);

  if (headerR.error) throw headerR.error;
  if (linesR.error) throw linesR.error;
  if (variantsR.error) throw variantsR.error;

  const variants = (variantsR.data ?? []) as AnyRow[];

  // ✅ Ship-From label map (A안): show FOB location in PDF
  // We store display text on each variant as `ship_from_display`.
  try {
    const uuidLike = (s: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        String(s || "").trim()
      );

    const siteIds = Array.from(
      new Set(
        (variantsR.data ?? [])
          .map((v: any) => {
            const sid = v?.ship_from_site_id ? String(v.ship_from_site_id) : "";
            if (sid) return sid;
            const sf = v?.ship_from ? String(v.ship_from) : "";
            return uuidLike(sf) ? sf : "";
          })
          .filter(Boolean)
      )
    );
    if (siteIds.length > 0) {
      // NOTE:
      // Some environments store `is_deleted` as NULL for active rows.
      // Also, some older schemas may not have `is_deleted` on company_sites.
      // We therefore try an inclusive filter first, then fall back to no filter.
      // Use '*' to be resilient to column-name variations across deployments.
      // shipFromLabelFromRow() will pick the best available fields.
      const baseSelect = "*";

      let sitesR = await supabase
        .from("company_sites")
        // keep this aligned with the UI's shipFromLabel() logic
        .select(baseSelect)
        .in("id", siteIds)
        .or("is_deleted.is.null,is_deleted.eq.false");

      if (sitesR.error) {
        // Fall back (schema mismatch): try again without is_deleted filtering.
        sitesR = await supabase
          .from("company_sites")
          .select(baseSelect)
          .in("id", siteIds);
      }

      const sites = (sitesR.data ?? []) as AnyRow[];

      const labelOf = (s: AnyRow) => shipFromLabelFromRow(s);

      const map: Record<string, string> = {};
      for (const s of sites) {
        const sid = String((s as any).id);
        map[sid] = labelOf(s);
      }

      // If the lookup above can't build a meaningful label, try resolving from `companies`.
      // (Some builds store ship_from_site_id as `companies.id` for our Shipping Site company.)
      const unresolved = siteIds.filter((sid) => {
        const v = map[sid];
        return !v || v === sid;
      });
      if (unresolved.length) {
        const companiesR = await supabase
          .from("companies")
          .select("id, code, name, city, state, country, country_code, is_deleted")
          .in("id", unresolved)
          .limit(1000);
        if (!companiesR.error && Array.isArray(companiesR.data)) {
          for (const c of companiesR.data as any[]) {
            const sid = String(c?.id || "");
            if (!sid) continue;
            const lbl = shipFromLabelFromRow(c);
            if (lbl && lbl !== sid) map[sid] = lbl;
          }
        }
      }

      // Attach to variants rows (A option: prefer stored ship_from text; otherwise map id -> label)
      (variantsR.data ?? []).forEach((v: any) => {
        const rawSf = v?.ship_from ? String(v.ship_from) : "";
        const sid = v?.ship_from_site_id
          ? String(v.ship_from_site_id)
          : uuidLike(rawSf)
            ? rawSf
            : "";

        const shipFromDisplay =
          rawSf && !uuidLike(rawSf)
            ? rawSf
            : sid
              ? (map[sid] || "")
              : "";

        v.ship_from_display = shipFromDisplay;
      });
    } else {
      (variantsR.data ?? []).forEach((v: any) => (v.ship_from_display = ""));
    }
  } catch (e) {
    // non-fatal
    (variantsR.data ?? []).forEach((v: any) => (v.ship_from_display = ""));
  }


  const variantIds = variants.map((v) => v.id).filter(Boolean);

  let variantLines: AnyRow[] = [];
  if (variantIds.length > 0) {
    // Schema (confirmed): quotation_variant_lines.quotation_variant_id (FK) + quotation_line_id
    const vLinesR = await supabase
      .from("quotation_variant_lines")
      .select("*")
      .in("quotation_variant_id", variantIds)
      .eq("is_deleted", false)
      .order("created_at", { ascending: true });

    if (vLinesR.error) throw vLinesR.error;
    variantLines = (vLinesR.data ?? []) as AnyRow[];
  }

  return {
    header: headerR.data as AnyRow | null,
    lines: (linesR.data ?? []) as AnyRow[],
    variants,
    variantLines,
  };
}

function buildPdf(payload: {
  header: AnyRow | null;
  lines: AnyRow[];
  variants: AnyRow[];
  variantLines: AnyRow[];
}) {
  const { header, lines, variants, variantLines } = payload;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 36;

  let y = 48;

  const ensurePage = (extra: number) => {
    if (y + extra > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  // ===== Header =====
  doc.setFontSize(18);
  doc.text("QUOTATION", pageW / 2, y, { align: "center" });
  y += 26;

  doc.setFontSize(10);

  const qNo = safeText(header?.quotation_no || header?.quote_no);
  const buyer = safeText(header?.buyer_name) || safeText(header?.buyer_code) || safeText(header?.buyer);
  const brand =
    safeText(header?.brand_name) ||
    safeText(header?.brand) ||
    safeText(header?.buyer_brand_name) ||
    safeText(header?.buyer_brand);
  const rcvd = fmtDate(header?.received_date || header?.created_at);

  const left = margin;
  const right = pageW / 2 + 8;

  doc.text(`Quotation No: ${qNo}`, left, y);
  doc.text(`Received: ${rcvd}`, right, y);
  y += 14;
  doc.text(`Buyer: ${buyer}`, left, y);
  doc.text(`Brand: ${brand}`, right, y);
  y += 18;

  const notes = safeText(header?.remarks || header?.notes);
  if (notes) {
    doc.setFontSize(9);
    doc.text("Remarks:", left, y);
    y += 12;
    const wrapped = doc.splitTextToSize(notes, pageW - margin * 2);
    doc.text(wrapped, left, y);
    y += wrapped.length * 10 + 10;
  }

  // Build line lookup for joins
  const lineById = new Map<string, AnyRow>();
  for (const ln of lines) {
    if (ln?.id) lineById.set(String(ln.id), ln);
  }

  // ===== Variant Sections =====
  doc.setFontSize(12);
  doc.text("Variants", left, y);
  y += 12;

  // Column positions for variant table
  const c1 = left;          // Style
  const c2 = left + 90;     // MOQ
  const c3 = left + 145;    // Qty
  const c4 = left + 200;    // Target
  const c5 = left + 280;    // Offer
  const c6 = left + 360;    // Notes (wrap)
  const cEnd = pageW - margin;

  const drawVariantHeaderRow = () => {
    doc.setFontSize(9);
    doc.text("Style", c1, y);
    doc.text("MOQ", c2, y);
    doc.text("Qty", c3, y);
    doc.text("Target", c4, y);
    doc.text("Offer", c5, y);
    doc.text("Notes", c6, y);
    y += 8;
    doc.line(left, y, cEnd, y);
    y += 10;
  };

  const drawSectionTitle = (title: string) => {
    ensurePage(40);
    doc.setFontSize(10);
    doc.text(title, left, y);
    y += 10;
    drawVariantHeaderRow();
  };

  const sumAmount = (rows: AnyRow[]) => {
    let total = 0;
    for (const r of rows) {
      const qty = safeNum(r.qty);
      const offer = safeNum(r.offer_price);
      if (qty !== null && offer !== null) total += qty * offer;
    }
    return total;
  };

  for (const v of variants) {
    const vId = String(v.id || "");
    const label = safeText(v.label ?? v.name ?? `Variant`);
    const incoterm = safeText(v.incoterm ?? "");
    const currency = safeText(v.currency ?? "USD");
    const shipFromPretty = safeText(
      v.ship_from_display ??
        v.ship_from_site_display ??
        v.ship_from_site_name ??
        v.ship_from_site ??
        v.ship_from ??
        v.ship_from_code ??
        v.ship_from_site_code ??
        v.ship_from_name ??
        ""
    ).trim();

    // A option: ship_from_display should already be a human-readable label.
    // Do NOT show raw UUIDs in the PDF.
    const shipFrom = shipFromPretty;
    const titleParts = [
      label || "Variant",
      incoterm ? incoterm : "",
      currency ? currency : "",
      shipFrom ? `Ship From: ${shipFrom}` : "",
    ].filter(Boolean);
    drawSectionTitle(titleParts.join(" / "));

    const related = variantLines.filter((vl) => String(vl.quotation_variant_id) === vId);
    if (!related.length) {
      doc.setFontSize(9);
      doc.text("(no items)", left, y);
      y += 12;
      continue;
    }

    // rows
    doc.setFontSize(9);
    for (const vl of related) {
      ensurePage(34);

      const ln = vl.quotation_line_id ? lineById.get(String(vl.quotation_line_id)) : null;

      const style =
        safeText(ln?.style_no) ||
        safeText(ln?.buyer_style_no) ||
        safeText(ln?.jm_style_no) ||
        safeText(vl.style_no);

      const moq = fmtInt(vl.moq);
      const qty = fmtInt(vl.qty);
      const target = fmtMoney(vl.target_price, 2);
      const offer = fmtMoney(vl.offer_price, 2);
      const note = safeText(vl.notes);

      doc.text(style, c1, y);
      doc.text(moq, c2, y);
      doc.text(qty, c3, y);
      doc.text(target, c4, y);
      doc.text(offer, c5, y);

      const noteW = cEnd - c6;
      const wrapped = note ? doc.splitTextToSize(note, noteW) : [""];
      doc.text(wrapped, c6, y);

      y += Math.max(12, wrapped.length * 10) + 4;
    }

    // totals
    ensurePage(24);
    doc.line(left, y, cEnd, y);
    y += 10;
    doc.setFontSize(9);
    const total = sumAmount(related);
    doc.text(`Total Amount (${currency}): ${fmtMoney(total, 2)}`, c5 - 30, y);
    y += 16;
  }

  const filename = qNo ? `Quotation-${qNo}.pdf` : `Quotation-${safeText(header?.id || "")}.pdf`;
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
      buildPdf(payload);
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
            <CardTitle>Quotation PDF (jsPDF)</CardTitle>
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
              Quotation ID: <span className="font-mono">{id || "(missing)"}</span>
            </div>
            {error ? (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}
            <div className="mt-3 text-xs text-muted-foreground">
              Note: This route is client-only. If you need a server-rendered PDF later, we should switch to a server PDF renderer.
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
