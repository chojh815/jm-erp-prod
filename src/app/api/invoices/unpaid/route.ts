import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isMissingColumn(error: any, column: string) {
  return String(error?.message || "").includes(column);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const buyer_id = searchParams.get("buyer_id");
    const vendor_id = (searchParams.get("vendor_id") || "").trim();
    const q = (searchParams.get("q") || "").trim().toLowerCase();
    if (!buyer_id) return NextResponse.json({ success: false, error: "buyer_id required" }, { status: 400 });

    const { data: invoices, error: invErr } = await supabaseAdmin
      .from("invoice_headers")
      .select("id, invoice_no, buyer_id, currency, total_amount, paid_amount, balance_amount, status, created_at, etd, eta, is_deleted")
      .eq("buyer_id", buyer_id)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false });

    if (invErr) throw invErr;

    const ids = (invoices || []).map((x) => x.id);
    if (ids.length === 0) return NextResponse.json({ success: true, rows: [] });

    const { data: invoiceLines, error: invLineErr } = await supabaseAdmin
      .from("invoice_lines")
      .select("invoice_id, invoice_header_id, po_no")
      .or(`invoice_id.in.(${ids.join(",")}),invoice_header_id.in.(${ids.join(",")})`);

    if (invLineErr) throw invLineErr;

    const poMap = new Map<string, string[]>();
    for (const line of invoiceLines || []) {
      const invoiceId = (line as any).invoice_id || (line as any).invoice_header_id;
      const poNo = String((line as any).po_no || "").trim();
      if (!invoiceId || !poNo) continue;
      const current = poMap.get(invoiceId) || [];
      if (!current.includes(poNo)) current.push(poNo);
      poMap.set(invoiceId, current);
    }

    let vendorPoSet: Set<string> | null = null;
    if (vendor_id) {
      let vendorWs: any[] | null = null;
      const direct = await supabaseAdmin
        .from("work_sheet_headers")
        .select("po_no")
        .eq("vendor_id", vendor_id)
        .eq("is_deleted", false);

      if (!direct.error) {
        vendorWs = direct.data || [];
      } else if (isMissingColumn(direct.error, "work_sheet_headers.vendor_id")) {
        const lineHit = await supabaseAdmin
          .from("work_sheet_lines")
          .select("work_sheet_id, vendor_id, is_deleted")
          .eq("vendor_id", vendor_id)
          .or("is_deleted.is.null,is_deleted.eq.false");

        if (lineHit.error) throw lineHit.error;

        const wsIds = Array.from(
          new Set((lineHit.data || []).map((row: any) => String(row.work_sheet_id || "").trim()).filter(Boolean))
        );

        if (wsIds.length > 0) {
          const wsHeaderRes = await supabaseAdmin
            .from("work_sheet_headers")
            .select("id, po_no, is_deleted")
            .in("id", wsIds)
            .eq("is_deleted", false);

          if (wsHeaderRes.error) throw wsHeaderRes.error;
          vendorWs = wsHeaderRes.data || [];
        } else {
          vendorWs = [];
        }
      } else {
        throw direct.error;
      }

      vendorPoSet = new Set((vendorWs || []).map((row: any) => String(row.po_no || "").trim()).filter(Boolean));
    }

    const { data: lines, error: lErr } = await supabaseAdmin
      .from("receipt_lines")
      .select("receipt_header_id, invoice_id, applied_amount, writeoff_amount, is_deleted")
      .in("invoice_id", ids)
      .eq("is_deleted", false);

    if (lErr) throw lErr;

    const applied = new Map<string, number>();
    const settledExtra = new Map<string, number>();
    for (const l of lines || []) {
      const invoiceId = String((l as any).invoice_id || "").trim();
      if (!invoiceId) continue;
      applied.set(invoiceId, (applied.get(invoiceId) || 0) + toNum((l as any).applied_amount));
      settledExtra.set(invoiceId, (settledExtra.get(invoiceId) || 0) + toNum((l as any).writeoff_amount));
    }

    const receiptHeaderIds = Array.from(
      new Set((lines || []).map((l: any) => String(l.receipt_header_id || "").trim()).filter(Boolean))
    );

    const { data: receiptHeaders, error: hdrErr } = receiptHeaderIds.length
      ? await supabaseAdmin
          .from("receipt_headers")
          .select("id, bank_fee_amount, buyer_bank_fee_amount, buyer_wire_fee_writeoff_amount, claim_deduction_amount, is_deleted")
          .in("id", receiptHeaderIds)
          .eq("is_deleted", false)
      : { data: [], error: null as any };

    if (hdrErr) throw hdrErr;

    const headerById = new Map<string, any>((receiptHeaders || []).map((h: any) => [String(h.id), h]));
    const linesByHeader = new Map<string, any[]>();
    for (const line of lines || []) {
      const hid = String((line as any).receipt_header_id || "").trim();
      if (!hid) continue;
      const arr = linesByHeader.get(hid) || [];
      arr.push(line);
      linesByHeader.set(hid, arr);
    }

    for (const [headerId, rows] of linesByHeader.entries()) {
      const header = headerById.get(headerId);
      if (!header) continue;
      const totalAppliedForHeader = rows.reduce((sum, row) => sum + toNum((row as any).applied_amount), 0);
      if (totalAppliedForHeader <= 0) continue;
      for (const row of rows) {
        const appliedAmt = toNum((row as any).applied_amount);
        if (appliedAmt <= 0) continue;
        const ratio = appliedAmt / totalAppliedForHeader;
        const extra =
          ratio * toNum(header?.bank_fee_amount) +
          ratio * (toNum(header?.buyer_bank_fee_amount) + toNum(header?.buyer_wire_fee_writeoff_amount)) +
          ratio * toNum(header?.claim_deduction_amount);
        if (extra <= 0) continue;
        const invoiceId = String((row as any).invoice_id || "").trim();
        if (!invoiceId) continue;
        settledExtra.set(invoiceId, (settledExtra.get(invoiceId) || 0) + extra);
      }
    }

    const rows = (invoices || []).map((inv: any) => {
      const explicitPaidRaw = inv?.paid_amount;
      const explicitBalanceRaw = inv?.balance_amount;
      const explicitPaidExists =
        explicitPaidRaw !== null && explicitPaidRaw !== undefined && explicitPaidRaw !== "";
      const explicitBalanceExists =
        explicitBalanceRaw !== null && explicitBalanceRaw !== undefined && explicitBalanceRaw !== "";

      const fallbackApplied = applied.get(inv.id) || 0;
      const a = explicitPaidExists ? toNum(explicitPaidRaw) : fallbackApplied;
      const settled = a + toNum(settledExtra.get(inv.id) || 0);
      const fallbackBalance = Math.max(0, toNum(inv.total_amount) - settled);
      const explicitBalance = toNum(explicitBalanceRaw);
      const statusKey = String(inv?.status || "").toUpperCase();
      const shouldTrustExplicitBalance =
        explicitBalanceExists &&
        (explicitBalance > 0.0001 || a > 0.0001 || statusKey === "PAID");
      const bal = settled > 0.0001 ? fallbackBalance : shouldTrustExplicitBalance ? explicitBalance : fallbackBalance;
      const po_nos = poMap.get(inv.id) || [];
      return {
        id: inv.id,
        invoice_no: inv.invoice_no,
        po_nos,
        currency: inv.currency,
        total_amount: toNum(inv.total_amount),
        applied_amount: Number(a.toFixed(2)),
        balance: Number(bal.toFixed(2)),
        status: inv.status,
        created_at: inv.created_at,
      };
    }).filter((r: any) => {
      if (!(r.balance > 0.00001)) return false;
      if (vendorPoSet && r.po_nos.length > 0 && !r.po_nos.some((po: string) => vendorPoSet?.has(po))) return false;
      if (vendorPoSet && r.po_nos.length === 0) return false;
      if (q) {
        const invoiceHit = String(r.invoice_no || "").toLowerCase().includes(q);
        const poHit = (r.po_nos || []).some((po: string) => String(po).toLowerCase().includes(q));
        return invoiceHit || poHit;
      }
      return true;
    });

    return NextResponse.json({ success: true, rows });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ success: false, error: e.message || "Failed" }, { status: 500 });
  }
}
