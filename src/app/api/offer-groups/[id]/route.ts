import { NextResponse } from "next/server";
import { createSupabaseServerClient, getAuthUserOrThrow } from "@/lib/offerGroupsServer";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    await getAuthUserOrThrow(supabase);
    const id = params.id;

    const { data: header, error: hErr } = await supabase
      .from("offer_groups")
      .select("*")
      .eq("id", id)
      .eq("is_deleted", false)
      .single();
    if (hErr) throw hErr;

    const { data: items, error: iErr } = await supabase
      .from("offer_group_items")
      .select("*")
      .eq("offer_group_id", id)
      .eq("is_deleted", false)
      .order("sort_no", { ascending: true });
    if (iErr) throw iErr;

    const itemIds = (items ?? []).map((x: any) => x.id);
    let packages: any[] = [];
    if (itemIds.length) {
      const { data: pk, error: pErr } = await supabase
        .from("offer_group_item_packages")
        .select("*")
        .in("item_id", itemIds)
        .eq("is_deleted", false);
      if (pErr) throw pErr;
      packages = pk ?? [];
    }

    return NextResponse.json({ success: true, header, items: items ?? [], packages });
  } catch (e: any) {
    const msg = e?.message ?? "Failed";
    const status = /unauthorized/i.test(msg) ? 401 : 500;
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const user = await getAuthUserOrThrow(supabase);
    const id = params.id;
    const body = await req.json().catch(() => ({}));

    const patch: any = {};
    for (const k of ["buyer_id","buyer_name","buyer_code","currency","status","title","memo"]) {
      if (k in body) patch[k] = body[k];
    }
    patch.updated_by = user.id;
    patch.updated_by_email = user.email ?? null;

    const { data, error } = await supabase
      .from("offer_groups")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, row: data });
  } catch (e: any) {
    const msg = e?.message ?? "Failed";
    const status = /unauthorized/i.test(msg) ? 401 : 500;
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const user = await getAuthUserOrThrow(supabase);
    const id = params.id;

    const { error } = await supabase
      .from("offer_groups")
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: user.id,
        updated_by: user.id,
        updated_by_email: user.email ?? null,
      })
      .eq("id", id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (e: any) {
    const msg = e?.message ?? "Failed";
    const status = /unauthorized/i.test(msg) ? 401 : 500;
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}
