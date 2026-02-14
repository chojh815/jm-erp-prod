// src/app/api/dashboards/performance/route.ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/app/api/_supabase";

export const dynamic = "force-dynamic";

type Dimension = "buyer" | "brand";

function asDateOnly(s: string | null | undefined) {
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function parseCsv(s: string | null): string[] | null {
  if (!s) return null;
  const arr = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return arr.length ? arr : null;
}

function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function pct(curr: number, base: number | null) {
  if (base === null || base === 0) return null;
  return round2(((curr - base) / base) * 100);
}

function monthStartFromDate(dateStr: string) {
  const s = String(dateStr).slice(0, 10); // YYYY-MM-DD
  const [y, m] = s.split("-");
  return `${y}-${m}-01`;
}

function yearMonthFromMonthStart(ms: string) {
  const y = Number(ms.slice(0, 4));
  const m = Number(ms.slice(5, 7));
  return { year: y, month: m };
}

/**
 * ✅ PO line USD amount 후보 (환경별 컬럼명 차이 대응)
 * - amount_usd 가 없는 환경도 있으므로 반드시 후보 방식으로 처리
 */
function getPoLineUsdAmount(line: any): number {
  if (!line) return 0;

  const candidates = [
    line.subtotal_usd,
    line.line_total_usd,
    line.total_amount_usd,
    line.total_usd,
    line.amount_usd, // 어떤 환경에는 있을 수 있으니 뒤쪽
    line.subtotal,
    line.amount,
    line.line_amount,
    line.fob_total_usd,
    line.extended_usd,
  ];

  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return 0;
}

/**
 * ✅ Invoice header total USD 후보 (환경별 컬럼명 차이 대응)
 */
function getInvoiceUsdTotal(inv: any): number {
  if (!inv) return 0;

  const candidates = [
    inv.total_amount_usd,
    inv.total_usd,
    inv.grand_total_usd,
    inv.total_amount,
    inv.total,
    inv.amount_usd,
  ];

  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return 0;
}

/**
 * ✅ Brand 후보 (테이블/환경별 컬럼 차이 대응)
 * - select에서 특정 brand 컬럼을 강제하지 말고, '*'로 가져온 뒤 여기서 안전하게 선택
 */
function pickBrand(obj: any): string {
  const v =
    obj?.buyer_brand_name ??
    obj?.brand ??
    obj?.buyer_brand ??
    obj?.brand_name ??
    obj?.buyer_brand_text ??
    null;

  const s = (v ?? "").toString().trim();
  return s ? s : "—";
}

/**
 * ✅ Invoice line USD amount 후보 (라인금액이 있으면 브랜드별 Shipping을 금액비례로 배분)
 * - 라인금액이 없다면 0으로 돌아가며, 그 경우 라인수 비례로 fallback 됨
 */
function getInvoiceLineUsdAmount(line: any): number {
  if (!line) return 0;

  const candidates = [
    line.line_total_usd,
    line.subtotal_usd,
    line.amount_usd,
    line.total_usd,
    line.line_amount_usd,
    line.amount,
    line.subtotal,
    line.total_amount,
  ];

  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return 0;
}

export async function GET(req: Request) {
  try {
    const supabase = createSupabaseServerClient();
    const url = new URL(req.url);

    const dimension = (url.searchParams.get("dimension") || "buyer") as Dimension;
    const start = asDateOnly(url.searchParams.get("start"));
    const end = asDateOnly(url.searchParams.get("end"));

    const buyerIds = parseCsv(url.searchParams.get("buyer_ids"));
    const brandNames = parseCsv(url.searchParams.get("brand_names"));

    // =========================================================
    // 1) ORDERS: ✅ order_date 기준 (CONFIRMED/DRAFT/SENT 무시)
    //    - CANCELLED만 제외
    // =========================================================
    let pq = supabase
      .from("po_headers")
      // ⚠️ 특정 컬럼(brand_name 등) select 금지. 환경별 컬럼 차이로 42703 터짐
      .select(`*, po_lines(*)`)
      .not("order_date", "is", null);

    if (start) pq = pq.gte("order_date", start);
    if (end) pq = pq.lte("order_date", end);
    if (buyerIds?.length) pq = pq.in("buyer_id", buyerIds);

    const { data: poRows, error: pe } = await pq;
    if (pe) throw pe;

    type RawRow = {
      buyer_id: string | null;
      buyer_name: string | null;
      brand_name: string | null;
      month_start: string;
      year: number;
      month: number;
      order_usd: number;
      ship_usd: number;
      order_yoy_pct: number | null;
      order_mom_pct: number | null;
      ship_yoy_pct: number | null;
      ship_mom_pct: number | null;
    };

    // buyer + brand + month_start bucket
    const rawMap = new Map<string, RawRow>();

    for (const h of poRows || []) {
      const od = h?.order_date;
      if (!od) continue;

      if (String(h?.status || "").toUpperCase() === "CANCELLED") continue;

      const ms = monthStartFromDate(od);
      const { year, month } = yearMonthFromMonthStart(ms);

      const brand = pickBrand(h);
      if (brandNames?.length && !brandNames.includes(brand)) continue;

      const buyerId = h?.buyer_id ?? null;
      const buyerName = h?.buyer_name ?? h?.buyer_company_name ?? null;

      const key = `${buyerId || "NULL"}__${buyerName || "UNKNOWN"}__${brand}__${ms}`;

      const prev =
        rawMap.get(key) ||
        ({
          buyer_id: buyerId,
          buyer_name: buyerName,
          brand_name: brand,
          month_start: ms,
          year,
          month,
          order_usd: 0,
          ship_usd: 0,
          order_yoy_pct: null,
          order_mom_pct: null,
          ship_yoy_pct: null,
          ship_mom_pct: null,
        } as RawRow);

      const lines = (h as any).po_lines || [];
      let sum = 0;
      for (const line of lines) sum += getPoLineUsdAmount(line);

      prev.order_usd += sum;
      rawMap.set(key, prev);
    }

    // =========================================================
    // 2) SHIPPING: ✅ invoice_date 기준
    //    ✅ 브랜드 매핑: invoice_lines → po_lines → po_headers(brand)
    // =========================================================
    let iq = supabase
      .from("invoice_headers")
      .select(`*`)
      .not("invoice_date", "is", null);

    if (start) iq = iq.gte("invoice_date", start);
    if (end) iq = iq.lte("invoice_date", end);
    if (buyerIds?.length) iq = iq.in("buyer_id", buyerIds);

    const { data: invRows, error: ie } = await iq;
    if (ie) throw ie;

    const invoiceIds = (invRows || []).map((x: any) => x?.id).filter(Boolean);

    if (invoiceIds.length) {
      // 2-1) invoice_lines: invoice_id, po_line_id, (가능하면 line amount)
      const { data: ilRows, error: ile } = await supabase
        .from("invoice_lines")
        .select(`invoice_id, po_line_id, *`)
        .in("invoice_id", invoiceIds);

      if (ile) throw ile;

      const poLineIds = Array.from(
        new Set((ilRows || []).map((x: any) => x?.po_line_id).filter(Boolean))
      );

      // 2-2) po_lines: id -> po_header_id
      const { data: polRows, error: pole } = await supabase
        .from("po_lines")
        .select(`id, po_header_id`)
        .in("id", poLineIds);

      if (pole) throw pole;

      const poLineToHeader = new Map<string, string>();
      for (const r of polRows || []) {
        if (r?.id && r?.po_header_id) poLineToHeader.set(r.id, r.po_header_id);
      }

      const poHeaderIds = Array.from(
        new Set((polRows || []).map((x: any) => x?.po_header_id).filter(Boolean))
      );

      // 2-3) po_headers: id -> brand (po 기준이 제일 정확)
      const { data: pohRows, error: pohe } = await supabase
        .from("po_headers")
        .select(`*`)
        .in("id", poHeaderIds);

      if (pohe) throw pohe;

      const poHeaderToBrand = new Map<string, string>();
      for (const h of pohRows || []) {
        if (!h?.id) continue;
        poHeaderToBrand.set(h.id, pickBrand(h));
      }

      // 2-4) invoice_id별 brand별 (라인금액 합/라인수) 집계
      const invBrandSum = new Map<string, Map<string, { amt: number; cnt: number }>>();

      for (const l of ilRows || []) {
        const invoiceId = l?.invoice_id;
        const poLineId = l?.po_line_id;
        if (!invoiceId || !poLineId) continue;

        const headerId = poLineToHeader.get(poLineId);
        if (!headerId) continue;

        const brand = poHeaderToBrand.get(headerId) || "—";
        const amt = getInvoiceLineUsdAmount(l);

        let bmap = invBrandSum.get(invoiceId);
        if (!bmap) {
          bmap = new Map();
          invBrandSum.set(invoiceId, bmap);
        }

        const prev = bmap.get(brand) || { amt: 0, cnt: 0 };
        prev.amt += amt;
        prev.cnt += 1;
        bmap.set(brand, prev);
      }

      // 2-5) invoice header total을 브랜드별로 배분하여 ship_usd에 누적
      for (const inv of invRows || []) {
        const idate = inv?.invoice_date;
        if (!idate) continue;

        const ms = monthStartFromDate(idate);
        const { year, month } = yearMonthFromMonthStart(ms);

        const buyerId = inv?.buyer_id ?? null;
        const buyerName = inv?.buyer_name ?? inv?.buyer_company_name ?? null;

        const invoiceTotal = getInvoiceUsdTotal(inv);

        const bmap = invBrandSum.get(inv?.id);

        // 매핑이 없으면 브랜드를 모르니 "—"로 누적
        if (!bmap || bmap.size === 0) {
          const brand = "—";
          if (brandNames?.length && !brandNames.includes(brand)) continue;

          const key = `${buyerId || "NULL"}__${buyerName || "UNKNOWN"}__${brand}__${ms}`;
          const prev =
            rawMap.get(key) ||
            ({
              buyer_id: buyerId,
              buyer_name: buyerName,
              brand_name: brand,
              month_start: ms,
              year,
              month,
              order_usd: 0,
              ship_usd: 0,
              order_yoy_pct: null,
              order_mom_pct: null,
              ship_yoy_pct: null,
              ship_mom_pct: null,
            } as RawRow);

          prev.ship_usd += invoiceTotal;
          rawMap.set(key, prev);
          continue;
        }

        const brands = Array.from(bmap.entries());
        const sumAmt = brands.reduce((s, [, v]) => s + (v.amt > 0 ? v.amt : 0), 0);
        const sumCnt = brands.reduce((s, [, v]) => s + v.cnt, 0);

        for (const [brand, v] of brands) {
          if (brandNames?.length && !brandNames.includes(brand)) continue;

          let alloc = 0;

          if (invoiceTotal > 0) {
            // 우선: 금액 비례, 없으면 라인수 비례
            if (sumAmt > 0) alloc = invoiceTotal * (v.amt / sumAmt);
            else if (sumCnt > 0) alloc = invoiceTotal * (v.cnt / sumCnt);
            else alloc = invoiceTotal;
          } else {
            // invoice header total이 0이면 라인금액 합으로
            alloc = v.amt;
          }

          const key = `${buyerId || "NULL"}__${buyerName || "UNKNOWN"}__${brand}__${ms}`;
          const prev =
            rawMap.get(key) ||
            ({
              buyer_id: buyerId,
              buyer_name: buyerName,
              brand_name: brand,
              month_start: ms,
              year,
              month,
              order_usd: 0,
              ship_usd: 0,
              order_yoy_pct: null,
              order_mom_pct: null,
              ship_yoy_pct: null,
              ship_mom_pct: null,
            } as RawRow);

          prev.ship_usd += alloc;
          rawMap.set(key, prev);
        }
      }
    } else {
      // invoice_lines가 없으면 기존처럼 invoice에 붙은 brand 후보로 "—"에 모일 수 있음
      for (const inv of invRows || []) {
        const idate = inv?.invoice_date;
        if (!idate) continue;

        const ms = monthStartFromDate(idate);
        const { year, month } = yearMonthFromMonthStart(ms);

        const buyerId = inv?.buyer_id ?? null;
        const buyerName = inv?.buyer_name ?? inv?.buyer_company_name ?? null;

        const brand = pickBrand(inv);
        if (brandNames?.length && !brandNames.includes(brand)) continue;

        const key = `${buyerId || "NULL"}__${buyerName || "UNKNOWN"}__${brand}__${ms}`;
        const prev =
          rawMap.get(key) ||
          ({
            buyer_id: buyerId,
            buyer_name: buyerName,
            brand_name: brand,
            month_start: ms,
            year,
            month,
            order_usd: 0,
            ship_usd: 0,
            order_yoy_pct: null,
            order_mom_pct: null,
            ship_yoy_pct: null,
            ship_mom_pct: null,
          } as RawRow);

        prev.ship_usd += getInvoiceUsdTotal(inv);
        rawMap.set(key, prev);
      }
    }

    // =========================================================
    // C) monthly_raw / yearly_raw 생성 + YoY/MoM 계산
    // =========================================================
    const monthly_raw: RawRow[] = Array.from(rawMap.values()).sort((a, b) =>
      String(a.month_start).localeCompare(String(b.month_start))
    );

    // Raw YoY/MoM (buyer+brand grain)
    const rawBuckets = new Map<string, RawRow[]>();
    for (const r of monthly_raw) {
      const id = `${r.buyer_id || "NULL"}__${r.brand_name || "—"}`;
      const list = rawBuckets.get(id) || [];
      list.push(r);
      rawBuckets.set(id, list);
    }

    for (const list of rawBuckets.values()) {
      list.sort((a, b) => String(a.month_start).localeCompare(String(b.month_start)));
      const byMonth = new Map<string, RawRow>();
      for (const r of list) byMonth.set(r.month_start, r);

      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        const prev = i > 0 ? list[i - 1] : null;

        const dt = new Date(r.month_start + "T00:00:00Z");
        const dtY = new Date(Date.UTC(dt.getUTCFullYear() - 1, dt.getUTCMonth(), 1));
        const keyY = dtY.toISOString().slice(0, 10);
        const lastYear = byMonth.get(keyY) || null;

        r.order_mom_pct = pct(r.order_usd, prev ? prev.order_usd : null);
        r.ship_mom_pct = pct(r.ship_usd, prev ? prev.ship_usd : null);

        r.order_yoy_pct = pct(r.order_usd, lastYear ? lastYear.order_usd : null);
        r.ship_yoy_pct = pct(r.ship_usd, lastYear ? lastYear.ship_usd : null);
      }
    }

    // Yearly raw
    type YearRaw = {
      buyer_id: string | null;
      buyer_name: string | null;
      brand_name: string | null;
      year: number;
      order_usd: number;
      ship_usd: number;
      order_yoy_pct: number | null;
      ship_yoy_pct: number | null;
    };

    const yearlyMap = new Map<string, YearRaw>();

    for (const r of monthly_raw) {
      const key = `${r.buyer_id || "NULL"}__${r.buyer_name || "UNKNOWN"}__${r.brand_name || "—"}__${r.year}`;
      const prev =
        yearlyMap.get(key) ||
        ({
          buyer_id: r.buyer_id,
          buyer_name: r.buyer_name,
          brand_name: r.brand_name,
          year: r.year,
          order_usd: 0,
          ship_usd: 0,
          order_yoy_pct: null,
          ship_yoy_pct: null,
        } as YearRaw);

      prev.order_usd += toNum(r.order_usd);
      prev.ship_usd += toNum(r.ship_usd);
      yearlyMap.set(key, prev);
    }

    const yearly_raw: YearRaw[] = Array.from(yearlyMap.values()).sort((a, b) => a.year - b.year);

    // Yearly YoY
    const yearBuckets = new Map<string, YearRaw[]>();
    for (const r of yearly_raw) {
      const id = `${r.buyer_id || "NULL"}__${r.brand_name || "—"}`;
      const list = yearBuckets.get(id) || [];
      list.push(r);
      yearBuckets.set(id, list);
    }

    for (const list of yearBuckets.values()) {
      list.sort((a, b) => a.year - b.year);
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        const prev = i > 0 ? list[i - 1] : null;
        r.order_yoy_pct = pct(r.order_usd, prev ? prev.order_usd : null);
        r.ship_yoy_pct = pct(r.ship_usd, prev ? prev.ship_usd : null);
      }
    }

    // =========================================================
    // D) Dimension aggregation (buyer/brand 탭 공통)
    // =========================================================
    const dimMonthlyMap = new Map<string, any>();

    for (const r of monthly_raw) {
      const key =
        dimension === "buyer"
          ? `${r.buyer_id || "NULL"}__${r.month_start}`
          : `${r.brand_name || "—"}__${r.month_start}`;

      const prev = dimMonthlyMap.get(key) || {
        dimension,
        buyer_id: dimension === "buyer" ? r.buyer_id : null,
        buyer_name: dimension === "buyer" ? r.buyer_name : null,
        brand_name: dimension === "brand" ? r.brand_name : "ALL",
        month_start: r.month_start,
        year: r.year,
        month: r.month,
        order_usd: 0,
        ship_usd: 0,
        order_yoy_pct: null,
        order_mom_pct: null,
        ship_yoy_pct: null,
        ship_mom_pct: null,
      };

      prev.order_usd += Number(r.order_usd || 0);
      prev.ship_usd += Number(r.ship_usd || 0);
      dimMonthlyMap.set(key, prev);
    }

    const monthly = Array.from(dimMonthlyMap.values()).sort((a, b) =>
      String(a.month_start).localeCompare(String(b.month_start))
    );

    // recompute YoY/MoM on aggregated monthly
    const mb = new Map<string, any[]>();
    for (const r of monthly) {
      const id = dimension === "buyer" ? (r.buyer_id || "NULL") : (r.brand_name || "—");
      const list = mb.get(id) || [];
      list.push(r);
      mb.set(id, list);
    }

    for (const list of mb.values()) {
      list.sort((a, b) => String(a.month_start).localeCompare(String(b.month_start)));
      const byMonth = new Map<string, any>();
      for (const r of list) byMonth.set(r.month_start, r);

      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        const prev = i > 0 ? list[i - 1] : null;

        const dt = new Date(r.month_start + "T00:00:00Z");
        const dtY = new Date(Date.UTC(dt.getUTCFullYear() - 1, dt.getUTCMonth(), 1));
        const keyY = dtY.toISOString().slice(0, 10);
        const lastYear = byMonth.get(keyY) || null;

        r.order_mom_pct = pct(r.order_usd, prev ? prev.order_usd : null);
        r.ship_mom_pct = pct(r.ship_usd, prev ? prev.ship_usd : null);

        r.order_yoy_pct = pct(r.order_usd, lastYear ? lastYear.order_usd : null);
        r.ship_yoy_pct = pct(r.ship_usd, lastYear ? lastYear.ship_usd : null);
      }
    }

    // Yearly dimension aggregation
    const dimYearlyMap = new Map<string, any>();

    for (const r of yearly_raw) {
      const key =
        dimension === "buyer"
          ? `${r.buyer_id || "NULL"}__${r.year}`
          : `${r.brand_name || "—"}__${r.year}`;

      const prev = dimYearlyMap.get(key) || {
        dimension,
        buyer_id: dimension === "buyer" ? r.buyer_id : null,
        buyer_name: dimension === "buyer" ? r.buyer_name : null,
        brand_name: dimension === "brand" ? r.brand_name : "ALL",
        year: r.year,
        order_usd: 0,
        ship_usd: 0,
        order_yoy_pct: null,
        ship_yoy_pct: null,
      };

      prev.order_usd += Number(r.order_usd || 0);
      prev.ship_usd += Number(r.ship_usd || 0);
      dimYearlyMap.set(key, prev);
    }

    const yearly = Array.from(dimYearlyMap.values()).sort((a, b) => a.year - b.year);

    // yearly YoY
    const yb = new Map<string, any[]>();
    for (const r of yearly) {
      const id = dimension === "buyer" ? (r.buyer_id || "NULL") : (r.brand_name || "—");
      const list = yb.get(id) || [];
      list.push(r);
      yb.set(id, list);
    }

    for (const list of yb.values()) {
      list.sort((a, b) => a.year - b.year);
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        const prev = i > 0 ? list[i - 1] : null;
        r.order_yoy_pct = pct(r.order_usd, prev ? prev.order_usd : null);
        r.ship_yoy_pct = pct(r.ship_usd, prev ? prev.ship_usd : null);
      }
    }

    return NextResponse.json({
      ok: true,
      filters_echo: {
        dimension,
        start,
        end,
        buyer_ids: buyerIds?.length ? buyerIds : "ALL",
        brand_names: brandNames?.length ? brandNames : "ALL",
      },
      monthly_raw,
      yearly_raw,
      monthly,
      yearly,
    });
  } catch (e: any) {
    console.error("[dashboards/performance] error:", e);
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
