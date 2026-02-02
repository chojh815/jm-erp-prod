import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

function bad(msg: string, status = 400) {
  return NextResponse.json({ success: false, error: msg }, { status });
}

export async function GET(req: Request, ctx: { params: { id: string } }) {
  try {
    const id = ctx?.params?.id;
    if (!id) return bad("Missing costing id", 400);

    const url = new URL(req.url);
    const asOf = url.searchParams.get("as_of");
    if (!asOf) return bad("Missing as_of (YYYY-MM-DD)", 400);

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

    const { data, error } = await supabase.rpc("costings_calc_as_of", {
      p_costing_id: id,
      p_as_of: asOf,
    });

    if (error) return bad(error.message, 500);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return bad("No data returned", 404);

    return NextResponse.json({ success: true, row });
  } catch (e: any) {
    return bad(String(e?.message || e), 500);
  }
}
