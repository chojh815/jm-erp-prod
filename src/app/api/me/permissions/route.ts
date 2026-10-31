import { NextResponse } from "next/server";
import { getApiIdentity } from "@/lib/apiIdentity";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      success: true,
      ...(await getApiIdentity()),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, success: false, error: e?.message || "Server error" },
      { status: e?.status ?? 500 },
    );
  }
}
