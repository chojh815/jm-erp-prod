import { NextResponse } from "next/server";
import { createSupabaseServerClient, getAuthUserOrThrow } from "@/lib/offerGroupsServer";

export async function GET() {
  try {
    const supabase = createSupabaseServerClient();
    await getAuthUserOrThrow(supabase);

    const { data, error } = await supabase
      .from("offer_groups")
      .select("*")
      .eq("is_deleted", false)
      .order("updated_at", { ascending: false })
      .limit(200);

    if (error) throw error;
    return NextResponse.json({ success: true, rows: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message ?? "Failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = createSupabaseServerClient();
    const user = await getAuthUserOrThrow(supabase);

    const body = await req.json().catch(() => ({}));
    const payload = {
      buyer_id: body?.buyer_id ?? null,
      buyer_name: body?.buyer_name ?? null,
      buyer_code: body?.buyer_code ?? null,
      currency: body?.currency ?? "USD",
      status: body?.status ?? "DRAFT",
      title: body?.title ?? null,
      memo: body?.memo ?? null,
      created_by: user.id,
      created_by_email: user.email ?? null,
      updated_by: user.id,
      updated_by_email: user.email ?? null,
    };

    const { data, error } = await supabase
      .from("offer_groups")
      .insert(payload)
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
