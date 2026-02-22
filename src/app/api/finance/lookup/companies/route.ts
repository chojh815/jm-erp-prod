import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function normalizeKind(kind: string | null) {
  const k = (kind || "").toLowerCase();
  if (k === "vendor") return "VENDOR";
  if (k === "buyer") return "BUYER";
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const kind = normalizeKind(searchParams.get("kind"));
    const q = (searchParams.get("q") || "").trim();
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "30", 10) || 30, 1), 100);

    let query = supabaseAdmin
      .from("companies")
      .select("id, code, name, company_type")
      .order("name", { ascending: true })
      .limit(limit);

    if (kind) {
      // company_type could be enums or strings like 'BUYER', 'VENDOR'
      query = query.ilike("company_type", `%${kind}%`);
    }

    if (q) {
      query = query.or([`name.ilike.%${q}%`, `code.ilike.%${q}%`].join(","));
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data || []).map((r: any) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      company_type: r.company_type,
    }));

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
