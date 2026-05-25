// src/app/api/dashboards/orders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * Orders Dashboard API
 *
 * ✅ IMPORTANT (Alignment)
 * - Orders / In Production / Ready  : PO(Status) 기반 (po_headers + po_lines.amount)
 * - Shipped                         : Shipment → Invoice 기반 (Overview KPI와 동일 정의)
 *   = 선택 기간 내 Shipments(선적일 기준) 에 연결된 invoice_headers 합계
 *
 * Query
 *  - start=YYYY-MM-DD
 *  - end=YYYY-MM-DD
 *  - buyer_ids=ALL | csv( uuid list OR buyer_name list )
 *  - buyer= (legacy alias)
 *  - site_ids=ALL | csv( uuid list OR origin_code list )
 *  - site= (legacy alias)
 */

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s
  );
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function ym(d: string) {
  return (d || "").slice(0, 7);
}

function safeUpper(v: any) {
  return (v ?? "").toString().trim().toUpperCase();
}

function pickAmountUSD(r: any) {
  const cands = [
    "total_amount_usd",
    "total_usd",
    "grand_total_usd",
    "amount_usd",
    "total_amount",
    "total",
    "grand_total",
    "amount",
  ];
  for (const k of cands) {
    const n = Number(r?.[k]);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function pickLineQty(r: any) {
  const cands = ["qty", "quantity", "order_qty", "pcs"];
  for (const k of cands) {
    const n = Number(r?.[k]);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function pickLineAmount(r: any) {
  const amount = Number(r?.amount);
  if (Number.isFinite(amount)) return amount;
  const qty = pickLineQty(r);
  const unit = Number(r?.unit_price);
  if (Number.isFinite(qty) && Number.isFinite(unit)) return qty * unit;
  return 0;
}

function cleanItemText(v: any) {
  return (v ?? "").toString().trim();
}

function displayCategoryName(v: any) {
  const raw = cleanItemText(v);
  const key = raw.toUpperCase();
  const map: Record<string, string> = {
    A: "Anklet",
    B: "Bracelet",
    C: "Chain",
    E: "Earring",
    H: "Hair Pin",
    K: "Key Ring",
    N: "Necklace",
    O: "Other",
    P: "Pendant",
    R: "Ring",
    S: "Set",
  };
  return map[key] || raw || "Uncategorized";
}

function recencyScore(orderDate: string | null, end: string) {
  if (!orderDate) return 0;
  const last = new Date(`${orderDate.slice(0, 10)}T00:00:00`).getTime();
  const base = new Date(`${end}T00:00:00`).getTime();
  if (!Number.isFinite(last) || !Number.isFinite(base)) return 0;
  const days = Math.max(0, Math.floor((base - last) / 86400000));
  if (days <= 30) return 100;
  if (days <= 90) return 80;
  if (days <= 180) return 60;
  if (days <= 365) return 35;
  return 15;
}

function daysSince(orderDate: string | null, end: string) {
  if (!orderDate) return null;
  const last = new Date(`${orderDate.slice(0, 10)}T00:00:00`).getTime();
  const base = new Date(`${end}T00:00:00`).getTime();
  if (!Number.isFinite(last) || !Number.isFinite(base)) return null;
  return Math.max(0, Math.floor((base - last) / 86400000));
}

function normalizeScore(value: number, max: number) {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(100, (value / max) * 100);
}

async function detectDateColumn(
  supabase: any,
  table: string,
  candidates: string[]
): Promise<string | null> {
  for (const col of candidates) {
    const { error } = await supabase.from(table).select(col).limit(1);
    if (!error) return col;
    // If it's not a "column not found" error, stop early (permissions etc.)
    const msg = (error.message || "").toLowerCase();
    if (!msg.includes("column") && !msg.includes("does not exist")) return null;
  }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const start =
      searchParams.get("start") ??
      new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);

    const end = searchParams.get("end") ?? new Date().toISOString().slice(0, 10);
    const rawTopLimit = Number(searchParams.get("top_limit") ?? 10);
    const topLimit = [3, 5, 10, 20].includes(rawTopLimit) ? rawTopLimit : 10;

    // Buyer filters (buyer_ids preferred; buyer legacy alias)
    const buyerIdsRaw = (searchParams.get("buyer_ids") ?? "").trim();
    const buyerLegacyRaw = (searchParams.get("buyer") ?? "").trim();
    const buyerRaw =
      buyerIdsRaw && buyerIdsRaw.toUpperCase() !== "ALL" ? buyerIdsRaw : buyerLegacyRaw;

    const buyerList = buyerRaw
      ? buyerRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const buyerUuidList = buyerList.filter(isUuidLike);
    const buyerNameList = buyerList.filter((x) => !isUuidLike(x));

    // Site filters (site_ids preferred; site legacy alias)
    const siteIdsRaw = (searchParams.get("site_ids") ?? "").trim();
    const siteLegacyRaw = (searchParams.get("site") ?? "").trim();
    const siteRaw =
      siteIdsRaw && siteIdsRaw.toUpperCase() !== "ALL" ? siteIdsRaw : siteLegacyRaw;

    const siteList = siteRaw
      ? siteRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const siteUuidList = siteList.filter(isUuidLike);
    const siteCodeList = siteList.filter((x) => !isUuidLike(x));

    const supabase = createClient();

    /**
     * 1) Headers: 기간 + (soft delete 제외) + (buyer/site 필터)
     *    - po_headers: order_date, buyer_id/buyer_name, origin_id/origin_code, status, is_deleted
     */
    let headersQuery = supabase
      .from("po_headers")
      .select("id, po_no, buyer_id, buyer_name, order_date, status, origin_id, origin_code, is_deleted")
      .gte("order_date", start)
      .lte("order_date", end)
      .eq("is_deleted", false)
      .neq("status", "DELETED");

    if (buyerUuidList.length > 0) {
      headersQuery = headersQuery.in("buyer_id", buyerUuidList);
    } else if (buyerNameList.length > 0) {
      headersQuery = headersQuery.in("buyer_name", buyerNameList);
    }

    if (siteUuidList.length > 0) {
      headersQuery = headersQuery.in("origin_id", siteUuidList);
    } else if (siteCodeList.length > 0) {
      headersQuery = headersQuery.in("origin_code", siteCodeList);
    }

    const { data: headers, error: he } = await headersQuery;

    if (he) {
      return NextResponse.json({ ok: false, message: he.message }, { status: 500 });
    }

    const headerRows = (headers ?? []).filter((h: any) => {
      const st = safeUpper(h?.status || "");
      return st !== "DELETED" && st !== "CANCELLED" && st !== "CANCELED";
    });
    const headerIds = headerRows.map((h: any) => h.id);

    // Buyer list for UI (기간+필터 기준 header에서 추출)
    const buyers = uniq(
      headerRows
        .map((h: any) => (h.buyer_name ?? "").trim())
        .filter(Boolean)
    ).sort((a: string, b: string) => a.localeCompare(b));

    // If no headers, still compute shipped (shipment/invoice) because shipped can exist even if no PO orders in range?
    // But to keep existing behavior consistent, we'll return zeros if no headers AND no shipped.
    // We'll compute shipped independently below.

    /**
     * 2) Lines: po_lines에서 해당 headerIds 라인 금액(USD)을 집계 (amount)
     */
    let lineRows: {
      id: string;
      po_header_id: string;
      amount: number;
      qty: number;
      buyer_style_no: string | null;
      jm_style_no: string | null;
      description: string | null;
    }[] = [];
    if (headerIds.length > 0) {
      const { data: lines, error: le } = await supabase
        .from("po_lines")
        .select("id, po_header_id, qty, unit_price, amount, buyer_style_no, jm_style_no, description, is_deleted")
        .in("po_header_id", headerIds)
        .eq("is_deleted", false);

      if (le) {
        return NextResponse.json({ ok: false, message: le.message }, { status: 500 });
      }

      lineRows = (lines ?? []).map((r: any) => ({
        id: r.id,
        po_header_id: r.po_header_id,
        amount: pickLineAmount(r),
        qty: pickLineQty(r),
        buyer_style_no: cleanItemText(r.buyer_style_no) || null,
        jm_style_no: cleanItemText(r.jm_style_no) || null,
        description: cleanItemText(r.description) || null,
      }));
    }

    const headerById = new Map<string, any>();
    for (const h of headerRows) headerById.set(h.id, h);

    // ---- Aggregations (PO-based) ----
    let totalUSD = 0;

    const statusSum: Record<string, number> = {};
    const statusPoSet: Record<string, Set<string>> = {};

    const monthlySum: Record<string, number> = {};

    const buyerSum: Record<string, number> = {};
    const buyerPoSet: Record<string, Set<string>> = {};
    const itemMap = new Map<
      string,
      {
        buyer_style_no: string | null;
        jm_style_no: string | null;
        description: string | null;
        qty: number;
        amount_usd: number;
        order_count: number;
        buyer_count: number;
        poKeys: Set<string>;
        buyers: Set<string>;
      }
    >();

    const PRODUCTION_SET = new Set(["IN_PRODUCTION", "PRODUCTION"]);
    const READY_SET = new Set(["READY"]);

    let productionUSD = 0;
    let productionLineCount = 0;

    let readyUSD = 0;
    const readyPoIds = new Set<string>();

    for (const ln of lineRows) {
      const h = headerById.get(ln.po_header_id);
      if (!h) continue;

      const st = safeUpper(h.status || "UNKNOWN");
      const buyerName = (h.buyer_name ?? "UNKNOWN").toString().trim() || "UNKNOWN";
      const d = (h.order_date ?? end).toString();

      totalUSD += ln.amount;

      statusSum[st] = (statusSum[st] ?? 0) + ln.amount;
      statusPoSet[st] = statusPoSet[st] ?? new Set<string>();
      statusPoSet[st].add(h.id);

      const m = ym(d);
      monthlySum[m] = (monthlySum[m] ?? 0) + ln.amount;

      buyerSum[buyerName] = (buyerSum[buyerName] ?? 0) + ln.amount;
      buyerPoSet[buyerName] = buyerPoSet[buyerName] ?? new Set<string>();
      buyerPoSet[buyerName].add(h.id);

      const itemKeyParts = [
        ln.jm_style_no || "",
        ln.buyer_style_no || "",
        ln.description || "",
      ];
      const itemKey = itemKeyParts.join("__").trim() || ln.id;
      const item = itemMap.get(itemKey) || {
        buyer_style_no: ln.buyer_style_no,
        jm_style_no: ln.jm_style_no,
        description: ln.description,
        qty: 0,
        amount_usd: 0,
        order_count: 0,
        buyer_count: 0,
        poKeys: new Set<string>(),
        buyers: new Set<string>(),
      };
      item.qty += ln.qty;
      item.amount_usd += ln.amount;
      item.poKeys.add((h.po_no ?? h.id).toString());
      item.buyers.add(buyerName);
      item.order_count = item.poKeys.size;
      item.buyer_count = item.buyers.size;
      itemMap.set(itemKey, item);

      if (PRODUCTION_SET.has(st)) {
        productionUSD += ln.amount;
        productionLineCount += 1;
      }
      if (READY_SET.has(st)) {
        readyUSD += ln.amount;
        readyPoIds.add(h.id);
      }
    }

    // monthly rows with cumulative
    const months = Object.keys(monthlySum).sort((a, b) => a.localeCompare(b));
    let running = 0;
    const monthly = months.map((m) => {
      const amt = monthlySum[m] ?? 0;
      running += amt;
      return { month: m, amount_usd: amt, cumulative_usd: running };
    });

    // status rows
    const status = Object.entries(statusSum)
      .map(([status, amount]) => ({ status, amount_usd: amount }))
      .sort((a, b) => b.amount_usd - a.amount_usd);

    // buyer breakdown top 20
    const buyer_breakdown = Object.entries(buyerSum)
      .map(([buyer, amount]) => ({
        buyer,
        amount_usd: amount,
        pos: buyerPoSet[buyer]?.size ?? 0,
      }))
      .sort((a, b) => b.amount_usd - a.amount_usd)
      .slice(0, 20);

    const productRows = Array.from(itemMap.values()).map((r) => ({
      buyer_style_no: r.buyer_style_no,
      jm_style_no: r.jm_style_no,
      description: r.description,
      qty: r.qty,
      amount_usd: Number(r.amount_usd.toFixed(2)),
      order_count: r.order_count,
      buyer_count: r.buyer_count,
    }));

    const top_items_by_qty = [...productRows]
      .sort((a, b) => b.qty - a.qty || b.amount_usd - a.amount_usd)
      .slice(0, topLimit);

    const top_items_by_amount = [...productRows]
      .sort((a, b) => b.amount_usd - a.amount_usd || b.qty - a.qty)
      .slice(0, topLimit);

    const top_repeat_items = [...productRows]
      .sort((a, b) => b.order_count - a.order_count || b.amount_usd - a.amount_usd)
      .slice(0, topLimit);

    const styleNos = uniq(
      lineRows
        .map((ln) => cleanItemText(ln.jm_style_no))
        .filter(Boolean)
    );
    const devByStyle = new Map<string, { product_type: string | null; product_category: string | null }>();
    if (styleNos.length > 0) {
      const { data: devRows } = await supabase
        .from("product_development_headers")
        .select("style_no, product_type, product_category")
        .in("style_no", styleNos);

      (devRows ?? []).forEach((row: any) => {
        const style = cleanItemText(row.style_no);
        if (!style) return;
        devByStyle.set(style, {
          product_type: cleanItemText(row.product_type) || null,
          product_category: cleanItemText(row.product_category) || null,
        });
      });
    }

    type PreferenceBucket = {
      buyer_name: string;
      key: string;
      label: string;
      qty: number;
      amount_usd: number;
      repeat_orders: number;
      poKeys: Set<string>;
      last_order_date: string | null;
      score: number;
    };

    type PreferenceStyle = PreferenceBucket & {
      jm_style_no: string | null;
      buyer_style_no: string | null;
      description: string | null;
      product_type: string | null;
      product_category: string | null;
    };

    const typeMap = new Map<string, PreferenceBucket>();
    const categoryMap = new Map<string, PreferenceBucket>();
    const styleMap = new Map<string, PreferenceStyle>();

    for (const ln of lineRows) {
      const h = headerById.get(ln.po_header_id);
      if (!h) continue;

      const buyerName = (h.buyer_name ?? "UNKNOWN").toString().trim() || "UNKNOWN";
      const orderDate = (h.order_date ?? null)?.toString().slice(0, 10) || null;
      const poKey = (h.po_no ?? h.id).toString();
      const dev = ln.jm_style_no ? devByStyle.get(ln.jm_style_no) : undefined;
      const productType = dev?.product_type || "Uncategorized";
      const productCategory = displayCategoryName(dev?.product_category);

      const touchBucket = (map: Map<string, PreferenceBucket>, label: string) => {
        const key = `${buyerName}__${label}`;
        const current =
          map.get(key) ||
          {
            buyer_name: buyerName,
            key,
            label,
            qty: 0,
            amount_usd: 0,
            repeat_orders: 0,
            poKeys: new Set<string>(),
            last_order_date: null,
            score: 0,
          };
        current.qty += ln.qty;
        current.amount_usd += ln.amount;
        current.poKeys.add(poKey);
        current.repeat_orders = current.poKeys.size;
        if (!current.last_order_date || (orderDate && orderDate > current.last_order_date)) {
          current.last_order_date = orderDate;
        }
        map.set(key, current);
      };

      touchBucket(typeMap, productType);
      touchBucket(categoryMap, productCategory);

      const styleKey = `${buyerName}__${ln.jm_style_no || ""}__${ln.buyer_style_no || ""}__${ln.description || ""}`;
      const style =
        styleMap.get(styleKey) ||
        {
          buyer_name: buyerName,
          key: styleKey,
          label: [ln.jm_style_no, ln.buyer_style_no].filter(Boolean).join(" / ") || ln.description || "-",
          jm_style_no: ln.jm_style_no,
          buyer_style_no: ln.buyer_style_no,
          description: ln.description,
          product_type: productType,
          product_category: productCategory,
          qty: 0,
          amount_usd: 0,
          repeat_orders: 0,
          poKeys: new Set<string>(),
          last_order_date: null,
          score: 0,
        };
      style.qty += ln.qty;
      style.amount_usd += ln.amount;
      style.poKeys.add(poKey);
      style.repeat_orders = style.poKeys.size;
      if (!style.last_order_date || (orderDate && orderDate > style.last_order_date)) {
        style.last_order_date = orderDate;
      }
      styleMap.set(styleKey, style);
    }

    const scoreAndSort = <T extends PreferenceBucket>(rows: T[], weights: { qty: number; amount: number; repeat: number; recency: number }, limit?: number) => {
      const maxQty = Math.max(0, ...rows.map((r) => r.qty));
      const maxAmount = Math.max(0, ...rows.map((r) => r.amount_usd));
      const maxRepeat = Math.max(0, ...rows.map((r) => r.repeat_orders));
      const scored = rows
        .map((r) => ({
          ...r,
          amount_usd: Number(r.amount_usd.toFixed(2)),
          score: Number(
            (
              normalizeScore(r.qty, maxQty) * weights.qty +
              normalizeScore(r.amount_usd, maxAmount) * weights.amount +
              normalizeScore(r.repeat_orders, maxRepeat) * weights.repeat +
              recencyScore(r.last_order_date, end) * weights.recency
            ).toFixed(1)
          ),
        }))
        .sort((a, b) => b.score - a.score || b.repeat_orders - a.repeat_orders || b.amount_usd - a.amount_usd)
        .map(({ poKeys, ...rest }) => rest);
      return typeof limit === "number" ? scored.slice(0, limit) : scored;
    };

    const buyer_preferences = {
      product_types: scoreAndSort(Array.from(typeMap.values()), {
        qty: 0.25,
        amount: 0.25,
        repeat: 0.3,
        recency: 0.2,
      }, topLimit),
      categories: scoreAndSort(Array.from(categoryMap.values()), {
        qty: 0.25,
        amount: 0.25,
        repeat: 0.3,
        recency: 0.2,
      }, topLimit),
      styles: scoreAndSort(Array.from(styleMap.values()), {
        qty: 0.25,
        amount: 0.25,
        repeat: 0.35,
        recency: 0.15,
      }, topLimit),
    };

    const scoredStyles = scoreAndSort(Array.from(styleMap.values()), {
      qty: 0.25,
      amount: 0.25,
      repeat: 0.35,
      recency: 0.15,
    }) as Array<Omit<PreferenceStyle, "poKeys">>;

    const dropped_repeat_items = scoredStyles
      .map((row) => ({
        ...row,
        days_since_last_order: daysSince(row.last_order_date, end),
      }))
      .filter((row) => row.repeat_orders >= 2 && (row.days_since_last_order ?? 0) >= 90)
      .sort((a, b) =>
        b.repeat_orders - a.repeat_orders ||
        (b.days_since_last_order ?? 0) - (a.days_since_last_order ?? 0) ||
        b.amount_usd - a.amount_usd
      )
      .slice(0, topLimit);

    const categoryPreferenceByBuyer = new Map<string, Set<string>>();
    for (const row of buyer_preferences.categories) {
      if (!categoryPreferenceByBuyer.has(row.buyer_name)) {
        categoryPreferenceByBuyer.set(row.buyer_name, new Set<string>());
      }
      categoryPreferenceByBuyer.get(row.buyer_name)!.add(row.label);
    }

    const orderedStyleByBuyer = new Map<string, Set<string>>();
    for (const row of scoredStyles) {
      const key = row.jm_style_no || row.buyer_style_no || row.description || row.label;
      if (!orderedStyleByBuyer.has(row.buyer_name)) {
        orderedStyleByBuyer.set(row.buyer_name, new Set<string>());
      }
      orderedStyleByBuyer.get(row.buyer_name)!.add(key);
    }

    const suggestionRows: Array<
      Omit<PreferenceStyle, "poKeys"> & {
        target_buyer_name: string;
        source_buyer_name: string;
        reason: string;
        suggestion_score: number;
      }
    > = [];

    const buyerNamesForSuggestion = Array.from(categoryPreferenceByBuyer.keys());
    for (const targetBuyer of buyerNamesForSuggestion) {
      const preferredCategories = categoryPreferenceByBuyer.get(targetBuyer) || new Set<string>();
      const alreadyOrdered = orderedStyleByBuyer.get(targetBuyer) || new Set<string>();

      for (const sourceStyle of scoredStyles) {
        if (sourceStyle.buyer_name === targetBuyer) continue;
        if (!sourceStyle.product_category || !preferredCategories.has(sourceStyle.product_category)) continue;

        const styleKey = sourceStyle.jm_style_no || sourceStyle.buyer_style_no || sourceStyle.description || sourceStyle.label;
        if (alreadyOrdered.has(styleKey)) continue;

        const suggestionScore = Number(
          (
            sourceStyle.score * 0.55 +
            normalizeScore(sourceStyle.repeat_orders, Math.max(1, ...scoredStyles.map((r) => r.repeat_orders))) * 0.25 +
            recencyScore(sourceStyle.last_order_date, end) * 0.2
          ).toFixed(1)
        );

        suggestionRows.push({
          ...sourceStyle,
          target_buyer_name: targetBuyer,
          source_buyer_name: sourceStyle.buyer_name,
          reason: `${targetBuyer} prefers ${sourceStyle.product_category}; ${sourceStyle.buyer_name} repeated this style ${sourceStyle.repeat_orders}x`,
          suggestion_score: suggestionScore,
        });
      }
    }

    const next_suggestion_candidates = suggestionRows
      .sort((a, b) => b.suggestion_score - a.suggestion_score || b.repeat_orders - a.repeat_orders || b.amount_usd - a.amount_usd)
      .slice(0, topLimit);

        /**
     * 3) Shipped (Invoice Date 기준, Alignment with Performance/Home rule)
     *    - 선택 기간 내 invoice_headers (invoice_date 기준) 합계
     *    - Shipments count = 해당 invoices에서 shipment_id distinct 개수
     */
    let shippedUSD = 0;
    let shippedShipmentsCount = 0;
    let shippedMeta: {
      invoice_date_col: string | null;
      shipped_invoices: number;
      shipments: number;
    } = {
      invoice_date_col: null,
      shipped_invoices: 0,
      shipments: 0,
    };

    const invoiceDateCol = await detectDateColumn(supabase, "invoice_headers", [
      "invoice_date",
      "date",
      "created_at",
      "updated_at",
    ]);
    shippedMeta.invoice_date_col = invoiceDateCol;

    let invRowsForShip: any[] = [];
    if (invoiceDateCol) {
      let invQ = supabase
        .from("invoice_headers")
        .select("*")
        .gte(invoiceDateCol, start)
        .lte(invoiceDateCol, end);

      const { data: invD, error: invE } = await invQ;
      if (!invE) invRowsForShip = invD ?? [];
    }

    // soft-delete filter (best effort)
    invRowsForShip = invRowsForShip.filter(
      (r: any) => r?.is_deleted === undefined || r?.is_deleted === false
    );

    // buyer filter
    if (buyerUuidList.length > 0) {
      invRowsForShip = invRowsForShip.filter((r: any) =>
        buyerUuidList.includes((r?.buyer_id ?? "").toString())
      );
    } else if (buyerNameList.length > 0) {
      invRowsForShip = invRowsForShip.filter((r: any) =>
        buyerNameList.includes((r?.buyer_name ?? "").toString())
      );
    }

    // site filter (best effort: origin_id/origin_code/ship_from_site_id/ship_from_code)
    if (siteUuidList.length > 0) {
      invRowsForShip = invRowsForShip.filter((r: any) => {
        const sid = (r?.origin_id ?? r?.ship_from_site_id ?? r?.ship_from_id ?? "").toString();
        return siteUuidList.includes(sid);
      });
    } else if (siteCodeList.length > 0) {
      invRowsForShip = invRowsForShip.filter((r: any) => {
        const sc = (r?.origin_code ?? r?.ship_from_code ?? "").toString();
        return siteCodeList.includes(sc);
      });
    }

    shippedUSD = invRowsForShip.reduce((s: number, r: any) => s + pickAmountUSD(r), 0);
    shippedMeta.shipped_invoices = invRowsForShip.length;

    const shipmentIdsForShip = Array.from(
      new Set(invRowsForShip.map((r: any) => r?.shipment_id).filter(Boolean))
    );
    shippedShipmentsCount = shipmentIdsForShip.length;
    shippedMeta.shipments = shippedShipmentsCount;

    // KPI (delta_pct는 아직 null)
    const kpis = [
      {
        key: "orders",
        label: "Orders",
        value_usd: totalUSD,
        delta_pct: null,
        sub_label: "POs",
        sub_value: String(headerIds.length),
      },
      {
        key: "production",
        label: "In Production",
        value_usd: productionUSD,
        delta_pct: null,
        sub_label: "Lines",
        sub_value: String(productionLineCount),
      },
      {
        key: "ready",
        label: "Ready",
        value_usd: readyUSD,
        delta_pct: null,
        sub_label: "POs",
        sub_value: String(readyPoIds.size),
      },
      {
        key: "shipped",
        label: "Shipped",
        value_usd: shippedUSD,
        delta_pct: null,
        sub_label: "Shipments",
        sub_value: String(shippedShipmentsCount),
      },
    ];

    return NextResponse.json({
      ok: true,
      filters_echo: {
        start,
        end,
        buyer_ids:
          buyerIdsRaw?.toUpperCase() === "ALL"
            ? "ALL"
            : buyerIdsRaw || buyerLegacyRaw || "ALL",
        site_ids:
          siteIdsRaw?.toUpperCase() === "ALL"
            ? "ALL"
            : siteIdsRaw || siteLegacyRaw || "ALL",
        top_limit: topLimit,
      },
      meta: {
        date_col_used: "order_date",
        usd_line_col_used: "amount",
        rows_headers: headerRows.length,
        rows_lines: lineRows.length,
        shipped: shippedMeta,
        note: null,
      },
      buyers,
      kpis,
      monthly,
      status,
      buyer_breakdown,
      product_insights: {
        top_items_by_qty,
        top_items_by_amount,
        top_repeat_items,
      },
      buyer_preferences,
      opportunity_insights: {
        dropped_repeat_items,
        next_suggestion_candidates,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, message: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
