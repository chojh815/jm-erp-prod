/**
 * src/app/api/work-sheets/create-from-po/route.ts
 *
 * PO(헤더/라인) 기반으로 Work Sheet 생성(또는 기존 것 업데이트)
 * ✅ 중복 방지: 같은 po_line_id + is_deleted=false 가 이미 있으면 "재생성"이 아니라 "업데이트"로 처리
 * ✅ buyer_name / buyer_code는 companies에서 보강해서 저장
 * ✅ ws_no / work_sheet_no 둘 다 채워서(동일값) 기존 코드/신규코드 모두 호환
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function ok(data: any = {}) {
  return NextResponse.json({ success: true, ...data });
}
function bad(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v: any) {
  return typeof v === "string" && UUID_RE.test(v);
}

function yyMM(d = new Date()) {
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yy}${mm}`;
}

function isMissingColumnError(errMsg: string, col: string) {
  if (!errMsg) return false;
  return (
    errMsg.includes(`'${col}'`) &&
    (errMsg.toLowerCase().includes("schema cache") ||
      errMsg.toLowerCase().includes("does not exist"))
  );
}

async function getNextWsNo(prefix2: string) {
  const yymm = yyMM();
  const prefix = `${prefix2}-${yymm}`;

  // Try ws_no first; if missing, fallback to work_sheet_no
  let latest: string | null = null;

  {
    const { data, error } = await supabaseAdmin
      .from("work_sheet_headers")
      .select("ws_no")
      .eq("is_deleted", false)
      .ilike("ws_no", `${prefix}%`)
      .order("ws_no", { ascending: false })
      .limit(1);

    if (!error && Array.isArray(data) && data[0]?.ws_no) {
      latest = String(data[0].ws_no);
    }
    if (error && isMissingColumnError(error.message ?? "", "ws_no")) {
      // fallback below
    }
  }

  if (!latest) {
    const { data, error } = await supabaseAdmin
      .from("work_sheet_headers")
      .select("work_sheet_no")
      .eq("is_deleted", false)
      .ilike("work_sheet_no", `${prefix}%`)
      .order("work_sheet_no", { ascending: false })
      .limit(1);

    if (!error && Array.isArray(data) && data[0]?.work_sheet_no) {
      latest = String(data[0].work_sheet_no);
    }
  }

  let nextSeq = 1;
  if (latest) {
    const m = latest.match(/(\d{3})$/);
    if (m) nextSeq = Number(m[1]) + 1;
  }
  const seq = String(nextSeq).padStart(3, "0");
  return `${prefix}${seq}`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const po_header_id = body?.po_header_id;
    const po_line_id = body?.po_line_id;

    if (!isUuid(po_header_id)) return bad("Invalid po_header_id", 400);
    if (!isUuid(po_line_id)) return bad("Invalid po_line_id", 400);

    // 1) Load PO header + line
    const { data: poHRows, error: poHErr } = await supabaseAdmin
      .from("po_headers")
      .select("*")
      .eq("id", po_header_id)
      .limit(1);

    if (poHErr) return bad(poHErr.message, 500);
    const poH: any = poHRows?.[0];
    if (!poH) return bad("PO header not found", 404);

    const { data: poLRows, error: poLErr } = await supabaseAdmin
      .from("po_lines")
      .select("*")
      .eq("id", po_line_id)
      .limit(1);

    if (poLErr) return bad(poLErr.message, 500);
    const poL: any = poLRows?.[0];
    if (!poL) return bad("PO line not found", 404);

    const buyer_id = poH.buyer_id ?? poL.buyer_id ?? null;
    const po_no = poH.po_no ?? poL.po_no ?? null;
    const currency = poH.currency ?? poL.currency ?? null;

    // 2) Buyer info from companies
    let buyer_name: string | null = poH.buyer_name ?? null;
    let buyer_code_full: string | null = poH.buyer_code ?? null;

    if (buyer_id) {
      const { data: comps, error: cErr } = await supabaseAdmin
        .from("companies")
        .select("id, company_name, code")
        .eq("id", buyer_id)
        .limit(1);

      if (!cErr && comps?.[0]) {
        buyer_name = comps[0].company_name ?? buyer_name;
        buyer_code_full = comps[0].code ?? buyer_code_full;
      }
    }

    const buyerCode2 =
      (buyer_code_full ? String(buyer_code_full).trim().slice(0, 2) : "WS").toUpperCase();

    // 3) Upsert header by po_line_id (active)
    const { data: existingRows, error: exErr } = await supabaseAdmin
      .from("work_sheet_headers")
      .select("*")
      .eq("is_deleted", false)
      .eq("po_line_id", po_line_id)
      .limit(1);

    if (exErr) return bad(exErr.message, 500);

    let header: any = existingRows?.[0] ?? null;
    const nowIso = new Date().toISOString();

    if (!header) {
      const wsNo = await getNextWsNo(buyerCode2);

      const insertPayload: any = {
        po_header_id,
        po_line_id,
        po_no,
        buyer_id,
        buyer_name,
        buyer_code: buyer_code_full,
        currency,
        status: "DRAFT",
        ship_mode: poL.ship_mode ?? poH.ship_mode ?? null,
        requested_ship_date: poH.requested_ship_date ?? poL.delivery_date ?? null,
        buyer_style_no: poL.buyer_style_no ?? poL.buyer_style ?? null,
        buyer_brand_name: poH.buyer_brand_name ?? poL.buyer_brand_name ?? poH.buyer_brand ?? null,
        buyer_dept_name: poH.buyer_dept_name ?? poL.buyer_dept_name ?? null,
        ws_no: wsNo,
        work_sheet_no: wsNo,
        created_at: nowIso,
        updated_at: nowIso,
        is_deleted: false,
      };

      const { data: ins, error: insErr } = await supabaseAdmin
        .from("work_sheet_headers")
        .insert(insertPayload)
        .select("*")
        .single();

      if (insErr) return bad(insErr.message, 500);
      header = ins;
    } else {
      // Update core linkage fields, but keep user-entered memo fields intact
      const patch: any = {
        po_header_id,
        po_line_id,
        po_no,
        buyer_id,
        buyer_name: header.buyer_name ?? buyer_name,
        buyer_code: header.buyer_code ?? buyer_code_full,
        currency: header.currency ?? currency,
        ship_mode: header.ship_mode ?? (poL.ship_mode ?? poH.ship_mode ?? null),
        requested_ship_date:
          header.requested_ship_date ?? (poH.requested_ship_date ?? poL.delivery_date ?? null),
        buyer_style_no: header.buyer_style_no ?? (poL.buyer_style_no ?? poL.buyer_style ?? null),
        buyer_brand_name:
          header.buyer_brand_name ??
          (poH.buyer_brand_name ?? poL.buyer_brand_name ?? poH.buyer_brand ?? null),
        buyer_dept_name: header.buyer_dept_name ?? (poH.buyer_dept_name ?? poL.buyer_dept_name ?? null),
        updated_at: nowIso,
      };

      const { data: upd, error: updErr } = await supabaseAdmin
        .from("work_sheet_headers")
        .update(patch)
        .eq("id", header.id)
        .select("*")
        .single();

      if (updErr) return bad(updErr.message, 500);
      header = upd;
    }

    // 4) Ensure line exists for this worksheet + po_line_id (active)
    const { data: lineRows, error: lineErr } = await supabaseAdmin
      .from("work_sheet_lines")
      .select("*")
      .eq("is_deleted", false)
      .eq("work_sheet_id", header.id)
      .eq("po_line_id", po_line_id)
      .limit(1);

    if (lineErr) return bad(lineErr.message, 500);

    let line: any = lineRows?.[0] ?? null;

    const baseLinePatch: any = {
      work_sheet_id: header.id,
      po_line_id,
      product_id: poL.product_id ?? null,
      jm_style_no: poL.jm_style_no ?? poL.jm_no ?? header.jm_no ?? null,
      buyer_style: poL.buyer_style_no ?? poL.buyer_style ?? null,
      description: poL.description ?? null,
      qty: poL.qty ?? 0,
      plating_color: poL.plating_color ?? poL.plating ?? null,
      image_url_primary: poL.image_url_primary ?? poL.image_url ?? null,
      image_urls: poL.image_urls ?? poL.images ?? null,
      vendor_id: poL.vendor_id ?? null,
      vendor_currency: poL.vendor_currency ?? null,
      vendor_unit_cost_local: poL.vendor_unit_cost_local ?? null,
      product_dev_id: poL.product_dev_id ?? null,
      updated_at: nowIso,
      is_deleted: false,
    };

    if (!line) {
      const { data: insLine, error: insLErr } = await supabaseAdmin
        .from("work_sheet_lines")
        .insert({
          ...baseLinePatch,
          created_at: nowIso,
        })
        .select("*")
        .single();

      if (insLErr) return bad(insLErr.message, 500);
      line = insLine;
    } else {
      // Preserve user-entered fields: plating_spec/spec_summary/work_notes/qc_points/packing_notes
      const preserveFields = ["plating_spec", "spec_summary", "work_notes", "qc_points", "packing_notes"];
      for (const f of preserveFields) {
        delete baseLinePatch[f];
      }

      const { data: updLine, error: updLErr } = await supabaseAdmin
        .from("work_sheet_lines")
        .update(baseLinePatch)
        .eq("id", line.id)
        .select("*")
        .single();

      if (updLErr) return bad(updLErr.message, 500);
      line = updLine;
    }

    return ok({
      work_sheet_id: header.id,
      header,
      line,
    });
  } catch (e: any) {
    console.error(e);
    return bad(e?.message ?? "Server error", 500);
  }
}
