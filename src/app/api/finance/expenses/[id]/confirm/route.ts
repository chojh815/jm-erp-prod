import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function num(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function monthRange(postingMonthISO: string) {
  const d = new Date(postingMonthISO + "T00:00:00Z");
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return {
    start: start.toISOString().slice(0, 10),
    end: new Date(end.getTime() - 86400000).toISOString().slice(0, 10),
  };
}

function calcTotalUsd(currency: string, amountOriginal: number, fx: number) {
  if (!currency || currency.toUpperCase() === "USD") return amountOriginal;
  return fx > 0 ? amountOriginal / fx : 0;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function buildRow(base: any) {
  return {
    expense_id: base.expense_id,
    posting_month: base.posting_month,
    po_header_id: base.po_header_id ?? null,
    po_line_id: base.po_line_id ?? null,
    shipment_id: base.shipment_id ?? null,
    buyer_id: base.buyer_id ?? null,
    brand_name: base.brand_name ?? null,
    vendor_id: base.vendor_id ?? null,
    site_id: base.site_id ?? null,
    allocated_usd: round2(num(base.allocated_usd)),
    allocated_basis: base.allocated_basis || "MANUAL",
    basis_value: base.basis_value ?? null,
  };
}

async function softDeleteResults(expenseId: string) {
  const { error } = await supabaseAdmin
    .from("expense_allocation_results")
    .update({ is_deleted: true })
    .eq("expense_id", expenseId)
    .eq("is_deleted", false);
  if (error) throw error;
}

/**
 * IMPORTANT:
 * Some DBs have multiple relationships between invoice_lines and invoice_headers.
 * So do NOT use PostgREST embedded join like:
 *   invoice_headers!inner(invoice_date)
 * because it can throw:
 *   "Could not embed because more than one relationship was found ..."
 *
 * Instead:
 * 1) load invoice_lines only
 * 2) collect invoice_header_id values
 * 3) query invoice_headers separately
 * 4) filter by invoice_date in code
 */
async function getRevenueByPoLineId(postingMonthISO: string) {
  const { start, end } = monthRange(postingMonthISO);

  const { data: lines, error: lineErr } = await supabaseAdmin
    .from("invoice_lines")
    .select("po_line_id, amount, invoice_header_id")
    .eq("is_deleted", false);

  if (lineErr) throw lineErr;

  const headerIds = Array.from(
    new Set((lines || []).map((r: any) => r.invoice_header_id).filter(Boolean))
  );

  const headerDateMap = new Map<string, string>();
  if (headerIds.length) {
    const { data: headers, error: headerErr } = await supabaseAdmin
      .from("invoice_headers")
      .select("id, invoice_date")
      .in("id", headerIds)
      .gte("invoice_date", start)
      .lte("invoice_date", end);

    if (headerErr) throw headerErr;

    for (const h of headers || []) {
      if (h?.id && h?.invoice_date) {
        headerDateMap.set(String(h.id), String(h.invoice_date));
      }
    }
  }

  const map = new Map<string, number>();
  for (const r of lines || []) {
    const lineId = (r as any).po_line_id as string | null;
    const headerId = (r as any).invoice_header_id as string | null;
    if (!lineId || !headerId) continue;
    if (!headerDateMap.has(String(headerId))) continue;

    map.set(lineId, (map.get(lineId) || 0) + num((r as any).amount));
  }

  return map;
}

async function getPoHeader(poHeaderId: string) {
  const { data, error } = await supabaseAdmin
    .from("po_headers")
    .select("*")
    .eq("id", poHeaderId)
    .single();
  if (error) throw error;
  return data as any;
}

async function getPoLinesByHeader(poHeaderId: string) {
  const { data, error } = await supabaseAdmin
    .from("po_lines")
    .select("*")
    .eq("po_header_id", poHeaderId)
    .eq("is_deleted", false);
  if (error) throw error;
  return (data || []) as any[];
}

async function getShipmentLines(shipmentId: string) {
  const { data, error } = await supabaseAdmin
    .from("shipment_lines")
    .select("*")
    .eq("shipment_id", shipmentId)
    .eq("is_deleted", false);
  if (error) throw error;
  return (data || []) as any[];
}

function lineWeightsByRule(
  lines: any[],
  revenueMap: Map<string, number>,
  rule: "REVENUE" | "QTY" | "EQUAL"
) {
  if (rule === "REVENUE") {
    const arr = lines.map((l: any) => ({ id: l.id, w: revenueMap.get(l.id) || 0, line: l }));
    const sum = arr.reduce((s, x) => s + x.w, 0);
    if (sum > 0) return arr;
  }

  if (rule === "QTY") {
    const arr = lines.map((l: any) => ({ id: l.id, w: num(l.qty), line: l }));
    const sum = arr.reduce((s, x) => s + x.w, 0);
    if (sum > 0) return arr;
  }

  return lines.map((l: any) => ({ id: l.id, w: 1, line: l }));
}

async function addRowsForPo(args: {
  expenseId: string;
  postingMonth: string;
  poHeaderId: string;
  usdAmount: number;
  shipmentId: string | null;
  vendorId: string | null;
  revenueMap: Map<string, number>;
  outRows: any[];
}) {
  const ph = await getPoHeader(args.poHeaderId);
  const poLines = await getPoLinesByHeader(args.poHeaderId);

  if (!poLines.length) {
    args.outRows.push(
      buildRow({
        expense_id: args.expenseId,
        posting_month: args.postingMonth,
        po_header_id: args.poHeaderId,
        po_line_id: null,
        shipment_id: args.shipmentId,
        buyer_id: ph.buyer_id ?? null,
        brand_name: ph.buyer_brand_name ?? null,
        vendor_id: args.vendorId,
        site_id: ph.site_id ?? ph.company_site_id ?? ph.shipping_origin_site_id ?? ph.shipping_site_id ?? null,
        allocated_usd: args.usdAmount,
        allocated_basis: "MANUAL",
        basis_value: null,
      })
    );
    return;
  }

  const weights = lineWeightsByRule(poLines, args.revenueMap, "REVENUE");
  const totalW = weights.reduce((s, x) => s + num(x.w), 0) || 1;

  for (const item of weights) {
    args.outRows.push(
      buildRow({
        expense_id: args.expenseId,
        posting_month: args.postingMonth,
        po_header_id: args.poHeaderId,
        po_line_id: item.id,
        shipment_id: args.shipmentId,
        buyer_id: ph.buyer_id ?? null,
        brand_name: ph.buyer_brand_name ?? null,
        vendor_id: args.vendorId,
        site_id: ph.site_id ?? ph.company_site_id ?? ph.shipping_origin_site_id ?? ph.shipping_site_id ?? null,
        allocated_usd: args.usdAmount * (num(item.w) / totalW),
        allocated_basis: weights.every((w) => w.w === 1) ? "EQUAL" : "REVENUE",
        basis_value: item.w,
      })
    );
  }
}

export async function POST(_req: NextRequest, { params }: any) {
  const id = String(params.id || "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

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

    const totalUsd = calcTotalUsd(
      String(header.currency || "USD"),
      num(header.total_amount_original),
      num(header.fx_rate_to_usd || 1)
    );

    const postingMonth = String(header.posting_month || header.expense_date || "").slice(0, 7) + "-01";
    const revenueMap = await getRevenueByPoLineId(postingMonth);
    const rows: any[] = [];
    const vendorId = header.vendor_id ?? null;
    const scope = String(header.scope_type || "PO").toUpperCase();

    const { error: updErr } = await supabaseAdmin
      .from("expense_headers")
      .update({
        total_amount_usd: totalUsd,
        status: "CONFIRMED",
        allocation_method: header.allocation_method || "BY_REVENUE",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });

    await softDeleteResults(id);

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
          vendor_id: vendorId,
          site_id: null,
          allocated_usd: totalUsd,
          allocated_basis: "MANUAL",
          basis_value: null,
        })
      );
    } else if (scope === "LINE") {
      const targets = allocations || [];
      if (!targets.length) {
        return NextResponse.json({ ok: false, error: "LINE scope requires allocations with po_line_id" }, { status: 400 });
      }

      const sumManual = targets.reduce((s: number, a: any) => s + num(a.amount_usd || 0), 0);

      for (const a of targets) {
        let buyerId: string | null = null;
        let brandName: string | null = null;
        let siteId: string | null = a.site_id ?? null;

        if (a.po_header_id) {
          const ph = await getPoHeader(a.po_header_id);
          buyerId = ph.buyer_id ?? null;
          brandName = ph.buyer_brand_name ?? null;
          siteId = siteId || ph.site_id || ph.company_site_id || ph.shipping_origin_site_id || null;
        }

        rows.push(
          buildRow({
            expense_id: id,
            posting_month: postingMonth,
            po_header_id: a.po_header_id ?? null,
            po_line_id: a.po_line_id ?? null,
            shipment_id: null,
            buyer_id: buyerId,
            brand_name: brandName,
            vendor_id: vendorId,
            site_id: siteId,
            allocated_usd:
              num(a.amount_usd) > 0
                ? num(a.amount_usd)
                : sumManual > 0
                ? 0
                : totalUsd / Math.max(targets.length, 1),
            allocated_basis: "MANUAL",
            basis_value: null,
          })
        );
      }
    } else if (scope === "PO") {
      const poId = allocations?.[0]?.po_header_id as string | undefined;
      if (!poId) {
        return NextResponse.json({ ok: false, error: "PO scope requires allocation with po_header_id" }, { status: 400 });
      }

      await addRowsForPo({
        expenseId: id,
        postingMonth,
        poHeaderId: poId,
        usdAmount: totalUsd,
        shipmentId: null,
        vendorId,
        revenueMap,
        outRows: rows,
      });
    } else if (scope === "MULTI") {
      const targets = (allocations || []).filter((a: any) => !!a.po_header_id);
      if (!targets.length) {
        return NextResponse.json({ ok: false, error: "MULTI scope requires allocations with po_header_id" }, { status: 400 });
      }

      const sumShare = targets.reduce((s: number, a: any) => s + num(a.share_pct), 0);
      for (const a of targets) {
        const share = sumShare > 0 ? num(a.share_pct) / sumShare : 1 / targets.length;
        await addRowsForPo({
          expenseId: id,
          postingMonth,
          poHeaderId: String(a.po_header_id),
          usdAmount: totalUsd * share,
          shipmentId: null,
          vendorId,
          revenueMap,
          outRows: rows,
        });
      }
    } else if (scope === "SHIPMENT") {
      const shipId = allocations?.[0]?.shipment_id as string | undefined;
      if (!shipId) {
        return NextResponse.json({ ok: false, error: "SHIPMENT scope requires allocation with shipment_id" }, { status: 400 });
      }

      const shipmentLines = await getShipmentLines(shipId);
      if (!shipmentLines.length) {
        return NextResponse.json({ ok: false, error: "No shipment lines found for shipment." }, { status: 400 });
      }

      const poGroups = new Map<string, { po_header_id: string; cbm: number; gw: number; revenue: number }>();

      for (const line of shipmentLines) {
        const poHeaderId = line.po_header_id ?? null;
        const poLineId = line.po_line_id ?? null;
        if (!poHeaderId) continue;

        const cur = poGroups.get(poHeaderId) || {
          po_header_id: poHeaderId,
          cbm: 0,
          gw: 0,
          revenue: 0,
        };

        cur.cbm += num(line.total_cbm || line.cbm || line.cbm_per_ctn);
        cur.gw += num(line.total_gw || line.gw || line.gw_per_ctn);
        cur.revenue += poLineId ? num(revenueMap.get(poLineId) || 0) : 0;

        poGroups.set(poHeaderId, cur);
      }

      const poItems = Array.from(poGroups.values());
      const totalCbm = poItems.reduce((s, x) => s + x.cbm, 0);
      const totalGw = poItems.reduce((s, x) => s + x.gw, 0);
      const totalRevenue = poItems.reduce((s, x) => s + x.revenue, 0);

      for (const po of poItems) {
        let ratio = 0;
        let basis = "EQUAL";
        let basisValue: number | null = null;

        if (totalCbm > 0) {
          ratio = po.cbm / totalCbm;
          basis = "CBM";
          basisValue = po.cbm;
        } else if (totalGw > 0) {
          ratio = po.gw / totalGw;
          basis = "GW";
          basisValue = po.gw;
        } else if (totalRevenue > 0) {
          ratio = po.revenue / totalRevenue;
          basis = "REVENUE";
          basisValue = po.revenue;
        } else {
          ratio = 1 / Math.max(poItems.length, 1);
          basis = "EQUAL";
          basisValue = 1;
        }

        await addRowsForPo({
          expenseId: id,
          postingMonth,
          poHeaderId: po.po_header_id,
          usdAmount: totalUsd * ratio,
          shipmentId: shipId,
          vendorId,
          revenueMap,
          outRows: rows,
        });

        for (const row of rows) {
          if (row.po_header_id === po.po_header_id && row.shipment_id === shipId) {
            row.allocated_basis = basis;
            row.basis_value = basisValue;
          }
        }
      }
    } else if (scope === "FACTORY") {
      const entries = Array.from(revenueMap.entries()).filter(([, v]) => v > 0);
      const totalRev = entries.reduce((s, [, v]) => s + v, 0);

      if (totalRev <= 0) {
        return NextResponse.json(
          { ok: false, error: "FACTORY allocation requires invoice revenue in posting_month." },
          { status: 400 }
        );
      }

      const lineIds = entries.map(([lid]) => lid);
      const { data: poLines, error: plErr } = await supabaseAdmin
        .from("po_lines")
        .select("id, po_header_id")
        .in("id", lineIds);

      if (plErr) throw plErr;

      const poHeaderIds = [...new Set((poLines || []).map((x: any) => x.po_header_id).filter(Boolean))];
      const { data: poHeaders, error: phErr } = await supabaseAdmin
        .from("po_headers")
        .select("*")
        .in("id", poHeaderIds);

      if (phErr) throw phErr;

      const plMap = new Map((poLines || []).map((x: any) => [x.id, x]));
      const phMap = new Map((poHeaders || []).map((x: any) => [x.id, x]));

      for (const [lineId, rev] of entries) {
        const pl: any = plMap.get(lineId);
        const ph: any = pl ? phMap.get(pl.po_header_id) : null;

        rows.push(
          buildRow({
            expense_id: id,
            posting_month: postingMonth,
            po_header_id: pl?.po_header_id ?? null,
            po_line_id: lineId,
            shipment_id: null,
            buyer_id: ph?.buyer_id ?? null,
            brand_name: ph?.buyer_brand_name ?? null,
            vendor_id: vendorId,
            site_id: ph?.site_id ?? ph?.company_site_id ?? ph?.shipping_origin_site_id ?? null,
            allocated_usd: totalUsd * (rev / totalRev),
            allocated_basis: "REVENUE",
            basis_value: rev,
          })
        );
      }
    } else {
      return NextResponse.json({ ok: false, error: `Unsupported scope: ${scope}` }, { status: 400 });
    }

    if (rows.length) {
      const now = new Date().toISOString();
      const insertRows = rows.map((r: any) => ({
        ...r,
        is_deleted: false,
        created_at: now,
      }));

      const { error: insErr } = await supabaseAdmin
        .from("expense_allocation_results")
        .insert(insertRows);

      if (insErr) {
        return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({
      ok: true,
      data: {
        total_usd: totalUsd,
        results_count: rows.length,
        allocation_method: header.allocation_method || "BY_REVENUE",
        posting_month: postingMonth,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
