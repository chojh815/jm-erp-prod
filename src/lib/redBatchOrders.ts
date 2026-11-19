import { supabaseAdmin as db } from "@/lib/supabaseAdmin";

export type RedBatchPo = {
  id: string;
  po_no: string;
  buyer_id: string | null;
  buyer_name: string | null;
  status: string | null;
  is_deleted?: boolean | null;
};
export type RedBatchPoLine = {
  id: string;
  po_header_id: string;
  line_no: number;
  buyer_style_no: string | null;
  buyer_style_code: string | null;
  upc: string | null;
  color: string | null;
  size: string | null;
  description: string | null;
  is_deleted?: boolean | null;
  sku_code: string;
};
class OrderError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
function checked(result: any) {
  if (result.error) throw result.error;
  return result.data;
}
const normalize = (value: string | null | undefined) => (value || "").trim();
export function redBatchSku(
  line: Pick<RedBatchPoLine, "upc" | "buyer_style_no" | "buyer_style_code">,
) {
  return (
    normalize(line.upc) ||
    normalize(line.buyer_style_no) ||
    normalize(line.buyer_style_code)
  ).toUpperCase();
}
async function redBuyerIds(): Promise<string[]> {
  const rows = checked(
    await db
      .from("companies")
      .select("id")
      .eq("company_type", "buyer")
      .in("code", ["RBK", "RED"]),
  );
  return (rows || []).map((row: { id: string }) => row.id);
}
export async function loadRedBatchPo(id: string): Promise<RedBatchPo> {
  const [ids, result] = await Promise.all([
    redBuyerIds(),
    db
      .from("po_headers")
      .select("id,po_no,buyer_id,buyer_name,status,is_deleted")
      .eq("id", id)
      .maybeSingle(),
  ]);
  const po = checked(result);
  if (!po || po.is_deleted || !ids.includes(po.buyer_id))
    throw new OrderError("선택한 RED PO가 없거나 삭제되었습니다.", 404);
  return po;
}
export async function listRedBatchPos(search: string, offset: number) {
  const ids = await redBuyerIds();
  if (!ids.length) return { rows: [], hasMore: false };
  let query = db
    .from("po_headers")
    .select("id,po_no,buyer_id,buyer_name,status,is_deleted")
    .in("buyer_id", ids)
    .or("is_deleted.is.null,is_deleted.eq.false");
  if (search)
    query = query.ilike("po_no", "%" + search.replace(/[\\%_]/g, "\\$&") + "%");
  const rows =
    checked(
      await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + 50),
    ) || [];
  return { rows: rows.slice(0, 50), hasMore: rows.length > 50 };
}
const lineFields =
  "id,po_header_id,line_no,buyer_style_no,buyer_style_code,upc,color,size,description,is_deleted";
export async function listRedBatchPoLines(
  poId: string,
): Promise<RedBatchPoLine[]> {
  const rows: RedBatchPoLine[] = [];
  let offset = 0;
  while (true) {
    const page =
      checked(
        await db
          .from("po_lines")
          .select(lineFields)
          .eq("po_header_id", poId)
          .or("is_deleted.is.null,is_deleted.eq.false")
          .order("line_no", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + 499),
      ) || [];
    rows.push(
      ...page.map((row: RedBatchPoLine) => ({
        ...row,
        sku_code: redBatchSku(row),
      })),
    );
    if (page.length < 500) return rows;
    offset += 500;
  }
}
export async function resolveRedBatchPoLine(poId: string, lineId: string) {
  const [po, result] = await Promise.all([
    loadRedBatchPo(poId),
    db
      .from("po_lines")
      .select(lineFields)
      .eq("id", lineId)
      .eq("po_header_id", poId)
      .maybeSingle(),
  ]);
  const line = checked(result);
  if (!line || line.is_deleted)
    throw new OrderError("선택한 품목이 해당 PO에 없거나 삭제되었습니다.", 404);
  const sku = redBatchSku(line);
  if (!sku || sku.length > 120)
    throw new OrderError(
      "선택한 품목의 UPC 또는 바이어 스타일 번호를 확인해 주세요.",
    );
  return { po, line: { ...line, sku_code: sku } as RedBatchPoLine };
}
