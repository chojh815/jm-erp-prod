import { NextResponse } from "next/server";
import { getApiIdentity } from "@/lib/apiIdentity";
import { RED_BATCH_UUID } from "@/lib/redBatchCode";
import {
  listRedBatchPos,
  listRedBatchPoLines,
  loadRedBatchPo,
  type RedBatchPoScope,
} from "@/lib/redBatchOrders";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const identity = await getApiIdentity();
    if (!identity.permissions.includes("production_batches.view"))
      return NextResponse.json(
        { success: false, message: "Batches (RED) 접근 권한이 없습니다." },
        { status: 403 },
      );
    const params = new URL(req.url).searchParams;
    const scope = (params.get("scope") || "pending") as RedBatchPoScope;
    if (!["pending", "unbatched", "all"].includes(scope))
      return NextResponse.json(
        { success: false, message: "PO 표시 조건을 확인해 주세요." },
        { status: 400 },
      );
    const id = params.get("po_id");
    if (id !== null) {
      if (!RED_BATCH_UUID.test(id))
        return NextResponse.json(
          { success: false, message: "PO ID를 확인해 주세요." },
          { status: 400 },
        );
      const po = await loadRedBatchPo(id);
      return NextResponse.json(
        { success: true, po, rows: await listRedBatchPoLines(id, scope) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const search = (params.get("q") || "").trim(),
      offset = Number(params.get("offset") || 0);
    if (search.length > 100 || !Number.isInteger(offset) || offset < 0)
      return NextResponse.json(
        { success: false, message: "검색 조건을 확인해 주세요." },
        { status: 400 },
      );
    return NextResponse.json(
      { success: true, ...(await listRedBatchPos(search, offset, scope)) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        success: false,
        message: ["42P01", "PGRST205"].includes(e.code)
          ? "RED PO 필터 DB 설정을 먼저 적용해 주세요."
          : e.message || "PO 목록을 불러오지 못했습니다.",
      },
      {
        status: ["42P01", "PGRST205"].includes(e.code) ? 503 : e.status || 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
