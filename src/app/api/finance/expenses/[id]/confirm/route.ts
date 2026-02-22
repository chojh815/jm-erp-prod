import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function toNumber(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function monthRange(postingMonthISO: string) {
  const d = new Date(postingMonthISO + "T00:00:00Z");
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const s = start.toISOString().slice(0, 10);
  const e = new Date(end.getTime() - 86400000).toISOString().slice(0, 10);
  return { start: s, end: e };
}

async function getRevenueByPoLineId(monthStartISO: string) {
  const { start, end } = monthRange(monthStartISO);

  // invoice_lines schema in your DB: invoice_header_id, po_line_id, amount
  const { data, error } = await supabaseAdmin
    .from("invoice_lines")
    .select("po_line_id, amount, invoice_headers!inner(invoice_date)")
    .eq("is_deleted", false)
    .gte("invoice_headers.invoice_date", start)
    .lte("invoice_headers.invoice_date", end);

  if (error) throw error;

  const map = new Map<string, number>();
  for (const r of data || []) {
    const id = r.po_line_id as string | null;
    if (!id) continue;
    const amt = toNumber((r as any).amount);
    map.set(id, (map.get(id) || 0) + amt);
  }
  return map;
}

async function getPoHeader(po_header_id: string) {
  const { data, error } = await supabaseAdmin.from("po_headers").select("*").eq("id", po_header_id).single();
  if (error) throw error;
  return data as any;
}

async function getPoLinesByHeader(po_header_id: string) {
  const { data, error } = await supabaseAdmin
    .from("po_lines")
    .select("*")
    .eq("po_header_id", po_header_id)
    .eq("is_deleted", false);

  if (error) throw error;
  return (data || []) as any[];
}

async function getShipmentLines(shipment_id: string) {
  const { data, error } = await supabaseAdmin
    .from("shipment_lines")
    .select("*")
    .eq("shipment_id", shipment_id)
    .eq("is_deleted", false);

  if (error) throw error;
  return (data || []) as any[];
}

function calcTotalUsd(currency: string, amountOriginal: number, fx: number) {
  if (!currency || currency.toUpperCase() === "USD") return amountOriginal;
  // fx_rate_to_usd = (original currency per 1 USD) => USD = original / fx
  return fx > 0 ? amountOriginal / fx : 0;
}

type ResultRow = {
  expense_id: string;
  posting_month: string;
  po_header_id: string | null;
  po_line_id: string | null;
  shipment_id: string | null;
  buyer_id: string | null;
  brand_name: string | null;
  vendor_id: string | null;
  site_id: string | null;
  allocated_usd: number;
  allocated_basis: string;
  basis_value: number | null;
};

function buildRow(base: Partial<ResultRow>): ResultRow {
  return {
    expense_id: base.expense_id!,
    posting_month: base.posting_month!,
    po_header_id: base.po_header_id ?? null,
    po_line_id: base.po_line_id ?? null,
    shipment_id: base.shipment_id ?? null,
    buyer_id: base.buyer_id ?? null,
    brand_name: base.brand_name ?? null,
    vendor_id: base.vendor_id ?? null,
    site_id: base.site_id ?? null,
    allocated_usd: Math.round(toNumber(base.allocated_usd) * 100) / 100,
    allocated_basis: base.allocated_basis || "MANUAL",
    basis_value: base.basis_value ?? null,
  };
}

async function softDeleteResults(expense_id: string) {
  await supabaseAdmin.from("expense_allocation_results").update({ is_deleted: true }).eq("expense_id", expense_id);
}

export async function POST(_req: NextRequest, { params }: any) {
  const id = params.id as string;

  try {
    const { data: header, error: hErr } = await supabaseAdmin
      .from("expense_headers")
      .select("*")
      .eq("id", id)
      .eq("is_deleted", false)
      .single();

    if (hErr) return NextResponse.json({ ok: false, error: hErr.message }, { status: 500 });

    if (header.status === "CONFIRMED") {
      return NextResponse.json({ ok: false, error: "Already CONFIRMED" }, { status: 409 });
    }

    const { data: allocations, error: aErr } = await supabaseAdmin
      .from("expense_allocations")
      .select("*")
      .eq("expense_id", id)
      .eq("is_deleted", false);

    if (aErr) return NextResponse.json({ ok: false, error: aErr.message }, { status: 500 });

    const amountOriginal = toNumber(header.total_amount_original);
    const fx = toNumber(header.fx_rate_to_usd || 1);
    const totalUsd = calcTotalUsd(header.currency, amountOriginal, fx);

    // update header totals + status
    const { error: uErr } = await supabaseAdmin
      .from("expense_headers")
      .update({ total_amount_usd: totalUsd, status: "CONFIRMED" })
      .eq("id", id);
    if (uErr) return NextResponse.json({ ok: false, error: uErr.message }, { status: 500 });

    await softDeleteResults(id);

    const postingMonth = (header.posting_month as string) || (header.expense_date as string);
    const revMap = await getRevenueByPoLineId(postingMonth);

    const scope = (header.scope_type || "PO") as string;
    const method = (header.allocation_method || "BY_REVENUE") as string;

    const rows: ResultRow[] = [];

    const headerVendor = header.vendor_id ?? null;

    const addRowsForPo = async (po_header_id: string | null, usdAmount: number, shipment_id: string | null, basisOverride?: string) => {
      if (!po_header_id) return;
      const ph = await getPoHeader(po_header_id);
      const buyer_id = ph.buyer_id ?? null;
      const brand_name = ph.buyer_brand_name ?? null;
      const site_id =
        ph.site_id ??
        ph.company_site_id ??
        ph.shipping_origin_site_id ??
        ph.shipping_site_id ??
        null;

      const poLines = await getPoLinesByHeader(po_header_id);
      const lineIds = poLines.map((l) => l.id).filter(Boolean);

      const weights: { id: string; w: number }[] = [];
      let totalW = 0;

      for (const lid of lineIds) {
        let w = 0;
        if ((basisOverride || method) === "BY_REVENUE") {
          w = revMap.get(lid) || 0;
        } else if ((basisOverride || method) === "BY_QTY") {
          const line = poLines.find((x) => x.id === lid);
          w = toNumber(line?.qty);
        } else {
          // fallback to revenue
          w = revMap.get(lid) || 0;
        }
        weights.push({ id: lid, w });
        totalW += w;
      }

      if (totalW <= 0) {
        // fallback equal
        const n = Math.max(lineIds.length, 1);
        for (const lid of lineIds.length ? lineIds : [null]) {
          const alloc = usdAmount / n;
          if (!lid) {
            rows.push(
              buildRow({
                expense_id: id,
                posting_month: postingMonth,
                po_header_id,
                po_line_id: null,
                shipment_id,
                buyer_id,
                brand_name,
                vendor_id: headerVendor,
                site_id,
                allocated_usd: alloc,
                allocated_basis: "MANUAL",
                basis_value: null,
              })
            );
          } else {
            rows.push(
              buildRow({
                expense_id: id,
                posting_month: postingMonth,
                po_header_id,
                po_line_id: lid,
                shipment_id,
                buyer_id,
                brand_name,
                vendor_id: headerVendor,
                site_id,
                allocated_usd: alloc,
                allocated_basis: "MANUAL",
                basis_value: null,
              })
            );
          }
        }
        return;
      }

      const basis = basisOverride || method;
      for (const { id: lid, w } of weights) {
        const alloc = usdAmount * (w / totalW);
        rows.push(
          buildRow({
            expense_id: id,
            posting_month: postingMonth,
            po_header_id,
            po_line_id: lid,
            shipment_id,
            buyer_id,
            brand_name,
            vendor_id: headerVendor,
            site_id,
            allocated_usd: alloc,
            allocated_basis: basis === "BY_REVENUE" ? "REVENUE" : basis === "BY_QTY" ? "QTY" : "REVENUE",
            basis_value: w,
          })
        );
      }
    };

    if (scope === "GENERAL") {
      rows.push(
        buildRow({
          expense_id: id,
          posting_month: postingMonth,
          po_header_id: null,
          po_line_id: null,
          shipment_id: null,
          buyer_id: null,
          brand_name: null,
          vendor_id: headerVendor,
          site_id: null,
          allocated_usd: totalUsd,
          allocated_basis: "MANUAL",
          basis_value: null,
        })
      );
    } else if (scope === "LINE") {
      // direct to po_line_id(s)
      const targets = allocations || [];
      if (!targets.length) {
        return NextResponse.json({ ok: false, error: "LINE scope requires allocations with po_line_id" }, { status: 400 });
      }
      const sumManual = targets.reduce((s: number, a: any) => s + toNumber(a.amount_usd || 0), 0);
      for (const a of targets) {
        const po_line_id = a.po_line_id as string | null;
        const po_header_id = a.po_header_id as string | null;
        const usd = toNumber(a.amount_usd) > 0 ? toNumber(a.amount_usd) : sumManual > 0 ? 0 : totalUsd / targets.length;
        // best-effort dimension enrichment
        let buyer_id: string | null = null;
        let brand_name: string | null = null;
        let site_id: string | null = null;
        if (po_header_id) {
          const ph = await getPoHeader(po_header_id);
          buyer_id = ph.buyer_id ?? null;
          brand_name = ph.buyer_brand_name ?? null;
          site_id = ph.site_id ?? ph.company_site_id ?? ph.shipping_origin_site_id ?? null;
        }
        rows.push(
          buildRow({
            expense_id: id,
            posting_month: postingMonth,
            po_header_id,
            po_line_id,
            shipment_id: null,
            buyer_id,
            brand_name,
            vendor_id: headerVendor,
            site_id,
            allocated_usd: usd,
            allocated_basis: "MANUAL",
            basis_value: null,
          })
        );
      }
    } else if (scope === "SHIPMENT") {
      const shipId = allocations?.[0]?.shipment_id as string | undefined;
      if (!shipId) {
        return NextResponse.json({ ok: false, error: "SHIPMENT scope requires allocation with shipment_id" }, { status: 400 });
      }
      const lines = await getShipmentLines(shipId);
      const items = lines
        .map((l) => ({
          po_line_id: l.po_line_id as string | null,
          po_header_id: l.po_header_id as string | null,
          cbm: toNumber(l.cbm),
          gw: toNumber(l.gw),
        }))
        .filter((x) => !!x.po_line_id);

      const totalCbm = items.reduce((s, x) => s + x.cbm, 0);
      const totalGw = items.reduce((s, x) => s + x.gw, 0);

      let basis = method;
      if (basis === "BY_CBM" && totalCbm <= 0) basis = totalGw > 0 ? "BY_GW" : "BY_REVENUE";
      if (basis === "BY_GW" && totalGw <= 0) basis = "BY_REVENUE";

      // group by po_header_id to allocate within each PO by line-level basis (cbm/gw) then by PO-level sums
      const byPo: Record<string, any[]> = {};
      for (const it of items) {
        const key = it.po_header_id || "UNKNOWN";
        byPo[key] = byPo[key] || [];
        byPo[key].push(it);
      }

      const allLineBasis = (it: any) => {
        if (basis === "BY_CBM") return it.cbm;
        if (basis === "BY_GW") return it.gw;
        return revMap.get(it.po_line_id) || 0;
      };
      const totalBasis = items.reduce((s, it) => s + allLineBasis(it), 0);

      if (totalBasis <= 0) {
        // equal split across lines
        const n = Math.max(items.length, 1);
        for (const it of items) {
          await addRowsForPo(it.po_header_id ?? null, totalUsd / n, shipId, "BY_REVENUE"); // within PO
        }
      } else {
        for (const it of items) {
          const share = allLineBasis(it) / totalBasis;
          const usd = totalUsd * share;
          // allocate to this po_line directly (shipment line already line-level)
          const po_header_id = it.po_header_id;
          if (po_header_id) {
            const ph = await getPoHeader(po_header_id);
            rows.push(
              buildRow({
                expense_id: id,
                posting_month: postingMonth,
                po_header_id,
                po_line_id: it.po_line_id,
                shipment_id: shipId,
                buyer_id: ph.buyer_id ?? null,
                brand_name: ph.buyer_brand_name ?? null,
                vendor_id: headerVendor,
                site_id: ph.site_id ?? ph.company_site_id ?? ph.shipping_origin_site_id ?? null,
                allocated_usd: usd,
                allocated_basis: basis === "BY_CBM" ? "CBM" : basis === "BY_GW" ? "GW" : "REVENUE",
                basis_value: allLineBasis(it),
              })
            );
          }
        }
      }
    } else if (scope === "FACTORY") {
      // allocate across all po_lines that have revenue in that month
      const entries = Array.from(revMap.entries()).filter(([, v]) => v > 0);
      const totalRev = entries.reduce((s, [, v]) => s + v, 0);

      if (totalRev <= 0) {
        return NextResponse.json({ ok: false, error: "FACTORY allocation requires some revenue in posting_month (invoice data is 0)." }, { status: 400 });
      }

      // Need po_header_id/buyer for each line: fetch po_lines by ids in batches
      const lineIds = entries.map(([id]) => id);
      const chunk = (arr: string[], size: number) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));
      const poLineMap = new Map<string, any>();
      for (const part of chunk(lineIds, 200)) {
        const { data: pls, error } = await supabaseAdmin.from("po_lines").select("*").in("id", part);
        if (error) throw error;
        for (const l of pls || []) poLineMap.set(l.id, l);
      }

      // also need po_headers for dimensions
      const poHeaderIds = Array.from(new Set(Array.from(poLineMap.values()).map((l) => l.po_header_id).filter(Boolean)));
      const poHeaderMap = new Map<string, any>();
      for (const part of chunk(poHeaderIds, 200)) {
        const { data: phs, error } = await supabaseAdmin.from("po_headers").select("*").in("id", part);
        if (error) throw error;
        for (const h of phs || []) poHeaderMap.set(h.id, h);
      }

      for (const [lid, rev] of entries) {
        const share = rev / totalRev;
        const usd = totalUsd * share;
        const pl = poLineMap.get(lid);
        const ph = pl ? poHeaderMap.get(pl.po_header_id) : null;
        rows.push(
          buildRow({
            expense_id: id,
            posting_month: postingMonth,
            po_header_id: pl?.po_header_id ?? null,
            po_line_id: lid,
            shipment_id: null,
            buyer_id: ph?.buyer_id ?? null,
            brand_name: ph?.buyer_brand_name ?? null,
            vendor_id: headerVendor,
            site_id: ph?.site_id ?? ph?.company_site_id ?? ph?.shipping_origin_site_id ?? null,
            allocated_usd: usd,
            allocated_basis: "REVENUE",
            basis_value: rev,
          })
        );
      }
    } else if (scope === "MULTI") {
      const targets = (allocations || []).filter((a: any) => !!a.po_header_id);
      if (!targets.length) {
        return NextResponse.json({ ok: false, error: "MULTI scope requires allocations with po_header_id and share_pct" }, { status: 400 });
      }
      for (const a of targets) {
        const po_header_id = a.po_header_id as string;
        const pct = toNumber(a.share_pct);
        const usd = totalUsd * (pct > 0 ? pct : 0);
        await addRowsForPo(po_header_id, usd, null, method);
      }
    } else {
      // PO (default)
      const poId = allocations?.[0]?.po_header_id as string | undefined;
      if (!poId) {
        return NextResponse.json({ ok: false, error: "PO scope requires allocation with po_header_id" }, { status: 400 });
      }
      await addRowsForPo(poId, totalUsd, null, method);
    }

    if (rows.length) {
      const { error: insErr } = await supabaseAdmin.from("expense_allocation_results").insert(rows);
      if (insErr) return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data: { total_usd: totalUsd, results_count: rows.length } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
