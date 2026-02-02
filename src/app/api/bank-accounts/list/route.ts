import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Bank Accounts lookup (A안: site prefix 매칭) - UI shape compatible
 *
 * Your DB schema (from /api/bank-accounts response) uses:
 *  - swift_code (not swift)
 *  - account_no_masked (account_no may be null)
 *  - is_default_for_site (not is_default)
 *
 * UI often expects:
 *  - swift
 *  - account_no
 *  - is_default
 *
 * So we normalize keys while staying schema-safe:
 *  - select('*') only
 *  - filter in JS (optional)
 */
function normalizeRow(row: any) {
  const swift =
    row.swift ??
    row.swift_code ??
    row.swiftCode ??
    row.swift_code_bic ??
    row.swift_bic ??
    row.bic ??
    null;

  const accountNo =
    row.account_no ??
    row.account_number ??
    row.accountNo ??
    row.account_no_masked ??
    row.accountNoMasked ??
    null;

  const siteCode = row.site_code ?? row.siteCode ?? null;
  const currency = row.currency ?? row.ccy ?? null;

  const isActive =
    row.is_active === true ||
    row.isActive === true ||
    row.active === true ||
    row.status === "ACTIVE";

  // default flag variants
  const isDefault =
    row.is_default ??
    row.isDefault ??
    row.default ??
    row.is_default_for_site ??
    row.default_for_site ??
    null;

  return {
    ...row,
    site_code: siteCode,
    currency,
    swift,
    account_no: accountNo,
    is_active: isActive,
    is_default: isDefault,
  };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const invoiceSite =
      (url.searchParams.get("invoice_site") ||
        url.searchParams.get("site_code") ||
        url.searchParams.get("site") ||
        url.searchParams.get("invoiceSite") ||
        "")
        .trim();

    const currencyParam =
      (url.searchParams.get("currency") ||
        url.searchParams.get("invoice_currency") ||
        "")
        .trim();

    // active_only: if explicitly '1', filter by active. If omitted, do NOT filter.
    const activeOnly = url.searchParams.get("active_only") === "1";

    const { data, error } = await supabaseAdmin.from("bank_accounts").select("*");
    if (error) throw error;

    let rows = (data ?? []).map(normalizeRow);

    if (currencyParam) {
      const want = currencyParam.toUpperCase();
      rows = rows.filter((r) => (r.currency ?? "").toUpperCase() === want);
    }

    if (activeOnly) {
      rows = rows.filter((r) => r.is_active === true);
    }

    // A안: site prefix matching
    if (invoiceSite) {
      const parts = invoiceSite.split("_").filter(Boolean);
      const country = parts[0] || invoiceSite;
      const acceptable = new Set([country, invoiceSite, "ANY"]);

      rows = rows.filter((r) => {
        const sc = (r.site_code ?? "").toString().trim();
        if (!sc) return true; // NULL/blank => ANY
        if (acceptable.has(sc)) return true;
        return invoiceSite.startsWith(sc); // VN_BACNINH startsWith VN
      });
    }

    // Client-sort safe (default first if truthy)
    rows.sort((a, b) => {
      const ad = a.is_default ? 0 : 1;
      const bd = b.is_default ? 0 : 1;
      if (ad !== bd) return ad - bd;
      const an = (a.account_name ?? "").toString();
      const bn = (b.account_name ?? "").toString();
      return an.localeCompare(bn);
    });

    // Return BOTH shapes to match any existing UI code:
    //  - {success:true, data:[...]}  (current)
    //  - {items:[...]}              (some older pages)
    return NextResponse.json({ success: true, data: rows, items: rows });
  } catch (err: any) {
    console.error("[BANK_ACCOUNTS_GET_A_V6]", err);
    return NextResponse.json(
      { error: err.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}
