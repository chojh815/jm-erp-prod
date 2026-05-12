"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type DevRole = AppRole;

type BuyerRow = {
  id: string;
  company_name?: string | null;
  code?: string | null;
  company_type?: string | null;
};

type BankAccountRow = {
  id: string;
  account_name?: string | null;
  currency?: string | null;
};

type UnpaidInvoice = {
  invoice_id: string;
  invoice_no: string;
  invoice_date?: string | null;
  total_amount: number;
  received_amount: number;
  balance: number;
};

type ReceiptDetail = {
  invoice_id?: string | null;
  invoice_no?: string | null;
  invoice_date?: string | null;
  invoice_total?: number;
  invoice_paid?: number;
  invoice_balance?: number;
  applied_amount?: number;
  writeoff_amount?: number;
  allocated_our_fee?: number;
  allocated_buyer_fee?: number;
  allocated_claim_deduction?: number;
  settled_amount?: number;
};

type ReceiptRow = {
  id: string;
  buyer_id?: string | null;
  buyer_name?: string | null;
  buyer_code?: string | null;
  deposit_date?: string | null;
  receipt_date?: string | null;
  reference_no?: string | null;
  method?: string | null;
  note?: string | null;
  total_received?: number;
  received_amount?: number;
  bank_fee_amount?: number;
  buyer_bank_fee_amount?: number;
  buyer_wire_fee_writeoff_amount?: number;
  claim_deduction_amount?: number;
  net_received_amount?: number;
  applied_total?: number;
  line_writeoff_total?: number;
  settled_total?: number;
  invoice_ids?: string[];
  invoice_no?: string | null;
  created_at?: string | null;
  details?: ReceiptDetail[];
};

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function fmt2(n: number) {
  return round2(n).toFixed(2);
}

function clampMoneyInput(s: string) {
  const cleaned = s.replace(/[^0-9.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length === 1) return parts[0];
  return `${parts[0]}.${(parts[1] ?? "").slice(0, 2)}`;
}

function shortDate(s?: string | null) {
  if (!s) return "";
  return String(s).slice(0, 10);
}

function csvEscape(v: unknown) {
  const s = v === null || v === undefined ? "" : String(v);
  const needs = /[",\n\r]/.test(s);
  const body = s.replace(/"/g, '""');
  return needs ? `"${body}"` : body;
}

function downloadText(filename: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function normalizeUnpaidInvoice(r: any): UnpaidInvoice {
  return {
    invoice_id: String(r.invoice_id ?? r.id),
    invoice_no: String(r.invoice_no ?? r.no ?? ""),
    invoice_date: (r.invoice_date ?? r.created_at ?? null) as any,
    total_amount: toNum(r.total_amount),
    received_amount: toNum(r.received_amount ?? r.paid_amount),
    balance: toNum(r.balance ?? r.balance_amount),
  };
}

function mergeReceiptDetailsIntoUnpaid(rows: UnpaidInvoice[], details: ReceiptDetail[]): UnpaidInvoice[] {
  const byId = new Map(rows.map((r) => [r.invoice_id, r]));

  for (const detail of details || []) {
    const invoiceId = String(detail.invoice_id || "");
    if (!invoiceId || byId.has(invoiceId)) continue;

    const applied = toNum(detail.applied_amount);
    const balance = toNum(detail.invoice_balance);
    const total = toNum(detail.invoice_total);
    const paid = toNum(detail.invoice_paid);

    byId.set(invoiceId, {
      invoice_id: invoiceId,
      invoice_no: String(detail.invoice_no || ""),
      invoice_date: detail.invoice_date ?? null,
      total_amount: total,
      received_amount: Math.max(0, round2(paid - applied)),
      balance: round2(balance + applied),
    });
  }

  return Array.from(byId.values());
}

export default function ReceiptsPage() {
  const role: DevRole = "admin" as DevRole;
  const router = useRouter();
  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);
  const skipBuyerReloadRef = React.useRef(false);

  const [buyers, setBuyers] = React.useState<BuyerRow[]>([]);
  const [buyersLoading, setBuyersLoading] = React.useState(false);
  const [buyerId, setBuyerId] = React.useState("");

  const [banks, setBanks] = React.useState<BankAccountRow[]>([]);
  const [banksLoading, setBanksLoading] = React.useState(false);
  const [bankAccountId, setBankAccountId] = React.useState("");

  const [depositDate, setDepositDate] = React.useState<string>(todayISODate());
  const [totalReceivedStr, setTotalReceivedStr] = React.useState<string>("");
  const [bankFeeStr, setBankFeeStr] = React.useState<string>("0.00");
  const [buyerBankFeeStr, setBuyerBankFeeStr] = React.useState<string>("0.00");
  const [claimDeductionStr, setClaimDeductionStr] = React.useState<string>("0.00");

  const [method, setMethod] = React.useState<string>("WIRE");
  const [referenceNo, setReferenceNo] = React.useState<string>("");
  const [note, setNote] = React.useState<string>("");

  const [unpaid, setUnpaid] = React.useState<UnpaidInvoice[]>([]);
  const [unpaidLoading, setUnpaidLoading] = React.useState(false);

  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  const [applyAmount, setApplyAmount] = React.useState<Record<string, string>>({});

  const [receipts, setReceipts] = React.useState<ReceiptRow[]>([]);
  const [receiptsLoading, setReceiptsLoading] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string>("");
  const [editingReceiptId, setEditingReceiptId] = React.useState<string>("");
  const [loadingEditId, setLoadingEditId] = React.useState<string>("");

  const [saving, setSaving] = React.useState(false);
  const [lastSavedReceiptId, setLastSavedReceiptId] = React.useState<string>("");
  const [errorMsg, setErrorMsg] = React.useState("");
  const [okMsg, setOkMsg] = React.useState("");

  const totalReceived = React.useMemo(() => round2(toNum(totalReceivedStr)), [totalReceivedStr]);
  const bankFee = React.useMemo(() => round2(toNum(bankFeeStr)), [bankFeeStr]);
  const buyerBankFee = React.useMemo(() => round2(toNum(buyerBankFeeStr)), [buyerBankFeeStr]);
  const claimDeduction = React.useMemo(() => round2(toNum(claimDeductionStr)), [claimDeductionStr]);

  const netReceived = React.useMemo(() => {
    return round2(totalReceived - bankFee - buyerBankFee - claimDeduction);
  }, [totalReceived, bankFee, buyerBankFee, claimDeduction]);

  const appliedTotal = React.useMemo(() => {
    let s = 0;
    for (const inv of unpaid) s += toNum(applyAmount[inv.invoice_id]);
    return round2(s);
  }, [applyAmount, unpaid]);

  const diff = React.useMemo(() => round2(netReceived - appliedTotal), [netReceived, appliedTotal]);
  const hasMismatch = React.useMemo(() => Math.abs(diff) > 0.01, [diff]);

  const selectedCount = React.useMemo(() => {
    return unpaid.reduce((acc, u) => acc + (selected[u.invoice_id] ? 1 : 0), 0);
  }, [unpaid, selected]);

  const selectedBalanceTotal = React.useMemo(() => {
    let s = 0;
    for (const inv of unpaid) {
      if (selected[inv.invoice_id]) {
        s += inv.balance;
      }
    }
    return round2(s);
  }, [unpaid, selected]);

  const canSave = React.useMemo(() => {
    if (!buyerId) return false;
    if (saving) return false;
    if (totalReceived <= 0) return false;
    if (netReceived <= 0) return false;
    return selectedCount > 0;
  }, [buyerId, saving, totalReceived, netReceived, selectedCount]);

  const loadBuyers = React.useCallback(async () => {
    setBuyersLoading(true);
    setErrorMsg("");
    try {
      let data: any[] | null = null;
      {
        const r = await supabase
          .from("companies")
          .select("id, company_name, code, company_type, is_deleted")
          .eq("is_deleted", false)
          .order("company_name", { ascending: true });

        if (!r.error) {
          data = (r.data || []) as any[];
        } else {
          const msg = String((r.error as any)?.message || "");
          if (msg.toLowerCase().includes("companies.is_deleted") && msg.toLowerCase().includes("does not exist")) {
            const r2 = await supabase
              .from("companies")
              .select("id, company_name, code, company_type")
              .order("company_name", { ascending: true });
            if (r2.error) throw r2.error;
            data = (r2.data || []) as any[];
          } else {
            throw r.error;
          }
        }
      }

      const rows = ((data || []) as any[]).filter((x) => /buyer/i.test(String(x?.company_type || "")));
      setBuyers(
        rows.map((r) => ({
          id: String(r.id),
          company_name: r.company_name ?? null,
          code: r.code ?? null,
          company_type: r.company_type ?? null,
        }))
      );
    } catch (e: any) {
      console.error(e);
      setBuyers([]);
      setErrorMsg((prev) => prev || e?.message || "Failed to load buyers");
    } finally {
      setBuyersLoading(false);
    }
  }, [supabase]);

  const loadBanks = React.useCallback(async () => {
    setBanksLoading(true);
    setErrorMsg("");
    try {
      const res = await fetch("/api/bank-accounts/list?active_only=1&include_any=1", {
        method: "GET",
        cache: "no-store",
      });

      if (!res.ok) {
        setBanks([]);
        return;
      }

      const j: any = await res.json();
      const rows = (Array.isArray(j) ? j : null) ?? j.data ?? j.rows ?? j.items ?? [];

      setBanks(
        (rows || []).map((r: any) => ({
          id: String(r.id),
          account_name: r.account_name ?? r.accountName ?? null,
          currency: r.currency ?? r.ccy ?? null,
        }))
      );
    } catch (e: any) {
      setBanks([]);
      setErrorMsg((prev) => prev || e?.message || "Failed to load bank accounts");
    } finally {
      setBanksLoading(false);
    }
  }, []);

  const resetApply = React.useCallback(() => {
    setSelected({});
    setApplyAmount({});
  }, []);

  const fetchUnpaidInvoices = React.useCallback(async (bId: string) => {
    const res = await fetch(`/api/receipts/bulk/unpaid?buyer_id=${encodeURIComponent(bId)}`, {
      method: "GET",
      cache: "no-store",
    });

    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j?.error || `Failed to load unpaid invoices (${res.status})`);
    }

    const j = await res.json().catch(() => ({}));
    const rows = (j?.items || j?.rows || j?.data || []) as any[];
    return rows.map(normalizeUnpaidInvoice);
  }, []);

  const clearForm = React.useCallback(() => {
    setEditingReceiptId("");
    setTotalReceivedStr("");
    setBankFeeStr("0.00");
    setBuyerBankFeeStr("0.00");
    setClaimDeductionStr("0.00");
    setReferenceNo("");
    setNote("");
    resetApply();
  }, [resetApply]);

  const loadUnpaid = React.useCallback(
    async (bId: string) => {
      if (!bId) {
        setUnpaid([]);
        resetApply();
        return;
      }

      setUnpaidLoading(true);
      setErrorMsg("");
      try {
        setUnpaid(await fetchUnpaidInvoices(bId));
        resetApply();
      } catch (e: any) {
        console.error(e);
        setUnpaid([]);
        resetApply();
        setErrorMsg((prev) => prev || e?.message || "Failed to load unpaid invoices");
      } finally {
        setUnpaidLoading(false);
      }
    },
    [fetchUnpaidInvoices, resetApply]
  );

  const loadReceipts = React.useCallback(async (bId: string) => {
    setReceiptsLoading(true);
    setErrorMsg("");
    try {
      const qs = new URLSearchParams();
      qs.set("limit", "200");
      if (bId) qs.set("buyer_id", bId);
      const res = await fetch(`/api/receipts?${qs.toString()}`, {
        method: "GET",
        cache: "no-store",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed to load receipts (${res.status})`);
      setReceipts((j?.rows || j?.items || j?.data || []) as ReceiptRow[]);
    } catch (e: any) {
      console.error(e);
      setReceipts([]);
      setErrorMsg((prev) => prev || e?.message || "Failed to load receipts");
    } finally {
      setReceiptsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadBuyers();
    void loadBanks();
  }, [loadBuyers, loadBanks]);

  React.useEffect(() => {
    if (skipBuyerReloadRef.current) {
      skipBuyerReloadRef.current = false;
      return;
    }
    void loadUnpaid(buyerId);
    void loadReceipts(buyerId);
  }, [buyerId, loadUnpaid, loadReceipts]);

  React.useEffect(() => {
    if (!errorMsg) return;
    if (!errorMsg.startsWith("Apply total")) return;
    setErrorMsg("");
  }, [buyerId, totalReceivedStr, bankFeeStr, buyerBankFeeStr, claimDeductionStr, appliedTotal, netReceived, errorMsg]);

  const openReceiptPdf = React.useCallback((receiptId: string) => {
    if (!receiptId) return;
    window.open(`/receipts/${encodeURIComponent(receiptId)}/pdf`, "_blank", "noopener,noreferrer");
  }, []);

  const exportExcelCSV = React.useCallback(() => {
    const buyer = buyers.find((b) => b.id === buyerId);
    const bank = banks.find((b) => b.id === bankAccountId);

    const buyerLabel = `${buyer?.company_name || ""}${buyer?.code ? ` (${buyer.code})` : ""}`.trim();
    const bankLabel = `${bank?.account_name || ""}${bank?.currency ? ` (${bank.currency})` : ""}`.trim();

    const lines: string[] = [];
    lines.push(["Section", "Field", "Value"].map(csvEscape).join(","));
    lines.push(["Receipt", "Buyer", buyerLabel].map(csvEscape).join(","));
    lines.push(["Receipt", "Deposit Date", depositDate].map(csvEscape).join(","));
    lines.push(["Receipt", "Bank Account", bankLabel].map(csvEscape).join(","));
    lines.push(["Receipt", "Method", method].map(csvEscape).join(","));
    lines.push(["Receipt", "Reference No", referenceNo].map(csvEscape).join(","));
    lines.push(["Receipt", "Note", note].map(csvEscape).join(","));
    lines.push(["Amounts", "Total Received (Gross)", fmt2(totalReceived)].map(csvEscape).join(","));
    lines.push(["Amounts", "Bank Fee (Our Bank)", fmt2(bankFee)].map(csvEscape).join(","));
    lines.push(["Amounts", "Bank Fee (Buyer Bank)", fmt2(buyerBankFee)].map(csvEscape).join(","));
    lines.push(["Amounts", "Claim Deduction", fmt2(claimDeduction)].map(csvEscape).join(","));
    lines.push(["Amounts", "Net Received", fmt2(netReceived)].map(csvEscape).join(","));
    lines.push(["Summary", "Applied Total", fmt2(appliedTotal)].map(csvEscape).join(","));
    lines.push(["Summary", "Diff (Net - Applied)", fmt2(diff)].map(csvEscape).join(","));
    lines.push("");
    lines.push(["invoice_id", "invoice_no", "invoice_date", "invoice_total", "invoice_balance", "selected", "apply_amount"].map(csvEscape).join(","));
    for (const inv of unpaid) {
      lines.push([
        inv.invoice_id,
        inv.invoice_no,
        shortDate(inv.invoice_date),
        fmt2(inv.total_amount),
        fmt2(inv.balance),
        selected[inv.invoice_id] ? "Y" : "",
        fmt2(toNum(applyAmount[inv.invoice_id])),
      ].map(csvEscape).join(","));
    }

    const code = buyer?.code ? String(buyer.code) : "BUYER";
    downloadText(`receipts_${code}_${depositDate || todayISODate()}.csv`, lines.join("\n"));
  }, [buyers, buyerId, banks, bankAccountId, depositDate, method, referenceNo, note, totalReceived, bankFee, buyerBankFee, claimDeduction, netReceived, appliedTotal, diff, unpaid, selected, applyAmount]);

  const exportReceiptsCSV = React.useCallback(() => {
    const buyer = buyers.find((b) => b.id === buyerId);
    const code = buyer?.code ? String(buyer.code) : "ALL";
    const lines: string[] = [];
    lines.push([
      "deposit_date",
      "buyer_name",
      "buyer_code",
      "method",
      "reference_no",
      "invoice_no",
      "invoice_date",
      "invoice_total",
      "applied_amount",
      "writeoff_amount",
      "allocated_our_fee",
      "allocated_buyer_fee",
      "allocated_claim_deduction",
      "settled_amount",
      "note",
      "created_at",
    ].map(csvEscape).join(","));

    for (const row of receipts) {
      const details = Array.isArray(row.details) && row.details.length > 0
        ? row.details
        : [{
            invoice_id: row.invoice_ids?.[0] ?? null,
            invoice_no: row.invoice_no ?? null,
            invoice_date: null,
            invoice_total: 0,
            applied_amount: toNum(row.applied_total),
            writeoff_amount: toNum(row.line_writeoff_total),
            allocated_our_fee: toNum(row.bank_fee_amount),
            allocated_buyer_fee: toNum(row.buyer_bank_fee_amount),
            allocated_claim_deduction: toNum(row.claim_deduction_amount),
            settled_amount: toNum(row.settled_total),
          }];

      for (const d of details) {
        lines.push([
          shortDate(row.deposit_date || row.receipt_date),
          row.buyer_name || "",
          row.buyer_code || "",
          row.method || "",
          row.reference_no || "",
          d.invoice_no || "",
          shortDate(d.invoice_date),
          fmt2(toNum(d.invoice_total)),
          fmt2(toNum(d.applied_amount)),
          fmt2(toNum(d.writeoff_amount)),
          fmt2(toNum(d.allocated_our_fee)),
          fmt2(toNum(d.allocated_buyer_fee)),
          fmt2(toNum(d.allocated_claim_deduction)),
          fmt2(toNum(d.settled_amount)),
          row.note || "",
          row.created_at || "",
        ].map(csvEscape).join(","));
      }
    }

    downloadText(`receipt_history_detail_${code}_${todayISODate()}.csv`, lines.join("\n"));
  }, [buyers, buyerId, receipts]);

  const toggleAll = React.useCallback(() => {
    const next: Record<string, boolean> = {};
    for (const inv of unpaid) next[inv.invoice_id] = true;
    setSelected(next);
  }, [unpaid]);

  const clearAll = React.useCallback(() => {
    resetApply();
  }, [resetApply]);

  const onCancelEdit = React.useCallback(() => {
    setOkMsg("");
    setErrorMsg("");
    clearForm();
    void Promise.all([loadUnpaid(buyerId), loadReceipts(buyerId)]);
  }, [buyerId, clearForm, loadUnpaid, loadReceipts]);

  const onEditReceipt = React.useCallback(async (receiptId: string) => {
    if (!receiptId) return;

    setLoadingEditId(receiptId);
    setErrorMsg("");
    setOkMsg("");
    try {
      const res = await fetch(`/api/receipts/${encodeURIComponent(receiptId)}`, {
        method: "GET",
        cache: "no-store",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed to load receipt (${res.status})`);

      const row = (j?.row || {}) as ReceiptRow;
      const nextBuyerId = String(row.buyer_id || "");
      if (!nextBuyerId) throw new Error("Receipt buyer is missing.");

      const details = Array.isArray(row.details) ? row.details : [];
      const baseUnpaid = await fetchUnpaidInvoices(nextBuyerId);
      const mergedUnpaid = mergeReceiptDetailsIntoUnpaid(baseUnpaid, details);

      const nextSelected: Record<string, boolean> = {};
      const nextApplyAmount: Record<string, string> = {};
      for (const detail of details) {
        const invoiceId = String(detail.invoice_id || "");
        const applied = round2(toNum(detail.applied_amount));
        if (!invoiceId || applied <= 0) continue;
        nextSelected[invoiceId] = true;
        nextApplyAmount[invoiceId] = fmt2(applied);
      }

      if (nextBuyerId !== buyerId) {
        skipBuyerReloadRef.current = true;
        setBuyerId(nextBuyerId);
      }
      setEditingReceiptId(receiptId);
      setBankAccountId(String((row as any).bank_account_id || ""));
      setDepositDate(shortDate(row.deposit_date || row.receipt_date) || todayISODate());
      setTotalReceivedStr(fmt2(toNum(row.total_received ?? row.received_amount)));
      setBankFeeStr(fmt2(toNum(row.bank_fee_amount)));
      setBuyerBankFeeStr(fmt2(toNum(row.buyer_bank_fee_amount)));
      setClaimDeductionStr(fmt2(toNum(row.claim_deduction_amount)));
      setMethod(String(row.method || "WIRE"));
      setReferenceNo(String(row.reference_no || ""));
      setNote(String(row.note || ""));
      setUnpaid(mergedUnpaid);
      setSelected(nextSelected);
      setApplyAmount(nextApplyAmount);
      setOkMsg("Receipt loaded for edit.");
      void loadReceipts(nextBuyerId);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message || "Failed to load receipt");
    } finally {
      setLoadingEditId("");
    }
  }, [buyerId, fetchUnpaidInvoices, loadReceipts]);

  const allocateFromTotal = React.useCallback(() => {
    const selectedInvoices = unpaid.filter((u) => selected[u.invoice_id]);
    if (selectedInvoices.length === 0) return;

    let remaining = netReceived;
    const nextApply: Record<string, string> = { ...applyAmount };

    for (const inv of selectedInvoices) {
      if (remaining <= 0) {
        nextApply[inv.invoice_id] = "0.00";
        continue;
      }
      const amt = Math.min(inv.balance, remaining);
      remaining = round2(remaining - amt);
      nextApply[inv.invoice_id] = fmt2(amt);
    }
    setApplyAmount(nextApply);
  }, [unpaid, selected, netReceived, applyAmount]);

  const onSave = React.useCallback(async () => {
    setErrorMsg("");
    setOkMsg("");

    if (!buyerId) return setErrorMsg("Please select a buyer.");
    if (totalReceived <= 0) return setErrorMsg("Total Received must be greater than 0.");
    if (netReceived <= 0) return setErrorMsg("Net Received must be greater than 0.");
    if (hasMismatch) return setErrorMsg(`Apply total (${fmt2(appliedTotal)}) must equal Net Received (${fmt2(netReceived)}).`);

    const allocations = unpaid
      .filter((u) => toNum(applyAmount[u.invoice_id]) > 0)
      .map((u) => ({ invoice_id: u.invoice_id, apply_amount: round2(toNum(applyAmount[u.invoice_id])) }));

    if (allocations.length === 0) return setErrorMsg("No applied amounts.");

    setSaving(true);
    try {
      const payload = {
        buyer_id: buyerId,
        bank_account_id: bankAccountId || null,
        deposit_date: depositDate,
        total_received_amount: totalReceived,
        bank_fee_amount: bankFee,
        buyer_bank_fee_amount: buyerBankFee,
        claim_deduction_amount: claimDeduction,
        net_received_amount: netReceived,
        method,
        reference_no: referenceNo || null,
        note: note || null,
        allocations,
      };

      const res = await fetch(
        editingReceiptId
          ? `/api/receipts/${encodeURIComponent(editingReceiptId)}`
          : "/api/receipts/bulk/apply",
        {
        method: editingReceiptId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Save failed (${res.status})`);

      const savedId =
        (j?.receipt_id as string | undefined) ||
        (j?.receipt_header_id as string | undefined) ||
        (j?.id as string | undefined) ||
        (j?.header?.id as string | undefined);

      if (savedId) {
        setLastSavedReceiptId(savedId);
      }

      setOkMsg(editingReceiptId ? "Updated." : "Saved.");
      clearForm();
      await Promise.all([loadUnpaid(buyerId), loadReceipts(buyerId)]);
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }, [buyerId, totalReceived, netReceived, hasMismatch, appliedTotal, unpaid, applyAmount, bankAccountId, depositDate, bankFee, buyerBankFee, claimDeduction, method, referenceNo, note, editingReceiptId, clearForm, loadUnpaid, loadReceipts]);

  const onDeleteReceipt = React.useCallback(async (receiptId: string) => {
    if (!receiptId) return;
    const ok = window.confirm("Delete this receipt? Applied amounts will be reversed and invoice balance will be recalculated.");
    if (!ok) return;

    setDeletingId(receiptId);
    setErrorMsg("");
    setOkMsg("");
    try {
      const res = await fetch(`/api/receipts/${encodeURIComponent(receiptId)}`, {
        method: "DELETE",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Delete failed (${res.status})`);
      setOkMsg("Receipt deleted.");
      if (lastSavedReceiptId === receiptId) setLastSavedReceiptId("");
      await Promise.all([loadReceipts(buyerId), loadUnpaid(buyerId)]);
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message || "Delete failed");
    } finally {
      setDeletingId("");
    }
  }, [buyerId, loadReceipts, loadUnpaid, lastSavedReceiptId]);

  return (
    <AppShell role={role}>
      <div className="p-4 space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>{editingReceiptId ? "Edit Receipt" : "Receipts (Bulk Apply)"}</CardTitle>
            <div className="flex items-center gap-2">
              {editingReceiptId && (
                <Button type="button" variant="secondary" onClick={onCancelEdit} disabled={saving}>
                  Cancel Edit
                </Button>
              )}
              <Button variant="secondary" onClick={exportExcelCSV} disabled={!buyerId}>
                Export Excel (CSV)
              </Button>
              <Button
                variant="secondary"
                onClick={() => openReceiptPdf(lastSavedReceiptId)}
                disabled={!lastSavedReceiptId}
                title={lastSavedReceiptId ? "Open last saved receipt PDF" : "Save a receipt first"}
              >
                PDF
              </Button>
              <Button onClick={onSave} disabled={!canSave}>
                {saving ? "Saving..." : editingReceiptId ? "Update Receipt" : "Save Deposit"}
              </Button>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {(errorMsg || okMsg) && (
              <div className={`text-sm ${errorMsg ? "text-red-600" : "text-green-600"}`}>{errorMsg || okMsg}</div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <div className="text-sm mb-1">Buyer</div>
                <select
                  className="w-full border rounded-md h-10 px-2 text-sm"
                  value={buyerId}
                  onChange={(e) => {
                    if (editingReceiptId) clearForm();
                    setBuyerId(e.target.value);
                  }}
                  disabled={buyersLoading || !!editingReceiptId}
                >
                  <option value="">{buyersLoading ? "Loading..." : "Select buyer"}</option>
                  {buyers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.company_name || "(No name)"} {b.code ? `(${b.code})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="text-sm mb-1">Bank Account (optional)</div>
                <select
                  className="w-full border rounded-md h-10 px-2 text-sm"
                  value={bankAccountId}
                  onChange={(e) => setBankAccountId(e.target.value)}
                  disabled={banksLoading || banks.length === 0}
                >
                  <option value="">{banksLoading ? "Loading..." : "Select bank account"}</option>
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.account_name || "(No name)"} {b.currency ? `(${b.currency})` : ""}
                    </option>
                  ))}
                </select>
                {banks.length === 0 && !banksLoading && (
                  <div className="text-xs text-muted-foreground mt-1">No bank accounts found (optional).</div>
                )}
              </div>

              <div>
                <div className="text-sm mb-1">Deposit Date</div>
                <Input type="date" value={depositDate} onChange={(e) => setDepositDate(e.target.value)} />
              </div>

              <div>
                <div className="text-sm mb-1">Total Received</div>
                <Input placeholder="0.00" value={totalReceivedStr} onChange={(e) => setTotalReceivedStr(clampMoneyInput(e.target.value))} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <div className="text-sm mb-1">Bank Fee (Our Bank)</div>
                <Input value={bankFeeStr} onChange={(e) => setBankFeeStr(clampMoneyInput(e.target.value))} />
              </div>
              <div>
                <div className="text-sm mb-1">Bank Fee (Buyer Bank)</div>
                <Input value={buyerBankFeeStr} onChange={(e) => setBuyerBankFeeStr(clampMoneyInput(e.target.value))} />
              </div>
              <div>
                <div className="text-sm mb-1">Claim Deduction</div>
                <Input value={claimDeductionStr} onChange={(e) => setClaimDeductionStr(clampMoneyInput(e.target.value))} />
              </div>
              <div>
                <div className="text-sm mb-1">Net Received</div>
                <Input value={fmt2(netReceived)} disabled />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <div className="text-sm mb-1">Method</div>
                <Input value={method} onChange={(e) => setMethod(e.target.value)} />
              </div>
              <div>
                <div className="text-sm mb-1">Reference No</div>
                <Input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} placeholder="Bank ref / transaction id" />
              </div>
              <div>
                <div className="text-sm mb-1">Note</div>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={toggleAll} disabled={unpaid.length === 0}>
                  Select All
                </Button>
                <Button type="button" variant="secondary" onClick={clearAll} disabled={unpaid.length === 0}>
                  Clear
                </Button>
                <Button type="button" variant="secondary" onClick={allocateFromTotal} disabled={unpaid.length === 0 || netReceived <= 0}>
                  Allocate From Net
                </Button>
              </div>

              <div className="flex gap-2 text-sm">
                <span className="px-3 py-1 rounded-full bg-muted">
                  Selected: {selectedCount} ({fmt2(selectedBalanceTotal)})
                </span>
                <span className="px-3 py-1 rounded-full bg-muted">Applied: {fmt2(appliedTotal)}</span>
                <span className={`px-3 py-1 rounded-full ${hasMismatch ? "bg-red-600 text-white" : "bg-muted"}`}>
                  Net: {fmt2(netReceived)} {hasMismatch ? `(diff ${fmt2(diff)})` : ""}
                </span>
              </div>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <div className="p-3 text-sm font-medium flex items-center justify-between">
                <span>Unpaid Invoices</span>
                <span className="text-xs text-muted-foreground">{unpaidLoading ? "Loading..." : `${unpaid.length} items`}</span>
              </div>

              <div className="w-full overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-2 w-10"></th>
                      <th className="text-left p-2 min-w-[180px]">Invoice No</th>
                      <th className="text-left p-2 min-w-[120px]">Date</th>
                      <th className="text-right p-2 min-w-[120px]">Total</th>
                      <th className="text-right p-2 min-w-[120px]">Paid</th>
                      <th className="text-right p-2 min-w-[120px]">Balance</th>
                      <th className="text-right p-2 min-w-[140px]">Apply</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unpaid.length === 0 ? (
                      <tr>
                        <td className="p-3 text-muted-foreground" colSpan={7}>
                          {buyerId ? (unpaidLoading ? "Loading..." : "No unpaid invoices.") : "Select a buyer to load invoices."}
                        </td>
                      </tr>
                    ) : (
                      unpaid.map((inv) => (
                        <tr key={inv.invoice_id} className="border-t">
                          <td className="p-2">
                            <input
                              type="checkbox"
                              checked={!!selected[inv.invoice_id]}
                              onChange={(e) => setSelected((prev) => ({ ...prev, [inv.invoice_id]: e.target.checked }))}
                            />
                          </td>
                          <td className="p-2">{inv.invoice_no}</td>
                          <td className="p-2">{shortDate(inv.invoice_date)}</td>
                          <td className="p-2 text-right">{fmt2(inv.total_amount)}</td>
                          <td className="p-2 text-right">{fmt2(inv.received_amount)}</td>
                          <td className="p-2 text-right">{fmt2(inv.balance)}</td>
                          <td className="p-2 text-right">
                            <Input
                              className="text-right"
                              value={applyAmount[inv.invoice_id] ?? ""}
                              onChange={(e) =>
                                setApplyAmount((prev) => ({
                                  ...prev,
                                  [inv.invoice_id]: clampMoneyInput(e.target.value),
                                }))
                              }
                              placeholder="0.00"
                            />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Saved Receipts</CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => loadReceipts(buyerId)} disabled={receiptsLoading}>
                Refresh
              </Button>
              <Button variant="secondary" onClick={exportReceiptsCSV} disabled={receipts.length === 0}>
                Export History (CSV)
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-hidden">
              <div className="p-3 text-sm font-medium flex items-center justify-between">
                <span>Receipt History</span>
                <span className="text-xs text-muted-foreground">
                  {receiptsLoading ? "Loading..." : buyerId ? `${receipts.length} items for selected buyer` : `${receipts.length} items`}
                </span>
              </div>
              <div className="w-full overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-2 min-w-[110px]">Deposit Date</th>
                      <th className="text-left p-2 min-w-[170px]">Buyer</th>
                      <th className="text-left p-2 min-w-[110px]">Method</th>
                      <th className="text-left p-2 min-w-[150px]">Reference</th>
                      <th className="text-right p-2 min-w-[120px]">Gross</th>
                      <th className="text-right p-2 min-w-[110px]">Our Fee</th>
                      <th className="text-right p-2 min-w-[110px]">Buyer Fee</th>
                      <th className="text-right p-2 min-w-[110px]">Claim</th>
                      <th className="text-right p-2 min-w-[110px]">Net</th>
                      <th className="text-right p-2 min-w-[110px]">Applied</th>
                      <th className="text-right p-2 min-w-[110px]">Settled</th>
                      <th className="text-center p-2 min-w-[100px]">Invoices</th>
                      <th className="text-left p-2 min-w-[180px]">Note</th>
                      <th className="text-center p-2 min-w-[260px]">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipts.length === 0 ? (
                      <tr>
                        <td className="p-3 text-muted-foreground" colSpan={14}>
                          {receiptsLoading ? "Loading..." : "No receipts found."}
                        </td>
                      </tr>
                    ) : (
                      receipts.map((row) => {
                        const invoiceCount = Array.isArray(row.invoice_ids) ? row.invoice_ids.length : 0;
                        return (
                          <tr key={row.id} className="border-t align-top">
                            <td className="p-2">{shortDate(row.deposit_date || row.receipt_date)}</td>
                            <td className="p-2">
                              <div>{row.buyer_name || "-"}</div>
                              <div className="text-xs text-muted-foreground">{row.buyer_code || ""}</div>
                            </td>
                            <td className="p-2">{row.method || "-"}</td>
                            <td className="p-2">{row.reference_no || "-"}</td>
                            <td className="p-2 text-right">{fmt2(toNum(row.total_received ?? row.received_amount))}</td>
                            <td className="p-2 text-right">{fmt2(toNum(row.bank_fee_amount))}</td>
                            <td className="p-2 text-right">{fmt2(toNum(row.buyer_bank_fee_amount))}</td>
                            <td className="p-2 text-right">{fmt2(toNum(row.claim_deduction_amount))}</td>
                            <td className="p-2 text-right">{fmt2(toNum(row.net_received_amount))}</td>
                            <td className="p-2 text-right">{fmt2(toNum(row.applied_total))}</td>
                            <td className="p-2 text-right">{fmt2(toNum(row.settled_total))}</td>
                            <td className="p-2 text-center">{invoiceCount}</td>
                            <td className="p-2">{row.note || "-"}</td>
                            <td className="p-2">
                              <div className="flex justify-center gap-2">
                                <Button
                                  type="button"
                                  variant="secondary"
                                  onClick={() => onEditReceipt(row.id)}
                                  disabled={loadingEditId === row.id || saving}
                                >
                                  {loadingEditId === row.id ? "Loading..." : "Edit"}
                                </Button>
                                <Button type="button" variant="secondary" onClick={() => openReceiptPdf(row.id)}>
                                  PDF
                                </Button>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  onClick={() => onDeleteReceipt(row.id)}
                                  disabled={deletingId === row.id}
                                >
                                  {deletingId === row.id ? "Deleting..." : "Delete"}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
