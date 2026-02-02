"use client";

import * as React from "react";

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

function todayISODate() {
  // yyyy-mm-dd
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

export default function ReceiptsPage() {
  // NOTE: role comes from your global permissions system; keep simple here
  const role: DevRole = "admin" as DevRole;

  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);

  const [buyers, setBuyers] = React.useState<BuyerRow[]>([]);
  const [buyersLoading, setBuyersLoading] = React.useState(false);
  const [buyerId, setBuyerId] = React.useState("");

  const [banks, setBanks] = React.useState<BankAccountRow[]>([]);
  const [banksLoading, setBanksLoading] = React.useState(false);
  const [bankAccountId, setBankAccountId] = React.useState("");

  const [depositDate, setDepositDate] = React.useState<string>(todayISODate());

  // A안: 3 reasons fixed
  const [totalReceivedStr, setTotalReceivedStr] = React.useState<string>("");
  const [bankFeeStr, setBankFeeStr] = React.useState<string>("0.00"); // Our bank
  const [buyerBankFeeStr, setBuyerBankFeeStr] = React.useState<string>("0.00"); // Buyer bank
  const [claimDeductionStr, setClaimDeductionStr] = React.useState<string>("0.00");

  const [method, setMethod] = React.useState<string>("WIRE");
  const [referenceNo, setReferenceNo] = React.useState<string>("");
  const [note, setNote] = React.useState<string>("");

  const [unpaid, setUnpaid] = React.useState<UnpaidInvoice[]>([]);
  const [unpaidLoading, setUnpaidLoading] = React.useState(false);

  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  const [applyAmount, setApplyAmount] = React.useState<Record<string, string>>({});

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
    for (const inv of unpaid) {
      s += toNum(applyAmount[inv.invoice_id]);
    }
    return round2(s);
  }, [applyAmount, unpaid]);

  const diff = React.useMemo(() => round2(netReceived - appliedTotal), [netReceived, appliedTotal]);
  const hasMismatch = React.useMemo(() => Math.abs(diff) > 0.01, [diff]);

  const loadBuyers = React.useCallback(async () => {
    setBuyersLoading(true);
    setErrorMsg("");
    try {
      // JM_ERP_V2: company_type can be BUYER/buyer/Buyer etc.
      // We'll load all non-deleted and filter buyer-ish types client-side (most robust).
      let data: any[] | null = null;

// Try with is_deleted filter first (if column exists)
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
    // Some environments don't have companies.is_deleted
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
      // Use server endpoint so schema differences in bank_accounts table don't break the UI.
      // UI calls /api/bank-accounts/list?active_only=1&include_any=1 elsewhere as well.
      const res = await fetch("/api/bank-accounts/list?active_only=1&include_any=1", {
        method: "GET",
        cache: "no-store",
      });

      if (!res.ok) {
        setBanks([]);
        return;
      }

      const j: any = await res.json();
      const rows =
        (Array.isArray(j) ? j : null) ??
        j.data ??
        j.rows ??
        j.items ??
        [];

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
        // Preferred: your API endpoint (server has the joins/logic)
        const res = await fetch(`/api/receipts/unpaid?buyer_id=${encodeURIComponent(bId)}`, {
          method: "GET",
        });

        if (res.ok) {
          const j = await res.json().catch(() => ({}));
          const rows = (j?.items || j?.rows || j?.data || []) as any[];
          const mapped: UnpaidInvoice[] = rows.map((r) => ({
            invoice_id: String(r.invoice_id ?? r.id),
            invoice_no: String(r.invoice_no ?? r.no ?? ""),
            invoice_date: (r.invoice_date ?? r.created_at ?? null) as any,
            total_amount: toNum(r.total_amount),
            received_amount: toNum(r.received_amount),
            balance: toNum(r.balance ?? (toNum(r.total_amount) - toNum(r.received_amount))),
          }));
          setUnpaid(mapped);
          resetApply();
          return;
        }

        // Fallback: query invoice_headers directly (schema may differ across envs)
        // 1) Try with received_amount + is_deleted
        let ihRows: any[] = [];
        try {
          const r = await supabase
            .from("invoice_headers")
            .select("id, invoice_no, invoice_date, total_amount, received_amount, buyer_id, status, is_deleted")
            .eq("buyer_id", bId)
            .in("status", ["DRAFT", "SENT", "OPEN", "PARTIAL", "CONFIRMED"])
            .order("invoice_date", { ascending: false });

          if (r.error) throw r.error;

          ihRows = (r.data || []).filter((x: any) => {
            if (x && typeof x === "object" && "is_deleted" in x) return x.is_deleted === false;
            return true;
          });
        } catch (err: any) {
          const msg = String(err?.message || "");
          const isMissingReceived = msg.toLowerCase().includes("invoice_headers.received_amount") && msg.toLowerCase().includes("does not exist");
          const isMissingIsDeleted = msg.toLowerCase().includes("invoice_headers.is_deleted") && msg.toLowerCase().includes("does not exist");

          // 2) Retry without missing columns
          if (isMissingReceived || isMissingIsDeleted) {
            // Build select list dynamically
            const selectCols = ["id", "invoice_no", "invoice_date", "total_amount", "buyer_id", "status"];
            const r2 = await supabase
              .from("invoice_headers")
              .select(selectCols.join(", "))
              .eq("buyer_id", bId)
              .in("status", ["DRAFT", "SENT", "OPEN", "PARTIAL", "CONFIRMED"])
              .order("invoice_date", { ascending: false });

            if (r2.error) throw r2.error;
            ihRows = (r2.data || []) as any[];

            // If received_amount column doesn't exist, compute it from receipt_applications
            if (isMissingReceived) {
              try {
                const ids = ihRows.map((x: any) => String(x.id)).filter(Boolean);
                if (ids.length) {
                  const ra = await supabase
                    .from("receipt_applications")
                    .select("invoice_id, applied_amount")
                    .in("invoice_id", ids);

                  if (!ra.error) {
                    const sumBy: Record<string, number> = {};
                    for (const row of (ra.data || []) as any[]) {
                      const k = String(row.invoice_id || "");
                      if (!k) continue;
                      sumBy[k] = round2((sumBy[k] || 0) + toNum(row.applied_amount));
                    }
                    ihRows = ihRows.map((x: any) => ({
                      ...x,
                      received_amount: sumBy[String(x.id)] || 0,
                    }));
                  } else {
                    // If receipt_applications has a different schema, just default to 0
                    ihRows = ihRows.map((x: any) => ({ ...x, received_amount: 0 }));
                  }
                }
              } catch {
                ihRows = ihRows.map((x: any) => ({ ...x, received_amount: 0 }));
              }
            } else {
              // received_amount exists but is_deleted missing — not applicable here because we removed it
            }
          } else {
            throw err;
          }
        }

        const mapped: UnpaidInvoice[] = (ihRows || [])
          .map((r: any) => {
            const total = toNum(r.total_amount);
            const rec = toNum(r.received_amount);
            return {
              invoice_id: String(r.id),
              invoice_no: String(r.invoice_no || ""),
              invoice_date: r.invoice_date ?? null,
              total_amount: total,
              received_amount: rec,
              balance: round2(total - rec),
            };
          })
          .filter((x) => x.balance > 0.0001);

        setUnpaid(mapped);
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
    [supabase, resetApply]
  );

  React.useEffect(() => {
    void loadBuyers();
    void loadBanks();
  }, [loadBuyers, loadBanks]);

  React.useEffect(() => {
    void loadUnpaid(buyerId);
  }, [buyerId, loadUnpaid]);

  
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
    lines.push(["Section","Field","Value"].map(csvEscape).join(","));
    lines.push(["Receipt","Buyer",buyerLabel].map(csvEscape).join(","));
    lines.push(["Receipt","Deposit Date",depositDate].map(csvEscape).join(","));
    lines.push(["Receipt","Bank Account",bankLabel].map(csvEscape).join(","));
    lines.push(["Receipt","Method",method].map(csvEscape).join(","));
    lines.push(["Receipt","Reference No",referenceNo].map(csvEscape).join(","));
    lines.push(["Receipt","Note",note].map(csvEscape).join(","));
    lines.push(["Amounts","Total Received (Gross)",fmt2(totalReceived)].map(csvEscape).join(","));
    lines.push(["Amounts","Bank Fee (Our Bank)",fmt2(bankFee)].map(csvEscape).join(","));
    lines.push(["Amounts","Bank Fee (Buyer Bank)",fmt2(buyerBankFee)].map(csvEscape).join(","));
    lines.push(["Amounts","Claim Deduction",fmt2(claimDeduction)].map(csvEscape).join(","));
    lines.push(["Amounts","Net Received",fmt2(netReceived)].map(csvEscape).join(","));
    lines.push(["Summary","Applied Total",fmt2(appliedTotal)].map(csvEscape).join(","));
    lines.push(["Summary","Diff (Net - Applied)",fmt2(diff)].map(csvEscape).join(","));

    lines.push("");
    lines.push(["invoice_id","invoice_no","invoice_date","invoice_total","invoice_balance","selected","apply_amount"].map(csvEscape).join(","));
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
    const fn = `receipts_${code}_${depositDate || todayISODate()}.csv`;
    downloadText(fn, lines.join("\n"));
  }, [
    buyers,
    buyerId,
    banks,
    bankAccountId,
    depositDate,
    method,
    referenceNo,
    note,
    totalReceived,
    bankFee,
    buyerBankFee,
    claimDeduction,
    netReceived,
    appliedTotal,
    diff,
    unpaid,
    selected,
    applyAmount,
  ]);

const toggleAll = () => {
    const next: Record<string, boolean> = {};
    for (const inv of unpaid) next[inv.invoice_id] = true;
    setSelected(next);
  };

  const clearAll = () => {
    resetApply();
  };

  const allocateFromTotal = () => {
    // Allocate netReceived across selected invoices in list order
    const selectedIds = unpaid.filter((u) => selected[u.invoice_id]);
    if (selectedIds.length === 0) return;

    let remaining = netReceived;

    const nextApply: Record<string, string> = { ...applyAmount };
    for (const inv of selectedIds) {
      if (remaining <= 0) {
        nextApply[inv.invoice_id] = "0.00";
        continue;
      }
      const amt = Math.min(inv.balance, remaining);
      remaining = round2(remaining - amt);
      nextApply[inv.invoice_id] = fmt2(amt);
    }
    setApplyAmount(nextApply);
  };

  
  // Number of selected invoices (used for validation/UX)
  const selectedCount = React.useMemo(() => {
    return unpaid.reduce((acc, u) => acc + (selected[u.invoice_id] ? 1 : 0), 0);
  }, [unpaid, selected]);

const canSave = React.useMemo(() => {
    if (!buyerId) return false;
    if (saving) return false;
    if (totalReceived <= 0) return false;
    if (netReceived <= 0) return false;
    // NOTE: mismatch is validated at Save click time (so user can still click Save and see message)
    return selectedCount > 0;
  }, [buyerId, saving, totalReceived, netReceived, selectedCount]);


  // Clear the mismatch message as soon as user edits values after a failed Save attempt.
  React.useEffect(() => {
    if (!errorMsg) return;
    if (!errorMsg.startsWith("Apply total")) return;
    setErrorMsg("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buyerId, totalReceivedStr, bankFeeStr, buyerBankFeeStr, claimDeductionStr, appliedTotal, netReceived]);

  const onSave = async () => {
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

      const res = await fetch("/api/receipts/bulk/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Save failed (${res.status})`);

      setOkMsg("Saved.");

      // store last saved receipt id (enables PDF button) + open PDF in new tab
      const savedId =
        (j?.receipt_id as string | undefined) ||
        (j?.receipt_header_id as string | undefined) ||
        (j?.id as string | undefined) ||
        (j?.header?.id as string | undefined);
      if (savedId) {
        setLastSavedReceiptId(savedId);
        // open receipt PDF immediately (new tab)
        try {
          window.open(`/receipts/${savedId}/pdf`, "_blank", "noopener,noreferrer");
        } catch {}
      }

      // Keep buyer selected but reset amounts
      // Keep buyer selected but reset amounts
      setTotalReceivedStr("");
      setBankFeeStr("0.00");
      setBuyerBankFeeStr("0.00");
      setClaimDeductionStr("0.00");
      setReferenceNo("");
      setNote("");
      resetApply();
      await loadUnpaid(buyerId);
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell role={role}>
      <div className="p-4 space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Receipts (Bulk Apply)</CardTitle>
            <div className="flex items-center gap-2">
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
    {saving ? "Saving..." : "Save Deposit"}
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
                  onChange={(e) => setBuyerId(e.target.value)}
                  disabled={buyersLoading}
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
                <Input
                  placeholder="0.00"
                  value={totalReceivedStr}
                  onChange={(e) => setTotalReceivedStr(clampMoneyInput(e.target.value))}
                />
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
                      <th className="text-right p-2 min-w-[120px]">Balance</th>
                      <th className="text-right p-2 min-w-[140px]">Apply</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unpaid.length === 0 ? (
                      <tr>
                        <td className="p-3 text-muted-foreground" colSpan={6}>
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
      </div>
    </AppShell>
  );
}
