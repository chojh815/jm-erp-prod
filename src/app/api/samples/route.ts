// /src/app/api/samples/route.ts
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// 🔹 POST = 샘플 등록
export async function POST(req: Request) {
  try {
    const data = await req.json();

    const { po_no, type, planned_date, carrier, tracking_no } = data;

    const { error } = await supabaseAdmin
      .from("sample_milestones")
      .insert([
        {
          po_no,
          type,
          planned_date,
          carrier,
          tracking_no,
          status: "PLANNED",
        },
      ]);

    if (error) throw error;

    return Response.json({ success: true, message: "Sample saved successfully" });
  } catch (error: any) {
    return Response.json({ success: false, message: error.message }, { status: 400 });
  }
}

// 🔹 GET = 특정 PO의 샘플 목록 조회
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const po_no = searchParams.get("po_no");

  if (!po_no) {
    return Response.json({ success: false, message: "Missing PO number" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("sample_milestones")
    .select("*")
    .eq("po_no", po_no)
    .order("type");

  if (error) {
    return Response.json({ success: false, message: error.message }, { status: 400 });
  }

  return Response.json({ success: true, data });
}

// 🔹 DELETE = 샘플 삭제
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return Response.json({ success: false, message: "Missing ID" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("sample_milestones")
    .delete()
    .eq("id", id);

  if (error) {
    return Response.json({ success: false, message: error.message }, { status: 400 });
  }

  return Response.json({ success: true, message: "Sample deleted" });
}
