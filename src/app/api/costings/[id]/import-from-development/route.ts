import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

function num(v: any, d = 0) {
  const x = typeof v === "number" ? v : v == null ? NaN : Number(v);
  return Number.isFinite(x) ? x : d;
}

function txt(v: any) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function calcAmounts(opts: {
  qty: any;
  unit_cost: any;
  currency: string;
  fx_rate_to_usd: any;
  amount_local?: any;
  amount_usd?: any;
}) {
  const qty = num(opts.qty, 0);
  const unit_cost = num(opts.unit_cost, 0);
  const currency = (opts.currency || "USD").toUpperCase();
  let fx = num(opts.fx_rate_to_usd, currency === "USD" ? 1 : 1);
  if (!Number.isFinite(fx) || fx <= 0) fx = currency === "USD" ? 1 : 1;

  // Prefer explicit amounts if present, but always ensure amount_local is filled.
  let amount_local = opts.amount_local == null ? qty * unit_cost : num(opts.amount_local, qty * unit_cost);
  if (!Number.isFinite(amount_local)) amount_local = qty * unit_cost;

  let amount_usd: number;
  if (opts.amount_usd != null) {
    amount_usd = num(opts.amount_usd, currency === "USD" ? amount_local : (fx > 0 ? amount_local * fx : 0));
  } else {
    amount_usd = currency === "USD" ? amount_local : (fx > 0 ? amount_local * fx : 0);
  }
  if (!Number.isFinite(amount_usd)) amount_usd = currency === "USD" ? amount_local : (fx > 0 ? amount_local * fx : 0);

  return { qty, unit_cost, currency, fx_rate_to_usd: fx, amount_local, amount_usd };
}

async function findDevProductIdByStyle(client: any, styleNo: string): Promise<string | null> {
  // The user confirmed "headers has it but products doesn't" can happen.
  // Try products first, then fall back to headers.
  const { data: p1, error: e1 } = await client
    .from("product_development_products")
    .select("id")
    .eq("style_no", styleNo)
    .maybeSingle();
  if (!e1 && p1?.id) return p1.id;

  const { data: h1, error: e2 } = await client
    .from("product_development_headers")
    .select("id")
    .eq("style_no", styleNo)
    .maybeSingle();
  if (!e2 && h1?.id) return h1.id;

  return null;
}

export async function POST(req: Request, context: { params: { id: string } }) {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name) {
          return cookieStore.get(name)?.value;
        },
      },
    }
  );

  try {
    const id = context.params.id;
    const url = new URL(req.url);
    const mode = (url.searchParams.get("mode") || "reload").toLowerCase(); // reload | append

    const { data: header, error: hErr } = await supabase
      .from("costing_headers")
      .select("id, style_no, default_currency")
      .eq("id", id)
      .maybeSingle();
    if (hErr) throw hErr;
    if (!header) return NextResponse.json({ success: false, error: "Costing not found" }, { status: 404 });

    const styleNo = String(header.style_no || "").trim();
    if (!styleNo) {
      return NextResponse.json({ success: false, error: "style_no is empty on costing" }, { status: 400 });
    }

    const devId = await findDevProductIdByStyle(supabase, styleNo);
    if (!devId) {
      return NextResponse.json(
        { success: false, error: `Development product not found for style_no=${styleNo}` },
        { status: 404 }
      );
    }

    const { data: devMats, error: mErr } = await supabase
      .from("product_development_materials")
      .select("*")
      .eq("product_id", devId)
      .order("line_no", { ascending: true });
    if (mErr) throw mErr;

    const { data: devOps, error: oErr } = await supabase
      .from("product_development_operations")
      .select("*")
      .eq("product_id", devId)
      .order("line_no", { ascending: true });
    if (oErr) throw oErr;

    // In "reload" mode, clear existing lines first.
    if (mode === "reload") {
      await supabase.from("costing_material_lines").update({ is_deleted: true }).eq("costing_id", id);
      await supabase.from("costing_operation_lines").update({ is_deleted: true }).eq("costing_id", id);
    }

    const defaultCurrency = (header.default_currency || "USD").toUpperCase();

    const matRows = (devMats || []).map((r: any, idx: number) => {
      const currency = (r.currency || defaultCurrency || "USD").toUpperCase();
      const a = calcAmounts({
        qty: r.qty,
        unit_cost: r.unit_cost,
        currency,
        fx_rate_to_usd: r.fx_rate_to_usd,
        amount_local: r.amount_local,
        amount_usd: r.amount_usd,
      });
      return {
        costing_id: id,
        line_no: num(r.line_no, idx + 1),
        material_name: txt(r.material_name) || "(material)",
        spec: txt(r.spec),
        qty: a.qty,
        unit: txt(r.unit),
        unit_cost: a.unit_cost,
        currency: a.currency,
        fx_rate_to_usd: a.fx_rate_to_usd,
        amount_local: a.amount_local,
        amount_usd: a.amount_usd,
        supplier_id: r.supplier_id ?? null,
        supplier_name: txt(r.supplier_name),
        is_deleted: false,
      };
    });

    const opRows = (devOps || []).map((r: any, idx: number) => {
      const currency = (r.currency || defaultCurrency || "USD").toUpperCase();
      const a = calcAmounts({
        qty: r.qty,
        unit_cost: r.unit_cost,
        currency,
        fx_rate_to_usd: r.fx_rate_to_usd,
        amount_local: r.amount_local,
        amount_usd: r.amount_usd,
      });
      return {
        costing_id: id,
        line_no: num(r.line_no, idx + 1),
        operation_name: txt(r.operation_name) || "(operation)",
        qty: a.qty,
        unit: txt(r.unit),
        unit_cost: a.unit_cost,
        currency: a.currency,
        fx_rate_to_usd: a.fx_rate_to_usd,
        amount_local: a.amount_local,
        amount_usd: a.amount_usd,
        supplier_id: r.supplier_id ?? null,
        supplier_name: txt(r.supplier_name),
        is_deleted: false,
      };
    });

    if (matRows.length) {
      const { error: insErr } = await supabase.from("costing_material_lines").insert(matRows);
      if (insErr) throw insErr;
    }

    if (opRows.length) {
      const { error: insErr } = await supabase.from("costing_operation_lines").insert(opRows);
      if (insErr) throw insErr;
    }

    return NextResponse.json({
      success: true,
      dev_id: devId,
      style_no: styleNo,
      imported: { materials: matRows.length, operations: opRows.length },
    });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
