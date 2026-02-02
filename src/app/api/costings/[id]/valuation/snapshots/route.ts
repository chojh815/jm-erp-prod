import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

function bad(msg: string, status = 400) {
  return NextResponse.json({ success: false, error: msg }, { status });
}

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  try {
    const id = ctx?.params?.id;
    if (!id) return bad("Missing costing id", 400);

    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set() {},
          remove() {},
        },
      }
    );

    const { data, error } = await supabase
      .from("costing_fx_valuations")
      .select("*")
      .eq("costing_id", id)
      .eq("is_deleted", false)
      .order("as_of_date", { ascending: false })
      .limit(200);

    if (error) return bad(error.message, 500);
    return NextResponse.json({ success: true, rows: data ?? [] });
  } catch (e: any) {
    return bad(String(e?.message || e), 500);
  }
}

export async function POST(req: Request, ctx: { params: { id: string } }) {
  try {
    const id = ctx?.params?.id;
    if (!id) return bad("Missing costing id", 400);

    const body = await req.json().catch(() => ({}));
    const asOf = String(body?.as_of_date || "");
    const note = body?.note ?? null;
    const overwrite = body?.overwrite !== false;

    if (!asOf) return bad("Missing as_of_date (YYYY-MM-DD)", 400);

    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set() {},
          remove() {},
        },
      }
    );

    const { data, error } = await supabase.rpc("costings_save_valuation_snapshot", {
      p_costing_id: id,
      p_as_of: asOf,
      p_note: note,
      p_overwrite: overwrite,
    });

    if (error) return bad(error.message, 500);
    return NextResponse.json({ success: true, snapshot_id: data });
  } catch (e: any) {
    return bad(String(e?.message || e), 500);
  }
}
