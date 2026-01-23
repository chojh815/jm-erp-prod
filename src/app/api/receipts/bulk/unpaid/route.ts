// src/app/api/receipts/bulk/unpaid/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createRouteClient } from "@/lib/supabaseRouteClient";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function pickNumber(row: any, keys: string[]): number {
  for (const k of keys) {
    if (row && row[k] !== undefined && row[k] !== null && row[k] !== "") {
      const n = Number(row[k]);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

export async function GET(req: NextRequest) {
  try {
    // Auth (fixes 401)
    const supabase = createRouteClient();
    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const buyer_id = searchParams.get("buyer_id");
    if (!buyer_id) {
      return NextResponse.json({ success: false, error: "buyer_id is required" }, { status: 400 });
    }

    // 1) invoices for buyer
    const invSel = "id, invoice_no, invoice_date, created_at, total_amount, currency, status, is_deleted";
    const { data: invoices, error: invErr } = await supabaseAdmin
      .from("invoice_headers")
      .select(invSel)
      .eq("buyer_id", buyer_id)
      .eq("is_deleted", false);

    if (invErr) return NextResponse.json({ success: false, error: invErr.message }, { status: 400 });

    const invoiceList = (invoices ?? []).filter((r: any) => {
      const st = (r?.status ?? "").toString().toUpperCase();
      return st !== "DELETED" && st !== "CANCELLED";
    });

    // 2) receipt_lines aggregate in JS (schema-safe fallback)
    const invoiceIds = invoiceList.map((r: any) => r.id).filter(Boolean);
    const paidBy: Record<string, number> = {};
    if (invoiceIds.length) {
      const { data: rlines, error: rlErr } = await supabaseAdmin
        .from("receipt_lines")
        .select("*")
        .in("invoice_id", invoiceIds);

      if (!rlErr && Array.isArray(rlines)) {
        for (const row of rlines) {
          const iid = row.invoice_id;
          if (!iid) continue;
          const amt = pickNumber(row, [
            "apply_amount",
            "applied_amount",
            "allocated_amount",
            "amount",
            "received_amount",
            "net_received_amount",
          ]);
          paidBy[iid] = (paidBy[iid] ?? 0) + num(amt);
        }
      }
    }

    const items = invoiceList
      .map((inv: any) => {
        const total = num(inv.total_amount);
        const paid = num(paidBy[inv.id] ?? 0);
        const balance = Math.max(0, total - paid);
        return {
          id: inv.id,
          invoice_no: inv.invoice_no,
          invoice_date: inv.invoice_date ?? inv.created_at ?? null,
          total_amount: total,
          paid_amount: paid,
          balance_amount: balance,
          currency: inv.currency ?? null,
          status: inv.status ?? null,
        };
      })
      .filter((x: any) => x.balance_amount > 0.000001);

    return NextResponse.json({ success: true, items });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
