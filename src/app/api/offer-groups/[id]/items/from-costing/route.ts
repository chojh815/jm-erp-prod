import { NextResponse } from "next/server";
import { createSupabaseServerClient, getAuthUserOrThrow } from "@/lib/offerGroupsServer";

function safeStr(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function uniq<T>(arr: T[]): T[] {
  const out: T[] = [];
  for (const x of arr) if (!out.includes(x)) out.push(x);
  return out;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const user = await getAuthUserOrThrow(supabase);
    const offer_group_id = params.id;

    const body = await req.json().catch(() => ({}));
    const costing_id = body?.costing_id;
    if (!costing_id) {
      return NextResponse.json({ success: false, error: "costing_id is required" }, { status: 400 });
    }

    const { data: ch, error: chErr } = await supabase
      .from("costing_headers")
      .select("*")
      .eq("id", costing_id)
      .eq("is_deleted", false)
      .maybeSingle();

    if (chErr) throw chErr;
    if (!ch) {
      return NextResponse.json({ success: false, error: "Costing not found" }, { status: 404 });
    }

    const style_no = safeStr(ch.style_no ?? ch.style ?? null);

    // Build a lightweight summary from costing lines
    const { data: mats } = await supabase
      .from("costing_material_lines")
      .select("material_name,spec")
      .eq("costing_id", costing_id)
      .eq("is_deleted", false)
      .order("line_no", { ascending: true })
      .limit(10);

    const { data: ops } = await supabase
      .from("costing_operation_lines")
      .select("operation_name")
      .eq("costing_id", costing_id)
      .eq("is_deleted", false)
      .order("line_no", { ascending: true })
      .limit(10);

    const matNames = uniq((mats ?? []).map((m: any) => safeStr(m.material_name)).filter(Boolean) as string[]);
    const opNames = uniq((ops ?? []).map((o: any) => safeStr(o.operation_name)).filter(Boolean) as string[]);

    let material_summary: string | null = null;
    if (matNames.length) {
      material_summary = matNames.slice(0, 4).join(", ") + (matNames.length > 4 ? ` (+${matNames.length - 4})` : "");
    }

    // Try to find size/image/remark from Product Development tables if available
    let image_url: string | null = safeStr(ch.image_url ?? ch.thumb_url ?? null);
    let size_summary: string | null = safeStr(ch.size_summary ?? ch.size ?? null);
    let remark: string | null = safeStr(ch.remark ?? ch.remarks ?? null);

    if (style_no) {
      // product_development_products sometimes stores representative info
      const { data: devP } = await supabase
        .from("product_development_products")
        .select("*")
        .eq("style_no", style_no)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (devP) {
        image_url = image_url ?? safeStr(devP.image_url ?? devP.image1_url ?? devP.photo_url ?? null);
        size_summary = size_summary ?? safeStr(devP.size_summary ?? devP.size ?? devP.size_text ?? null);
        remark = remark ?? safeStr(devP.remark ?? devP.remarks ?? devP.memo ?? null);
        material_summary = material_summary ?? safeStr(devP.material_summary ?? devP.material ?? devP.base_material ?? null);
      }

      // fallback to headers
      const { data: devH } = await supabase
        .from("product_development_headers")
        .select("*")
        .eq("style_no", style_no)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (devH) {
        image_url = image_url ?? safeStr(devH.image_url ?? devH.thumb_url ?? null);
        size_summary = size_summary ?? safeStr(devH.size_summary ?? devH.size ?? devH.size_text ?? null);
        remark = remark ?? safeStr(devH.remark ?? devH.remarks ?? devH.memo ?? null);
        material_summary = material_summary ?? safeStr(devH.material_summary ?? devH.material ?? devH.base_material ?? null);
      }
    }

    // current max sort
    const { data: maxRow } = await supabase
      .from("offer_group_items")
      .select("sort_no")
      .eq("offer_group_id", offer_group_id)
      .eq("is_deleted", false)
      .order("sort_no", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextSort = (Number(maxRow?.sort_no) || 0) + 1;

    const { data: newItem, error: insErr } = await supabase
      .from("offer_group_items")
      .insert({
        offer_group_id,
        costing_id,
        style_no,
        image_url,
        material_summary,
        size_summary,
        remark,
        sort_no: nextSort,
        created_by: user.id,
        created_by_email: user.email ?? null,
        updated_by: user.id,
        updated_by_email: user.email ?? null,
      })
      .select("*")
      .maybeSingle();

    if (insErr) throw insErr;

    return NextResponse.json({ success: true, item: newItem });
  } catch (e: any) {
    const msg = e?.message ?? "Failed";
    const status = /unauthorized/i.test(msg) ? 401 : 500;
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}
