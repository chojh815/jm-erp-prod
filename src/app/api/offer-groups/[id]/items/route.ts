import { NextResponse } from "next/server";
import { createSupabaseServerClient, getAuthUserOrThrow } from "@/lib/offerGroupsServer";

function n(v: any, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const user = await getAuthUserOrThrow(supabase);
    const offer_group_id = params.id;

    const body = await req.json().catch(() => ({}));
    const items = Array.isArray(body?.items) ? body.items : [body];

    // current max sort
    const { data: maxRow } = await supabase
      .from("offer_group_items")
      .select("sort_no")
      .eq("offer_group_id", offer_group_id)
      .eq("is_deleted", false)
      .order("sort_no", { ascending: false })
      .limit(1)
      .maybeSingle();

    let nextSort = n(maxRow?.sort_no, 0) + 1;

    const insertItems = items.map((it: any) => ({
      offer_group_id,
      costing_id: it?.costing_id ?? null,
      style_no: it?.style_no ?? null,
      image_url: it?.image_url ?? null,
      material_summary: it?.material_summary ?? null,
      size_summary: it?.size_summary ?? null,
      remark: it?.remark ?? null,
      sort_no: it?.sort_no ?? nextSort++,
      created_by: user.id,
      created_by_email: user.email ?? null,
      updated_by: user.id,
      updated_by_email: user.email ?? null,
    }));

    const { data: newItems, error } = await supabase
      .from("offer_group_items")
      .insert(insertItems)
      .select("*");

    if (error) throw error;

    // packages
    const packagesPayload: any[] = [];
    for (const it of newItems ?? []) {
      const pk = body?.packagesByIndex?.[String(it.sort_no)] ?? body?.packages ?? [];
      // if client sends packages per inserted item, use pk; else ignore
      if (Array.isArray(pk) && pk.length) {
        for (const p of pk) {
          packagesPayload.push({
            item_id: it.id,
            package_type: p?.package_type ?? "3PC/PKG",
            currency: p?.currency ?? "USD",
            fob_price: n(p?.fob_price, 0),
            moq: n(p?.moq, 0),
            created_by: user.id,
            created_by_email: user.email ?? null,
            updated_by: user.id,
            updated_by_email: user.email ?? null,
          });
        }
      }
    }

    if (packagesPayload.length) {
      const { error: pErr } = await supabase.from("offer_group_item_packages").insert(packagesPayload);
      if (pErr) throw pErr;
    }

    return NextResponse.json({ success: true, items: newItems ?? [] });
  } catch (e: any) {
    const msg = e?.message ?? "Failed";
    const status = /unauthorized/i.test(msg) ? 401 : 500;
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  // Bulk upsert items + packages
  try {
    const supabase = createSupabaseServerClient();
    const user = await getAuthUserOrThrow(supabase);
    const offer_group_id = params.id;
    const body = await req.json().catch(() => ({}));

    const items = Array.isArray(body?.items) ? body.items : [];
    const packages = Array.isArray(body?.packages) ? body.packages : [];

    // Update items
    for (const it of items) {
      if (!it?.id) continue;
      const patch: any = {};
      for (const k of ["costing_id","style_no","image_url","material_summary","size_summary","remark","sort_no"]) {
        if (k in it) patch[k] = it[k];
      }
      patch.updated_by = user.id;
      patch.updated_by_email = user.email ?? null;

      const { error } = await supabase
        .from("offer_group_items")
        .update(patch)
        .eq("id", it.id)
        .eq("offer_group_id", offer_group_id);

      if (error) throw error;
    }

    // Replace packages for provided item_ids (safe: only for those in payload)
    const itemIds = [...new Set(packages.map((p: any) => p?.item_id).filter(Boolean))];
    if (itemIds.length) {
      const { error: delErr } = await supabase
        .from("offer_group_item_packages")
        .update({
          is_deleted: true,
          deleted_at: new Date().toISOString(),
          deleted_by: user.id,
          updated_by: user.id,
          updated_by_email: user.email ?? null,
        })
        .in("item_id", itemIds)
        .eq("is_deleted", false);

      if (delErr) throw delErr;

      const ins = packages.map((p: any) => ({
        item_id: p.item_id,
        package_type: p.package_type ?? "3PC/PKG",
        currency: p.currency ?? "USD",
        fob_price: n(p.fob_price, 0),
        moq: n(p.moq, 0),
        created_by: user.id,
        created_by_email: user.email ?? null,
        updated_by: user.id,
        updated_by_email: user.email ?? null,
      }));

      const { error: insErr } = await supabase.from("offer_group_item_packages").insert(ins);
      if (insErr) throw insErr;
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    const msg = e?.message ?? "Failed";
    const status = /unauthorized/i.test(msg) ? 401 : 500;
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const user = await getAuthUserOrThrow(supabase);
    const offer_group_id = params.id;

    const body = await req.json().catch(() => ({}));
    const item_id = body?.item_id;
    if (!item_id) return NextResponse.json({ success: false, error: "item_id is required" }, { status: 400 });

    const { error } = await supabase
      .from("offer_group_items")
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: user.id,
        updated_by: user.id,
        updated_by_email: user.email ?? null,
      })
      .eq("id", item_id)
      .eq("offer_group_id", offer_group_id);

    if (error) throw error;

    // also soft delete packages
    const { error: pErr } = await supabase
      .from("offer_group_item_packages")
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: user.id,
        updated_by: user.id,
        updated_by_email: user.email ?? null,
      })
      .eq("item_id", item_id)
      .eq("is_deleted", false);

    if (pErr) throw pErr;

    return NextResponse.json({ success: true });
  } catch (e: any) {
    const msg = e?.message ?? "Failed";
    const status = /unauthorized/i.test(msg) ? 401 : 500;
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}
