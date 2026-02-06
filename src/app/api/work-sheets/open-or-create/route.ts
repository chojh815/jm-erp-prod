import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../_supabase";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(v: any) {
  return typeof v === "string" && UUID_RE.test(v);
}

function pickText(...vals: any[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function pickNumber(...vals: any[]): number | null {
  for (const v of vals) {
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}

function pickDate(...vals: any[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) {
      const s = v.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const d = new Date(s);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }
  return null;
}

async function fetchLineImages(supabase: any, po_line_id: string): Promise<string[] | null> {
  const { data, error } = await supabase
    .from("po_line_images")
    .select("*")
    .eq("po_line_id", po_line_id);

  if (error || !data?.length) return null;

  const urls = (data ?? [])
    .map((r: any) => r.image_url || r.url || r.path || r.file_url)
    .filter((u: any) => typeof u === "string" && u.trim())
    .map((u: string) => u.trim());

  return urls.length ? urls : null;
}

async function buildHeaderPayload(supabase: any, po_line_id: string) {
  const { data: poLine, error: ple } = await supabase
    .from("po_lines")
    .select("*")
    .eq("id", po_line_id)
    .maybeSingle();

  if (ple) throw new Error(ple.message);
  if (!poLine) throw new Error("PO line not found for po_line_id");

  const po_header_id =
    poLine?.po_header_id || poLine?.header_id || poLine?.poHeaderId || null;

  let poHeader: any = null;
  if (po_header_id && isUuid(String(po_header_id))) {
    const { data: ph, error: phe } = await supabase
      .from("po_headers")
      .select("*")
      .eq("id", String(po_header_id))
      .maybeSingle();
    if (phe) throw new Error(phe.message);
    poHeader = ph || null;
  }

  let buyerCompany: any = null;
  const buyer_id =
    (poHeader?.buyer_id && isUuid(String(poHeader.buyer_id))
      ? String(poHeader.buyer_id)
      : null) ||
    (poHeader?.company_id && isUuid(String(poHeader.company_id))
      ? String(poHeader.company_id)
      : null) ||
    null;

  if (buyer_id) {
    const { data: bc } = await supabase
      .from("companies")
      .select("*")
      .eq("id", buyer_id)
      .maybeSingle();
    buyerCompany = bc || null;
  }

  const jm_style_no = pickText(
    poLine?.jm_style_no,
    poLine?.jm_style,
    poLine?.style_no,
    poLine?.style,
    poLine?.buyer_style_no
  );

  const buyer_style_no = pickText(poLine?.buyer_style_no, poLine?.buyer_style, poLine?.sku);

  const buyer_brand_name = pickText(
    poLine?.buyer_brand_name,
    poHeader?.buyer_brand_name,
    poHeader?.buyer_brand
  );

  const buyer_dept_name = pickText(poLine?.buyer_dept_name, poHeader?.buyer_dept_name);

  const ship_mode = pickText(poHeader?.ship_mode, poHeader?.shipMode, poHeader?.shipping_mode);

  const requested_ship_date = pickDate(
    poHeader?.requested_ship_date,
    poHeader?.req_ship_date,
    poHeader?.reqShipDate,
    poLine?.requested_ship_date,
    poLine?.req_ship_date
  );

  const currency = pickText(poHeader?.currency, poHeader?.cur, poHeader?.order_currency);

  const po_no = pickText(poHeader?.po_no, poHeader?.poNo, poLine?.po_no);

  const buyer_name = pickText(poHeader?.buyer_name, buyerCompany?.name, buyerCompany?.company_name);

  const buyer_code = pickText(poHeader?.buyer_code, buyerCompany?.code);

  const description = pickText(
    poLine?.description,
    poLine?.product_name,
    poLine?.item_description
  );

  const qty = pickNumber(
    poLine?.qty,
    poLine?.order_qty,
    poLine?.order_quantity,
    poLine?.quantity
  );

  const headerPayload: any = {
    status: "DRAFT",
    po_line_id,
    po_header_id: po_header_id && isUuid(String(po_header_id)) ? String(po_header_id) : null,
    po_no,
    buyer_id,
    buyer_name,
    buyer_code,
    currency,
    buyer_style_no,
    buyer_brand_name,
    buyer_dept_name,
    ship_mode,
    requested_ship_date,
    jm_no: jm_style_no,
  };

  for (const k of Object.keys(headerPayload)) {
    if (headerPayload[k] === null || headerPayload[k] === undefined) delete headerPayload[k];
  }

  const image_urls = await fetchLineImages(supabase, po_line_id);

  const linePayload: any = {
    po_line_id,
    jm_style_no: jm_style_no || null,
    buyer_style_no: buyer_style_no || null,
    description: description || null,
    qty: qty ?? null,
    image_urls: image_urls ?? null,
  };

  if (!linePayload.jm_style_no) {
    throw new Error(
      "Cannot create Work Sheet: PO line has no style value (jm_style_no/style_no/buyer_style_no)."
    );
  }

  return { headerPayload, linePayload };
}

/**
 * POST /api/work-sheets/open-or-create
 * Body: { po_line_id: uuid }
 *
 * A안: 스냅샷(수량/설명/이미지 등)을 work_sheet_lines에 저장해서
 * Production Status / PO List / WS 화면이 동일하게 표시되도록 보장.
 */
export async function POST(req: Request) {
  try {
    const supabase = createSupabaseServerClient();
    const body = (await req.json().catch(() => ({}))) as any;

    const po_line_id = String(body?.po_line_id || "");
    if (!isUuid(po_line_id)) {
      return NextResponse.json({ success: false, error: "Invalid po_line_id" }, { status: 400 });
    }

    // 1) existing mapping
    const { data: existing, error: e1 } = await supabase
      .from("work_sheet_lines")
      .select("work_sheet_id")
      .eq("po_line_id", po_line_id)
      .limit(1)
      .maybeSingle();

    if (e1) {
      return NextResponse.json({ success: false, error: e1.message }, { status: 500 });
    }

    if (existing?.work_sheet_id && isUuid(existing.work_sheet_id)) {
      // best-effort: backfill header/line snapshot ONLY if missing
      try {
        const wsId = existing.work_sheet_id;

        const { data: hdr } = await supabase
          .from("work_sheet_headers")
          .select("*")
          .eq("id", wsId)
          .maybeSingle();

        const { data: wsl } = await supabase
          .from("work_sheet_lines")
          .select("*")
          .eq("work_sheet_id", wsId)
          .eq("po_line_id", po_line_id)
          .maybeSingle();

        const { headerPayload, linePayload } = await buildHeaderPayload(supabase, po_line_id);

        const needHeader =
          !hdr?.po_no || !hdr?.buyer_name || !hdr?.requested_ship_date || !hdr?.buyer_code;

        if (needHeader) {
          const upd: any = { ...headerPayload };
          delete upd.status;
          delete upd.notes;
          delete upd.general_notes;
          delete upd.internal_notes;
          await supabase.from("work_sheet_headers").update(upd).eq("id", wsId);
        }

        if (wsl?.id) {
          const updLine: any = {};
          if (!wsl?.buyer_style_no && linePayload.buyer_style_no) updLine.buyer_style_no = linePayload.buyer_style_no;
          if (!wsl?.description && linePayload.description) updLine.description = linePayload.description;
          if ((!wsl?.qty || Number(wsl?.qty) === 0) && linePayload.qty) updLine.qty = linePayload.qty;
          if (
            (!Array.isArray(wsl?.image_urls) || (wsl?.image_urls?.length ?? 0) === 0) &&
            Array.isArray(linePayload.image_urls) &&
            linePayload.image_urls.length
          ) {
            updLine.image_urls = linePayload.image_urls;
          }
          if (Object.keys(updLine).length) {
            await supabase.from("work_sheet_lines").update(updLine).eq("id", wsl.id);
          }
        }
      } catch {}

      return NextResponse.json(
        { success: true, work_sheet_id: existing.work_sheet_id, created: false },
        { status: 200 }
      );
    }

    // 2) Build payloads from PO tables
    const { headerPayload, linePayload } = await buildHeaderPayload(supabase, po_line_id);

    // 3) create header
    const { data: h, error: he } = await supabase
      .from("work_sheet_headers")
      .insert(headerPayload)
      .select("id")
      .single();

    if (he || !h?.id || !isUuid(h.id)) {
      return NextResponse.json(
        { success: false, error: he?.message || "Failed to create Work Sheet header" },
        { status: 500 }
      );
    }

    // 4) create line (with snapshot fields)
    const { error: le } = await supabase.from("work_sheet_lines").insert({
      work_sheet_id: h.id,
      ...linePayload,
    });

    if (le) {
      try {
        await supabase.from("work_sheet_headers").delete().eq("id", h.id);
      } catch {}
      return NextResponse.json(
        { success: false, error: le.message || "Failed to create Work Sheet line" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, work_sheet_id: h.id, created: true }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || "Server error" }, { status: 500 });
  }
}
