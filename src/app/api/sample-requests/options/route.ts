import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function s(v: any) {
  return String(v ?? "").trim();
}

function upper(v: any) {
  return s(v).toUpperCase();
}

function normCode(row: any) {
  return upper(row?.buyer_code || row?.company_code || row?.code || "GEN") || "GEN";
}

function normName(row: any) {
  return s(row?.buyer_name || row?.company_name || row?.name || row?.company || "—") || "—";
}

function isDeleted(row: any) {
  return row?.is_deleted === true || upper(row?.status) === "DELETED";
}

function isInternalLike(name: string) {
  const n = upper(name);
  return (
    n.includes("JM INTERNATIONAL") ||
    n.includes("J M INTERNATIONAL") ||
    n === "JM" ||
    n.includes("OUR COMPANY")
  );
}

function isBuyerLike(row: any) {
  const type = upper(row?.company_type || row?.type || row?.account_type || row?.party_type);
  const name = normName(row);
  const code = normCode(row);

  const excluded = new Set([
    "FACTORY",
    "VENDOR",
    "SUPPLIER",
    "MANUFACTURER",
    "INTERNAL",
    "OWNER",
    "SHIPPER",
    "FORWARDER",
    "AGENT",
    "OFFICE",
    "WAREHOUSE",
    "EMPLOYEE",
  ]);
  const allowed = new Set(["BUYER", "CUSTOMER", "CLIENT", "ACCOUNT"]);

  if (isDeleted(row)) return false;
  if (isInternalLike(name)) return false;
  if (type && excluded.has(type)) return false;
  if (type && allowed.has(type)) return true;

  // Fallback for schemas that do not classify buyer rows cleanly.
  if (s(row?.buyer_code) || s(row?.buyer_name)) return true;
  if (code && code !== "GEN" && name && !isInternalLike(name)) return true;

  return false;
}

function dedupe(rows: any[]) {
  const map = new Map<string, { id: string; name: string; code: string }>();
  for (const r of rows || []) {
    const id = s(r?.id);
    const name = normName(r);
    if (!id || !name || name === "—") continue;
    if (!isBuyerLike(r)) continue;
    if (!map.has(id)) {
      map.set(id, { id, name, code: normCode(r) });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function GET() {
  try {
    const attempts = [
      async () => supabaseAdmin.from("companies").select("*").eq("is_deleted", false).order("company_name", { ascending: true }).limit(1000),
      async () => supabaseAdmin.from("companies").select("*").order("company_name", { ascending: true }).limit(1000),
      async () => supabaseAdmin.from("companies").select("*").order("name", { ascending: true }).limit(1000),
      async () => supabaseAdmin.from("buyers").select("*").order("name", { ascending: true }).limit(1000),
    ];

    let lastError: any = null;

    for (const run of attempts) {
      const { data, error } = await run();
      if (error) {
        lastError = error;
        continue;
      }
      const buyers = dedupe(data || []);
      if (buyers.length > 0) {
        return NextResponse.json(
          { ok: true, buyers },
          { headers: { "Cache-Control": "no-store, max-age=0" } }
        );
      }
    }

    return NextResponse.json(
      {
        ok: false,
        buyers: [],
        error: lastError?.message || "Buyer list is empty after filtering companies/buyers data.",
      },
      {
        headers: { "Cache-Control": "no-store, max-age=0" },
      }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, buyers: [], error: e?.message || String(e) },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
