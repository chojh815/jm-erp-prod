// src/app/api/quotations/[id]/route.ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../_supabase";

export const dynamic = "force-dynamic";

const SAFE_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * GET /api/quotations/[id]
 * Returns: header + items + tiers (legacy) + variants (if you add later)
 */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const id = params?.id || SAFE_UUID;

    // Header
    const { data: h, error: he } = await supabase
      .from("quotation_headers")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (he) throw he;

    // Items (legacy naming)
    const { data: items, error: ie } = await supabase
      .from("quotation_items")
      .select("*")
      .eq("quotation_id", id)
      .order("line_no", { ascending: true });
    if (ie) throw ie;

    // Tiers (legacy)
    const itemIds = (items || []).map((x: any) => x.id).filter(Boolean);
    let tiers: any[] = [];
    if (itemIds.length) {
      const { data: t, error: te } = await supabase
        .from("quotation_item_tiers")
        .select("*")
        .in("quotation_item_id", itemIds as any)
        .order("qty", { ascending: true });
      if (te) throw te;
      tiers = t || [];
    }

    return NextResponse.json({ ok: true, header: h, items: items || [], tiers });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

/**
 * PUT /api/quotations/[id]
 * Body: { header, items, tiers }
 */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const id = params?.id || SAFE_UUID;
    const body = await req.json();
    const header = body?.header || {};
    const items = Array.isArray(body?.items) ? body.items : [];
    const tiers = Array.isArray(body?.tiers) ? body.tiers : [];

    // Upsert header
    const headerPayload = { ...header, id };
    delete (headerPayload as any).created_at;
    delete (headerPayload as any).updated_at;

    const { error: he } = await supabase.from("quotation_headers").upsert(headerPayload);
    if (he) throw he;

    // Upsert items
    const upItems = items.map((it: any, idx: number) => {
      const p = { ...it };
      p.quotation_id = id;
      if (p.line_no === null || p.line_no === undefined) p.line_no = idx + 1;
      delete p.created_at;
      delete p.updated_at;
      return p;
    });

    if (upItems.length) {
      const { error: ie } = await supabase.from("quotation_items").upsert(upItems);
      if (ie) throw ie;
    }

    // Upsert tiers
    const upTiers = tiers.map((t: any) => {
      const p = { ...t };
      delete p.created_at;
      delete p.updated_at;
      return p;
    });

    if (upTiers.length) {
      const { error: te } = await supabase.from("quotation_item_tiers").upsert(upTiers);
      if (te) throw te;
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

/**
 * DELETE /api/quotations/[id]
 * Soft delete best-effort across multiple schema variants:
 * - quotation_headers (is_deleted / status=DELETED)
 * - quotation_lines / quotation_items (both supported)
 * - quotation_item_tiers
 * - quotation_variants / quotation_variant_lines (if created)
 */
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const id = params?.id || SAFE_UUID;

  // If table or column doesn't exist, skip quietly (multi-env tolerance)
  function isSchemaMismatch(msg: string) {
    const m = (msg || "").toLowerCase();
    return (
      m.includes("does not exist") ||
      m.includes("column") ||
      m.includes("schema cache") ||
      m.includes("could not find the") ||
      m.includes("relation") // postgres
    );
  }

  // Best-effort soft delete:
  // 1) try update is_deleted=true
  // 2) if is_deleted column missing -> hard delete
  // 3) if table missing -> ignore
  async function softDeleteByEq(table: string, col: string, val: any) {
    // (supabase as any) to avoid TS "Type instantiation is excessively deep" with dynamic table names
    const { error } = await (supabase as any).from(table).update({ is_deleted: true }).eq(col, val);

    if (!error) return;

    const msg = String((error as any)?.message || error);
    if (isSchemaMismatch(msg)) {
      // if table missing or column missing, try hard delete only if table likely exists
      // (When table doesn't exist, hard delete will also error; we swallow it)
      const { error: delErr } = await (supabase as any).from(table).delete().eq(col, val);
      if (delErr) {
        const msg2 = String((delErr as any)?.message || delErr);
        if (isSchemaMismatch(msg2)) return;
        throw delErr;
      }
      return;
    }

    // real error
    throw error;
  }

  try {
    // Header: set is_deleted + status if possible
    // 1) try is_deleted + status
    const { error: he } = await supabase
      .from("quotation_headers")
      .update({ is_deleted: true, status: "DELETED" } as any)
      .eq("id", id);

    if (he) {
      const msg = String((he as any)?.message || he);

      if (isSchemaMismatch(msg)) {
        // If is_deleted doesn't exist, try status only
        // If table doesn't exist, ignore
        if (msg.toLowerCase().includes("column") || msg.toLowerCase().includes("is_deleted")) {
          const { error: he2 } = await supabase.from("quotation_headers").update({ status: "DELETED" } as any).eq("id", id);

          if (he2) {
            const msg2 = String((he2 as any)?.message || he2);
            if (!isSchemaMismatch(msg2)) {
              // final fallback hard delete
              const { error: he3 } = await supabase.from("quotation_headers").delete().eq("id", id);
              if (he3) throw he3;
            }
          }
        } else {
          // table missing -> ignore
        }
      } else {
        throw he;
      }
    }

    // Related tables (support both old + new)
    await softDeleteByEq("quotation_lines", "quotation_id", id);
    await softDeleteByEq("quotation_items", "quotation_id", id);

    // tiers:
    // - some env might have quotation_id on tiers
    await softDeleteByEq("quotation_item_tiers", "quotation_id", id);

    // - legacy tiers by quotation_item_id
    try {
      const { data: items, error: ie } = await supabase.from("quotation_items").select("id").eq("quotation_id", id);
      if (!ie && (items || []).length) {
        const ids = (items || []).map((x: any) => x.id).filter(Boolean);
        if (ids.length) {
          const { error: te } = await (supabase as any)
            .from("quotation_item_tiers")
            .update({ is_deleted: true })
            .in("quotation_item_id", ids);

          if (te) {
            const msg = String((te as any)?.message || te);
            if (!isSchemaMismatch(msg)) {
              const { error: td } = await (supabase as any)
                .from("quotation_item_tiers")
                .delete()
                .in("quotation_item_id", ids);
              if (td) throw td;
            }
          }
        }
      }
    } catch {
      // ignore: schema mismatch / env differences
    }

    // Variant tables (if present)
    await softDeleteByEq("quotation_variants", "quotation_id", id);

    // Variant lines: select variants -> delete lines by variant_id
    try {
      const { data: vs, error: ve } = await supabase.from("quotation_variants").select("id").eq("quotation_id", id);
      if (!ve && (vs || []).length) {
        const vids = (vs || []).map((x: any) => x.id).filter(Boolean);
        if (vids.length) {
          const { error: vle } = await (supabase as any)
            .from("quotation_variant_lines")
            .update({ is_deleted: true })
            .in("variant_id", vids);

          if (vle) {
            const msg = String((vle as any)?.message || vle);
            if (!isSchemaMismatch(msg)) {
              const { error: vld } = await (supabase as any)
                .from("quotation_variant_lines")
                .delete()
                .in("variant_id", vids);
              if (vld) throw vld;
            }
          }
        }
      }
    } catch {
      // ignore
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
