import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [expenseTypesRes, companiesRes, sitesRes] = await Promise.all([
      supabaseAdmin
        .from("expense_types")
        .select("code,name,category,default_scope,default_allocation")
        .eq("is_active", true)
        .order("name"),
      supabaseAdmin
        .from("companies")
        .select("id,company_name,code,company_type")
        .order("company_name"),
      // company_sites in this DB does NOT have "code"
      supabaseAdmin
        .from("company_sites")
        .select("id,site_name,name,loading_port_code,origin_code,currency,is_deleted")
        .eq("is_deleted", false)
        .order("site_name"),
    ]);

    if (expenseTypesRes.error) {
      return NextResponse.json({ ok: false, error: expenseTypesRes.error.message }, { status: 500 });
    }
    if (companiesRes.error) {
      return NextResponse.json({ ok: false, error: companiesRes.error.message }, { status: 500 });
    }
    if (sitesRes.error) {
      return NextResponse.json({ ok: false, error: sitesRes.error.message }, { status: 500 });
    }

    const sites = (sitesRes.data || []).map((s: any) => ({
      id: s.id,
      // keep site_name field because ExpenseForm already reads this
      site_name: s.site_name ?? s.name ?? null,
      // expose a synthetic "code" so existing UI can still render it if needed
      code: s.loading_port_code ?? s.origin_code ?? null,
      currency: s.currency ?? null,
      loading_port_code: s.loading_port_code ?? null,
      origin_code: s.origin_code ?? null,
    }));

    const expenseTypes = [...(expenseTypesRes.data || [])].map((row: any) => {
      if (row.code === "FORWARDER") {
        return {
          ...row,
          name: "Forwarder Service",
        };
      }
      return row;
    });

    if (!expenseTypes.some((row: any) => row.code === "FREIGHT")) {
      const forwarder = expenseTypes.find((row: any) => row.code === "FORWARDER");
      expenseTypes.push({
        code: "FREIGHT",
        name: "Freight / Air / Ocean",
        category: forwarder?.category || "LOGISTICS",
        default_scope: forwarder?.default_scope || "SHIPMENT",
        default_allocation: forwarder?.default_allocation || "BY_CBM",
      });
    }

    expenseTypes.sort((a: any, b: any) => String(a.name || "").localeCompare(String(b.name || "")));

    return NextResponse.json({
      ok: true,
      data: {
        expense_types: expenseTypes,
        companies: companiesRes.data || [],
        sites,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
