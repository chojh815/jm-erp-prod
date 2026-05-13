import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../_supabase";

export const dynamic = "force-dynamic";

type Preset = "MTD" | "YTD" | "LAST_30" | "LAST_90" | "LAST_12_MONTHS" | "CUSTOM";
type BucketKey = "current" | "b1_30" | "b31_60" | "b61_90" | "b90_plus";

const SAFE_DATE = "1970-01-01";

function iso(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function isoTodayKST() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function addDaysISO(baseISO: string, deltaDays: number) {
  const d = new Date(baseISO + "T00:00:00");
  d.setDate(d.getDate() + deltaDays);
  return iso(d);
}

function monthStartISO(anyISO: string) {
  const d = new Date(anyISO + "T00:00:00");
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  return iso(first);
}

function yearStartISO(anyISO: string) {
  const d = new Date(anyISO + "T00:00:00");
  const first = new Date(d.getFullYear(), 0, 1);
  return iso(first);
}

function monthsAgoStartISO(anyISO: string, monthsAgo: number) {
  const d = new Date(anyISO + "T00:00:00");
  const firstThisMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  const target = new Date(firstThisMonth.getFullYear(), firstThisMonth.getMonth() - monthsAgo, 1);
  return iso(target);
}

function parseIds(raw: string | null): string[] | "ALL" {
  if (!raw) return "ALL";
  const t = String(raw).trim();
  if (!t || t.toUpperCase() === "ALL") return "ALL";
  const parts = t.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : "ALL";
}

function rangeFromPreset(preset: Preset, startParam: string | null, endParam: string | null) {
  const end = endParam && endParam.length >= 10 ? endParam.slice(0, 10) : isoTodayKST();
  if (preset === "CUSTOM") {
    const start = startParam && startParam.length >= 10 ? startParam.slice(0, 10) : end;
    return { start, end };
  }
  if (preset === "MTD") return { start: monthStartISO(end), end };
  if (preset === "YTD") return { start: yearStartISO(end), end };
  if (preset === "LAST_30") return { start: addDaysISO(end, -29), end };
  if (preset === "LAST_90") return { start: addDaysISO(end, -89), end };
  if (preset === "LAST_12_MONTHS") return { start: monthsAgoStartISO(end, 11), end };
  return { start: SAFE_DATE, end };
}

function parseTermNumber(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") {
    if (Number.isFinite(v) && v > 0 && v < 3660) return Math.floor(v);
    return null;
  }
  const s = String(v).trim();
  if (!s) return null;
  const direct = Number(s);
  if (Number.isFinite(direct) && direct > 0 && direct < 3660) return Math.floor(direct);
  const m = s.match(/(\d{1,4})/);
  if (!m) return null;
  const n = Number(m[1]);
  if (Number.isFinite(n) && n > 0 && n < 3660) return Math.floor(n);
  return null;
}

function pickTermDays(r: any): number | null {
  const candidates = [
    r?.payment_terms_days,
    r?.payment_term_days,
    r?.terms_days,
    r?.net_days,
    r?.net_terms_days,
    r?.due_days,
    r?.payment_terms,
    r?.payment_term,
  ];
  for (const v of candidates) {
    const n = parseTermNumber(v);
    if (n) return n;
  }
  return null;
}

function pickCompanyTermDays(r: any): number | null {
  const candidates = [
    r?.payment_terms_days,
    r?.payment_term_days,
    r?.terms_days,
    r?.net_days,
    r?.net_terms_days,
    r?.due_days,
    r?.default_payment_terms_days,
    r?.default_payment_term_days,
    r?.buyer_default_payment_terms_days,
    r?.buyer_default_payment_term_days,
    r?.payment_terms,
    r?.payment_term,
    r?.default_payment_terms,
    r?.default_payment_term,
    r?.buyer_payment_term,
    r?.buyer_payment_terms,
    r?.buyer_default_payment_term,
    r?.buyer_default_payment_terms,
    r?.terms,
    r?.default_terms,
    r?.payment_term_name,
    r?.payment_terms_name,
  ];
  for (const v of candidates) {
    const n = parseTermNumber(v);
    if (n) return n;
  }
  return null;
}

function normKey(v: any) {
  return String(v ?? "").trim().toLowerCase();
}

function pickDate(row: any): string | null {
  return row?.invoice_date ?? row?.receipt_date ?? row?.deposit_date ?? row?.date ?? row?.updated_at ?? row?.created_at ?? null;
}

function pickInvoiceGrossUSD(row: any): number {
  const candidates = [
    row?.subtotal,
    row?.total_amount,
    row?.grand_total,
    row?.invoice_amount,
    row?.amount_usd,
    row?.total_usd,
    row?.total_amount_usd,
    row?.grand_total_usd,
    row?.amount,
  ];
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function pickInvoiceNo(row: any): string | null {
  return row?.invoice_no ?? row?.invoiceNo ?? row?.invoice_number ?? row?.no ?? null;
}

function pickBuyerId(row: any): string | null {
  return row?.buyer_id ?? row?.buyerId ?? row?.company_id ?? null;
}

function pickBuyerName(row: any): string | null {
  return row?.buyer_name ?? row?.buyerName ?? row?.company_name ?? null;
}

function pickBuyerCode(row: any): string | null {
  return row?.buyer_code ?? row?.company_code ?? row?.code ?? null;
}

function pickSiteId(row: any): string | null {
  return row?.ship_from_site_id ?? row?.site_id ?? row?.company_site_id ?? null;
}

function pickReceiptHeaderId(row: any): string | null {
  return row?.receipt_header_id ?? row?.receipt_id ?? row?.header_id ?? row?.receipt_header ?? null;
}

function pickReceiptId(row: any): string | null {
  return row?.id ?? row?.receipt_id ?? row?.receipt_header_id ?? null;
}

function pickInvoiceIdAny(row: any): string | null {
  return row?.invoice_id ?? row?.invoice_header_id ?? row?.inv_id ?? null;
}

function pickInvoiceNoAny(row: any): string | null {
  return row?.invoice_no ?? row?.invoice_number ?? row?.inv_no ?? null;
}

function pickAppliedUSD(row: any): number {
  const candidates = [
    row?.applied_amount_usd,
    row?.apply_amount_usd,
    row?.applied_usd,
    row?.amount_applied_usd,
    row?.amount_usd,
    row?.applied_amount,
    row?.apply_amount,
    row?.amount_applied,
    row?.amount,
  ];
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function pickWriteoffUSD(row: any): number {
  const candidates = [
    row?.writeoff_amount_usd,
    row?.writeoff_usd,
    row?.amount_writeoff_usd,
    row?.writeoff_amount,
    row?.amount_writeoff,
  ];
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function bucketOf(overdueDays: number): BucketKey {
  if (overdueDays <= 0) return "current";
  if (overdueDays <= 30) return "b1_30";
  if (overdueDays <= 60) return "b31_60";
  if (overdueDays <= 90) return "b61_90";
  return "b90_plus";
}

function emptyBuckets() {
  return {
    current: 0,
    b1_30: 0,
    b31_60: 0,
    b61_90: 0,
    b90_plus: 0,
  };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const preset = (url.searchParams.get("preset") || "MTD") as Preset;
    const buyerIds = parseIds(url.searchParams.get("buyerIds") ?? url.searchParams.get("buyer_ids"));
    const siteIds = parseIds(url.searchParams.get("siteIds") ?? url.searchParams.get("site_ids"));
    const buyerGroup = String(url.searchParams.get("groupBy") || "buyer").toLowerCase();
    const debug = url.searchParams.get("debug") === "1";

    const { start, end } = rangeFromPreset(
      preset,
      url.searchParams.get("start"),
      url.searchParams.get("end")
    );

    const supabase = createSupabaseServerClient();

    const [invRes, rchRes, rcaRes, rclRes, companiesRes] = await Promise.all([
      supabase.from("invoice_headers").select("*"),
      supabase.from("receipt_headers").select("*"),
      supabase.from("receipt_applications").select("*"),
      supabase.from("receipt_lines").select("*"),
      supabase.from("companies").select("*"),
    ]);

    const invoices = invRes.error ? [] : (invRes.data || []);
    const receiptHeaders = rchRes.error ? [] : (rchRes.data || []);
    const receiptApps = rcaRes.error ? [] : (rcaRes.data || []);
    const receiptLines = rclRes.error ? [] : (rclRes.data || []);
    const companies = companiesRes.error ? [] : (companiesRes.data || []);

    const EXCLUDED_STATUSES = new Set(["DELETED", "CANCELLED", "CANCELED"]);
    const notDeleted = (row: any) => row?.is_deleted !== true && !EXCLUDED_STATUSES.has(String(row?.status ?? "").toUpperCase());

    const buyerOk = (row: any) => {
      if (buyerIds === "ALL") return true;
      const id = pickBuyerId(row);
      return !!id && (buyerIds as string[]).includes(id);
    };

    const siteOk = (row: any) => {
      if (siteIds === "ALL") return true;
      const id = pickSiteId(row);
      return !!id && (siteIds as string[]).includes(id);
    };

    const invScoped = invoices
      .filter(notDeleted)
      .filter(buyerOk)
      .filter(siteOk)
      .filter((row: any) => {
        const invDate = (row?.invoice_date ?? row?.date ?? pickDate(row) ?? "").slice(0, 10);
        return !!invDate && invDate <= end;
      });

    const receiptHeadersScoped = receiptHeaders
      .filter(notDeleted)
      .filter((row: any) => {
        const d = pickDate(row);
        return !!d && d.slice(0, 10) <= end;
      });

    const validReceiptHeaderIds = new Set(
      receiptHeadersScoped.map((h: any) => String(pickReceiptId(h) ?? "").trim()).filter(Boolean)
    );

    const receiptAppsScoped = receiptApps
      .filter(notDeleted)
      .filter((row: any) => {
        const hid = String(pickReceiptHeaderId(row) ?? "").trim();
        return hid ? validReceiptHeaderIds.has(hid) : false;
      });

    const receiptLinesScoped = receiptLines
      .filter(notDeleted)
      .filter((row: any) => {
        const hid = String(pickReceiptHeaderId(row) ?? "").trim();
        if (hid) return validReceiptHeaderIds.has(hid);
        const d = pickDate(row);
        return !!d && d.slice(0, 10) <= end;
      });

    const companyTermById = new Map<string, number>();
    const companyTermByName = new Map<string, number>();
    const companyTermByCode = new Map<string, number>();

    for (const c of companies.filter(notDeleted)) {
      const term = pickCompanyTermDays(c);
      if (!term) continue;
      const idKey = normKey(c?.id);
      const nameKey = normKey(c?.company_name ?? c?.name ?? c?.buyer_name);
      const codeKey = normKey(c?.company_code ?? c?.code ?? c?.buyer_code);
      if (idKey) companyTermById.set(idKey, term);
      if (nameKey) companyTermByName.set(nameKey, term);
      if (codeKey) companyTermByCode.set(codeKey, term);
    }

    const resolveInvoiceTermDays = (inv: any): number => {
      const direct = pickTermDays(inv);
      if (direct) return direct;

      const buyerIdKey = normKey(inv?.buyer_id ?? inv?.company_id);
      if (buyerIdKey && companyTermById.has(buyerIdKey)) return companyTermById.get(buyerIdKey)!;

      const buyerNameKey = normKey(inv?.buyer_name ?? inv?.company_name);
      if (buyerNameKey && companyTermByName.has(buyerNameKey)) return companyTermByName.get(buyerNameKey)!;

      const buyerCodeKey = normKey(inv?.buyer_code ?? inv?.company_code);
      if (buyerCodeKey && companyTermByCode.has(buyerCodeKey)) return companyTermByCode.get(buyerCodeKey)!;

      return 30;
    };

    const receiptHeaderById = new Map<string, any>();
    for (const h of receiptHeadersScoped) {
      const hid = String(pickReceiptId(h) ?? "").trim();
      if (hid) receiptHeaderById.set(hid, h);
    }

    const appliedByInvoiceId = new Map<string, number>();
    const appliedByInvoiceNo = new Map<string, number>();
    const settledByInvoiceId = new Map<string, number>();
    const settledByInvoiceNo = new Map<string, number>();

    const addApplied = (row: any) => {
      const amt = pickAppliedUSD(row);
      const writeoff = pickWriteoffUSD(row);
      const invId = String(pickInvoiceIdAny(row) ?? "").trim();
      const invNo = String(pickInvoiceNoAny(row) ?? "").trim();
      if (amt > 0) {
        if (invId) appliedByInvoiceId.set(invId, (appliedByInvoiceId.get(invId) || 0) + amt);
        if (invNo) appliedByInvoiceNo.set(invNo, (appliedByInvoiceNo.get(invNo) || 0) + amt);
      }
      if (writeoff > 0) {
        if (invId) settledByInvoiceId.set(invId, (settledByInvoiceId.get(invId) || 0) + writeoff);
        if (invNo) settledByInvoiceNo.set(invNo, (settledByInvoiceNo.get(invNo) || 0) + writeoff);
      }
    };

    receiptAppsScoped.forEach(addApplied);
    receiptLinesScoped.forEach(addApplied);

    const receiptLinesByHeaderId = new Map<string, any[]>();
    for (const line of receiptLinesScoped) {
      const hid = String(pickReceiptHeaderId(line) ?? "").trim();
      if (!hid) continue;
      const arr = receiptLinesByHeaderId.get(hid) || [];
      arr.push(line);
      receiptLinesByHeaderId.set(hid, arr);
    }

    for (const [headerId, rows] of receiptLinesByHeaderId.entries()) {
      const header = receiptHeaderById.get(headerId);
      if (!header) continue;

      const totalAppliedForHeader = rows.reduce((sum, row) => sum + pickAppliedUSD(row), 0);
      if (totalAppliedForHeader <= 0) continue;

      for (const row of rows) {
        const applied = pickAppliedUSD(row);
        if (applied <= 0) continue;

        const ratio = applied / totalAppliedForHeader;
        const allocatedOurFee = ratio * Number(header?.bank_fee_amount || 0);
        const allocatedBuyerFee =
          ratio *
          (Number(header?.buyer_bank_fee_amount || 0) +
            Number(header?.buyer_wire_fee_writeoff_amount || 0));
        const allocatedClaim = ratio * Number(header?.claim_deduction_amount || 0);
        const settledExtra = allocatedOurFee + allocatedBuyerFee + allocatedClaim;

        const invId = String(pickInvoiceIdAny(row) ?? "").trim();
        const invNo = String(pickInvoiceNoAny(row) ?? "").trim();

        if (settledExtra > 0) {
          if (invId) {
            settledByInvoiceId.set(invId, (settledByInvoiceId.get(invId) || 0) + settledExtra);
          }
          if (invNo) {
            settledByInvoiceNo.set(invNo, (settledByInvoiceNo.get(invNo) || 0) + settledExtra);
          }
        }
      }
    }

    const today = end;

    const detailRowsAll = invScoped
      .map((r) => {
        const invId = String(r?.id ?? "").trim() || null;
        const invNo = String(pickInvoiceNo(r) ?? "").trim() || null;
        const invDate = (r?.invoice_date ?? r?.date ?? pickDate(r) ?? "").slice(0, 10) || null;
        const due = (r?.due_date ?? r?.invoice_due_date ?? null) as string | null;
        const termDays = resolveInvoiceTermDays(r);
        const dueISO = due ? due.slice(0, 10) : (invDate ? addDaysISO(invDate, termDays) : null);
        const overdue = dueISO
          ? Math.floor((new Date(today).getTime() - new Date(dueISO).getTime()) / 86400000)
          : 0;

        const gross = pickInvoiceGrossUSD(r);
        const explicitBalance = Number(r?.balance_amount ?? r?.balance_usd);
        const explicitPaid = Number(r?.paid_amount);
        const applied = Math.max(
          invId ? (appliedByInvoiceId.get(invId) || 0) : 0,
          invNo ? (appliedByInvoiceNo.get(invNo) || 0) : 0,
          Number.isFinite(explicitPaid) ? explicitPaid : 0
        );
        const settled = applied + Math.max(
          invId ? (settledByInvoiceId.get(invId) || 0) : 0,
          invNo ? (settledByInvoiceNo.get(invNo) || 0) : 0
        );
        const fallbackBalance = Math.max(0, gross - settled);
        const hasComputedSettlement = settled > 0.0001;
        const balance =
          hasComputedSettlement
            ? fallbackBalance
            : Number.isFinite(explicitBalance) && explicitBalance > 0
              ? explicitBalance
              : fallbackBalance;
        const bucket = bucketOf(overdue);

        return {
          buyer_id: pickBuyerId(r),
          buyer_name: pickBuyerName(r),
          buyer_code: pickBuyerCode(r),
          invoice_id: invId,
          invoice_no: invNo,
          invoice_date: invDate,
          due_date: dueISO,
          payment_term_days: termDays,
          overdue_days: overdue,
          gross_usd: Number(gross.toFixed(2)),
          explicit_balance_usd: Number((Number.isFinite(explicitBalance) ? explicitBalance : 0).toFixed(2)),
          applied_usd: Number(applied.toFixed(2)),
          settled_usd: Number(settled.toFixed(2)),
          fallback_balance_usd: Number(fallbackBalance.toFixed(2)),
          balance_usd: Number(balance.toFixed(2)),
          bucket,
        };
      })
      .filter((r) => !!r.invoice_no);

    const detailRows = detailRowsAll.filter((r) => (r.balance_usd || 0) > 0.0001);

    const summary = {
      current: 0,
      b1_30: 0,
      b31_60: 0,
      b61_90: 0,
      b90_plus: 0,
      total: 0,
      invoice_count: new Set(detailRows.map((r) => String(r.invoice_id || r.invoice_no || "")).filter(Boolean)).size,
    };

    for (const r of detailRows) {
      summary[r.bucket] += r.balance_usd;
      summary.total += r.balance_usd;
    }

    const grouped = new Map<string, {
      key: string;
      buyer_id: string | null;
      buyer_name: string | null;
      buyer_code: string | null;
      current: number;
      b1_30: number;
      b31_60: number;
      b61_90: number;
      b90_plus: number;
      total: number;
      invoice_count: number;
      max_overdue_days: number;
      invoice_keys: Set<string>;
    }>();

    for (const r of detailRows) {
      const key = buyerGroup === "buyer_code"
        ? (r.buyer_code || r.buyer_name || "UNKNOWN")
        : (r.buyer_name || r.buyer_code || "UNKNOWN");

      const cur = grouped.get(key) || {
        key,
        buyer_id: r.buyer_id,
        buyer_name: r.buyer_name,
        buyer_code: r.buyer_code,
        ...emptyBuckets(),
        total: 0,
        invoice_count: 0,
        max_overdue_days: -99999,
        invoice_keys: new Set<string>(),
      };

      cur[r.bucket] += r.balance_usd;
      cur.total += r.balance_usd;
      const invKey = String(r.invoice_id || r.invoice_no || "").trim();
      if (invKey && !cur.invoice_keys.has(invKey)) {
        cur.invoice_keys.add(invKey);
        cur.invoice_count += 1;
      }
      cur.max_overdue_days = Math.max(cur.max_overdue_days, r.overdue_days);
      grouped.set(key, cur);
    }

    const rows = Array.from(grouped.values())
      .map((r) => ({
        key: r.key,
        buyer_id: r.buyer_id,
        buyer_name: r.buyer_name,
        buyer_code: r.buyer_code,
        current: Number(r.current.toFixed(2)),
        b1_30: Number(r.b1_30.toFixed(2)),
        b31_60: Number(r.b31_60.toFixed(2)),
        b61_90: Number(r.b61_90.toFixed(2)),
        b90_plus: Number(r.b90_plus.toFixed(2)),
        total: Number(r.total.toFixed(2)),
        invoice_count: r.invoice_count,
        max_overdue_days: r.max_overdue_days,
      }))
      .sort((a, b) => {
        const riskA = a.b90_plus + a.b61_90 * 0.8 + a.b31_60 * 0.5 + a.b1_30 * 0.25;
        const riskB = b.b90_plus + b.b61_90 * 0.8 + b.b31_60 * 0.5 + b.b1_30 * 0.25;
        return (riskB - riskA) || (b.total - a.total) || String(a.key).localeCompare(String(b.key));
      });

    const topOverdueInvoices = detailRows
      .filter((r) => r.overdue_days > 0)
      .sort((a, b) => (b.overdue_days - a.overdue_days) || (b.balance_usd - a.balance_usd))
      .slice(0, 100);

    return NextResponse.json({
      filters_echo: {
        preset,
        start,
        end,
        buyer_ids: buyerIds === "ALL" ? "ALL" : (buyerIds as string[]),
        site_ids: siteIds === "ALL" ? "ALL" : (siteIds as string[]),
        group_by: buyerGroup,
      },
      buckets: {
        current: Number(summary.current.toFixed(2)),
        b1_30: Number(summary.b1_30.toFixed(2)),
        b31_60: Number(summary.b31_60.toFixed(2)),
        b61_90: Number(summary.b61_90.toFixed(2)),
        b90_plus: Number(summary.b90_plus.toFixed(2)),
        total: Number(summary.total.toFixed(2)),
        invoice_count: summary.invoice_count,
      },
      rows,
      outstanding_invoices: detailRows,
      top_overdue_invoices: topOverdueInvoices,
      meta: {
        detail_row_count: detailRows.length,
        unique_invoice_count: summary.invoice_count,
        source: "ar-aging-unified-with-receipts",
        debug_counts: debug ? {
          invoices_raw: invoices.length,
          invoices_scoped_asof: invScoped.length,
          receipts_raw: receiptHeaders.length,
          receipts_scoped_asof: receiptHeadersScoped.length,
          receipt_apps_raw: receiptApps.length,
          receipt_apps_scoped: receiptAppsScoped.length,
          receipt_lines_raw: receiptLines.length,
          receipt_lines_scoped: receiptLinesScoped.length,
          detail_rows_all: detailRowsAll.length,
          detail_rows_positive_balance: detailRows.length,
          grouped_rows: rows.length,
          filter_window_start: start,
          filter_window_end: end,
        } : undefined,
        debug_samples: debug ? detailRowsAll.slice(0, 100).map((r) => ({
          invoice_no: r.invoice_no,
          gross_usd: r.gross_usd,
          explicit_balance_usd: r.explicit_balance_usd,
          applied_usd: r.applied_usd,
          fallback_balance_usd: r.fallback_balance_usd,
          final_balance_usd: r.balance_usd,
        })) : undefined,
        missing_tables: {
          invoice_headers: invRes.error ? invRes.error.message : null,
          receipt_headers: rchRes.error ? rchRes.error.message : null,
          receipt_applications: rcaRes.error ? rcaRes.error.message : null,
          receipt_lines: rclRes.error ? rclRes.error.message : null,
          companies: companiesRes.error ? companiesRes.error.message : null,
        },
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || String(e), hint: e?.hint, details: e?.details, code: e?.code },
      { status: 500 }
    );
  }
}
