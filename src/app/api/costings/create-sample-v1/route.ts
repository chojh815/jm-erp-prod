import { NextResponse } from "next/server";

/**
 * POST /api/costings/create-sample-v1
 * Body: { style_no: "jk26" } (or { q: "jk26" } / { style_prefix: "jk26" })
 *
 * IMPORTANT:
 * - If you see 405 Method Not Allowed in the browser, your client is NOT calling POST.
 *   Ensure fetch() uses method: "POST".
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    return NextResponse.json({
      success: true,
      message: "POST ok (create-sample-v1)",
      received: body,
    });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ success: false, error: "Use POST" }, { status: 405 });
}
