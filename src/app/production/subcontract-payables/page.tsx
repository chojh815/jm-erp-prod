"use client";

import * as React from "react";
import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type WorkSheet = {
  id: string;
  po_no: string | null;
  ws_no?: string | null;
  buyer_name?: string | null;
  buyer_style?: string | null;
  jm_style?: string | null;
  qty?: number | null;
  vendor_id?: string | null;
  lp_currency?: string | null;
  lp_unit?: number | null;
};

type Vendor = {
  id: string;
  company_name: string | null;
  code: string | null;
  default_currency?: string | null;
  default_unit_cost_local?: number | null;
};

type CashAccount = {
  account_id?: string;
  id?: string;
  account_code: string;
  account_name: string;
  account_type: "CASH" | "BANK";
  currency: string;
  is_active?: boolean;
};

type PayableRow = {
  id: string;
  work_sheet_id: string;
  vendor_id: string;
  po_no: string | null;
  work_sheet_no: string | null;
  vendor_name: string | null;
  receipt_date: string;
  received_qty: number;
  currency: string;
  unit_cost: number;
  gross_amount?: number;
  claim_deduction_amount?: number;
  other_deduction_amount?: number;
  total_amount: number;
  payment_terms_days: number;
  due_date: string;
  status: "OPEN" | "PARTIAL" | "PAID" | "VOID";
  paid_amount: number;
  paid_date: string | null;
  advance_applied_amount?: number;
  claim_receipt_header_id?: string | null;
  payment_batch_no?: string | null;
  payment_account_id?: string | null;
  payment_method?: string | null;
  cash_transaction_id?: string | null;
  note: string | null;
};

type AdvanceRow = {
  id: string;
  vendor_id: string;
  vendor_name: string | null;
  advance_date: string;
  currency: string;
  amount: number;
  applied_amount: number;
  status: "OPEN" | "APPLIED" | "VOID";
  note: string | null;
};

type ClaimCandidate = {
  id: string;
  deposit_date: string;
  reference_no: string | null;
  responsible_vendor_id: string | null;
  responsible_vendor_name: string | null;
  subcontract_deduction_amount: number;
  note: string | null;
};

const inputCls = "h-8 w-full rounded-md border border-gray-300 px-2.5 text-xs outline-none focus:border-blue-500";
const btnCls = "h-8 rounded-md bg-blue-600 px-3 text-xs text-white hover:bg-blue-700 disabled:opacity-50";
const outlineBtnCls = "h-8 rounded-md border border-gray-300 px-3 text-xs text-gray-700 hover:bg-gray-50";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthStart(date = today()) {
  return `${date.slice(0, 7)}-01`;
}

function monthEnd(date = today()) {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00`);
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return d.toISOString().slice(0, 10);
}

function nextWeekday(date: string, weekday: number) {
  const d = new Date(`${date}T00:00:00`);
  const delta = (weekday - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function nextHalfMonthPayDate(date: string) {
  const d = new Date(`${date}T00:00:00`);
  const day = d.getDate();
  if (day <= 15) {
    d.setDate(15);
  } else {
    d.setMonth(d.getMonth() + 1);
    d.setDate(15);
  }
  return d.toISOString().slice(0, 10);
}

function nextMonthEndPayDate(date: string) {
  const d = new Date(`${date}T00:00:00`);
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return d.toISOString().slice(0, 10);
}

function fmtMoney(currency: string, value: number | null | undefined) {
  return `${currency || ""} ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function statusClass(status: string) {
  if (status === "PAID") return "bg-green-100 text-green-700";
  if (status === "PARTIAL") return "bg-amber-100 text-amber-700";
  if (status === "VOID") return "bg-gray-100 text-gray-600";
  return "bg-blue-100 text-blue-700";
}

function isOverdue(row: PayableRow) {
  return row.status !== "PAID" && row.status !== "VOID" && row.due_date < today();
}

function cashAccountId(row: CashAccount) {
  return row.account_id || row.id || "";
}

function payableRowAmount(row: PayableRow) {
  const gross = Number(row.gross_amount ?? Number(row.received_qty || 0) * Number(row.unit_cost || 0));
  const deductions = Number(row.claim_deduction_amount || 0) + Number(row.other_deduction_amount || 0);
  return Math.max(gross - deductions, 0);
}

function displayVendorName(rows: PayableRow[]) {
  const names = Array.from(new Set(rows.map((row) => row.vendor_name || "").filter(Boolean)));
  if (names.length === 0) return "All Vendors";
  if (names.length === 1) return names[0];
  return "Multiple Vendors";
}

function exportDate() {
  return new Date().toISOString().slice(0, 10);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function registerNotoSansSC(doc: any) {
  const res = await fetch("/fonts/NotoSansSC-Regular.ttf", { cache: "force-cache" });
  if (!res.ok) throw new Error("Missing PDF font: /fonts/NotoSansSC-Regular.ttf");
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunkSize)));
  }
  const base64 = btoa(binary);
  doc.addFileToVFS("NotoSansSC-Regular.ttf", base64);
  doc.addFont("NotoSansSC-Regular.ttf", "NotoSansSC", "normal", "Identity-H");
  doc.setFont("NotoSansSC", "normal");
}

export default function SubcontractPayablesPage() {
  const [workSheets, setWorkSheets] = React.useState<WorkSheet[]>([]);
  const [vendors, setVendors] = React.useState<Vendor[]>([]);
  const [cashAccounts, setCashAccounts] = React.useState<CashAccount[]>([]);
  const [rows, setRows] = React.useState<PayableRow[]>([]);
  const [allRows, setAllRows] = React.useState<PayableRow[]>([]);
  const [advances, setAdvances] = React.useState<AdvanceRow[]>([]);
  const [claimCandidates, setClaimCandidates] = React.useState<ClaimCandidate[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState("");

  const [filterStatus, setFilterStatus] = React.useState("ALL");
  const [filterVendorId, setFilterVendorId] = React.useState("ALL");
  const [filterQ, setFilterQ] = React.useState("");
  const [filterDateType, setFilterDateType] = React.useState<"DUE" | "PAID">("DUE");
  const [filterFrom, setFilterFrom] = React.useState(monthStart());
  const [filterTo, setFilterTo] = React.useState(monthEnd());

  const [selectedWorkSheetIds, setSelectedWorkSheetIds] = React.useState<string[]>([]);
  const [receiptQtyByWs, setReceiptQtyByWs] = React.useState<Record<string, string>>({});
  const [claimDeductionByWs, setClaimDeductionByWs] = React.useState<Record<string, string>>({});
  const [otherDeductionByWs, setOtherDeductionByWs] = React.useState<Record<string, string>>({});
  const [vendorId, setVendorId] = React.useState("");
  const [receiptDate, setReceiptDate] = React.useState(today());
  const [currency, setCurrency] = React.useState("CNY");
  const [unitCost, setUnitCost] = React.useState("");
  const [termsDays, setTermsDays] = React.useState("60");
  const [paymentCycle, setPaymentCycle] = React.useState("NET_60");
  const [dueDate, setDueDate] = React.useState(addDays(today(), 60));
  const [note, setNote] = React.useState("");
  const [payingRow, setPayingRow] = React.useState<PayableRow | null>(null);
  const [paymentDate, setPaymentDate] = React.useState(today());
  const [paymentAmount, setPaymentAmount] = React.useState("");
  const [paymentAccountId, setPaymentAccountId] = React.useState("");
  const [paymentMethod, setPaymentMethod] = React.useState("BANK_TRANSFER");
  const [paymentMemo, setPaymentMemo] = React.useState("");
  const [selectedPayableIds, setSelectedPayableIds] = React.useState<string[]>([]);
  const [bulkPaying, setBulkPaying] = React.useState(false);
  const [advanceDate, setAdvanceDate] = React.useState(today());
  const [advanceVendorId, setAdvanceVendorId] = React.useState("");
  const [advanceCurrency, setAdvanceCurrency] = React.useState("CNY");
  const [advanceAmount, setAdvanceAmount] = React.useState("");
  const [advanceAccountId, setAdvanceAccountId] = React.useState("");
  const [advanceMethod, setAdvanceMethod] = React.useState("BANK_TRANSFER");
  const [advanceNote, setAdvanceNote] = React.useState("");
  const [selectedClaimId, setSelectedClaimId] = React.useState("NONE");

  const selectedVendor = React.useMemo(
    () => vendors.find((row) => row.id === vendorId),
    [vendorId, vendors]
  );
  const vendorWorkSheets = React.useMemo(
    () => vendorId ? workSheets.filter((row) => row.vendor_id === vendorId) : [],
    [vendorId, workSheets]
  );
  const selectedWorkSheets = React.useMemo(
    () => workSheets.filter((row) => selectedWorkSheetIds.includes(row.id)),
    [selectedWorkSheetIds, workSheets]
  );
  const selectedPayableRows = React.useMemo(
    () => rows.filter((row) => selectedPayableIds.includes(row.id)),
    [rows, selectedPayableIds]
  );
  const bulkSelectionInfo = React.useMemo(() => {
    const vendorIds = Array.from(new Set(selectedPayableRows.map((row) => row.vendor_id)));
    const currencies = Array.from(new Set(selectedPayableRows.map((row) => row.currency)));
    return {
      count: selectedPayableRows.length,
      singleVendor: vendorIds.length <= 1,
      singleCurrency: currencies.length <= 1,
      vendorLabel: selectedPayableRows[0]?.vendor_name || "-",
      currencyLabel: currencies[0] || "-",
      total: selectedPayableRows.reduce((sum, row) => sum + payableRowAmount(row), 0),
    };
  }, [selectedPayableRows]);
  const openAdvanceBalance = React.useMemo(() => {
    return advances.reduce((sum, row) => {
      if (row.status === "VOID") return sum;
      return sum + Math.max(Number(row.amount || 0) - Number(row.applied_amount || 0), 0);
    }, 0);
  }, [advances]);

  const receivedByWorkSheet = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const row of allRows) {
      if (row.status === "VOID") continue;
      map.set(row.work_sheet_id, (map.get(row.work_sheet_id) || 0) + Number(row.received_qty || 0));
    }
    return map;
  }, [allRows]);

  const receivableVendorWorkSheets = React.useMemo(
    () => vendorWorkSheets.filter((row) => remainingQtyOf(row) > 0),
    [vendorWorkSheets, receivedByWorkSheet]
  );

  function orderQtyOf(row: WorkSheet) {
    return Number(row.qty || 0);
  }

  function alreadyReceivedOf(row: WorkSheet) {
    return Number(receivedByWorkSheet.get(row.id) || 0);
  }

  function remainingQtyOf(row: WorkSheet) {
    const orderQty = orderQtyOf(row);
    if (!(orderQty > 0)) return 0;
    return Math.max(orderQty - alreadyReceivedOf(row), 0);
  }

  function receiptQtyOf(row: WorkSheet) {
    return Number(receiptQtyByWs[row.id] || 0);
  }

  function unitCostOf(row: WorkSheet) {
    return Number(row.lp_unit ?? unitCost ?? 0);
  }

  function claimDeductionOf(row: WorkSheet) {
    return Number(claimDeductionByWs[row.id] || 0);
  }

  function otherDeductionOf(row: WorkSheet) {
    return Number(otherDeductionByWs[row.id] || 0);
  }

  function grossAmountOf(row: WorkSheet) {
    return receiptQtyOf(row) * unitCostOf(row);
  }

  function payableAmountOf(row: WorkSheet) {
    return Math.max(grossAmountOf(row) - claimDeductionOf(row) - otherDeductionOf(row), 0);
  }

  const selectedQtyTotal = selectedWorkSheets.reduce((sum, row) => sum + receiptQtyOf(row), 0);
  const totalAmount = selectedWorkSheets.reduce((sum, row) => sum + payableAmountOf(row), 0);
  const paymentAccountsForRow = React.useMemo(() => {
    if (!payingRow) return cashAccounts;
    return cashAccounts.filter((row) => row.currency === payingRow.currency);
  }, [cashAccounts, payingRow]);
  const statusCounts = React.useMemo(() => {
    return allRows.reduce(
      (acc, row) => {
        acc.all += 1;
        acc[row.status.toLowerCase() as "open" | "partial" | "paid" | "void"] += 1;
        return acc;
      },
      { all: 0, open: 0, partial: 0, paid: 0, void: 0 }
    );
  }, [allRows]);
  const periodSummary = React.useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        const payable = payableRowAmount(row);
        if (row.status === "PAID") acc.paid += Number(row.paid_amount || payable);
        if (row.status !== "PAID" && row.status !== "VOID") acc.unpaid += payable;
        if (row.status !== "VOID") acc.total += payable;
        return acc;
      },
      { total: 0, paid: 0, unpaid: 0 }
    );
  }, [rows]);
  const overdueCount = React.useMemo(() => rows.filter(isOverdue).length, [rows]);

  const loadLookups = React.useCallback(async () => {
    const [wsRes, vendorRes, cashRes] = await Promise.all([
      fetch("/api/work-sheets/list?all=1&include_empty=1", { cache: "no-store" }),
      fetch("/api/work-sheets/vendors", { cache: "no-store" }),
      fetch("/api/finance/cash-accounts?active_only=true", { cache: "no-store" }),
    ]);
    const wsJson = await wsRes.json();
    const vendorJson = await vendorRes.json();
    const cashJson = await cashRes.json();
    setWorkSheets(wsJson?.rows || []);
    setVendors(vendorJson?.rows || []);
    setCashAccounts(cashJson?.items || []);
  }, []);

  const loadRows = React.useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      params.set("status", filterStatus);
      params.set("limit", "1000");
      if (filterVendorId !== "ALL") params.set("vendor_id", filterVendorId);
      if (filterQ.trim()) params.set("q", filterQ.trim());
      if (filterFrom) params.set(filterDateType === "PAID" ? "paid_from" : "due_from", filterFrom);
      if (filterTo) params.set(filterDateType === "PAID" ? "paid_to" : "due_to", filterTo);

      const allParams = new URLSearchParams();
      allParams.set("status", "ALL");
      allParams.set("limit", "2000");
      const advanceParams = new URLSearchParams();
      advanceParams.set("status", "ALL");
      advanceParams.set("limit", "1000");
      if (filterVendorId !== "ALL") advanceParams.set("vendor_id", filterVendorId);
      const claimParams = new URLSearchParams();
      claimParams.set("limit", "100");
      if (filterVendorId !== "ALL") claimParams.set("vendor_id", filterVendorId);
      const [res, allRes, advanceRes, claimRes] = await Promise.all([
        fetch(`/api/production/subcontract-payables?${params.toString()}`, { cache: "no-store" }),
        fetch(`/api/production/subcontract-payables?${allParams.toString()}`, { cache: "no-store" }),
        fetch(`/api/production/subcontract-advances?${advanceParams.toString()}`, { cache: "no-store" }),
        fetch(`/api/production/subcontract-claim-deductions?${claimParams.toString()}`, { cache: "no-store" }),
      ]);
      const json = await res.json();
      const allJson = await allRes.json();
      const advanceJson = await advanceRes.json();
      const claimJson = await claimRes.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || "Failed to load payables");
      setRows(json.rows || []);
      if (allRes.ok && allJson?.success) setAllRows(allJson.rows || []);
      if (advanceRes.ok && advanceJson?.success) setAdvances(advanceJson.rows || []);
      if (claimRes.ok && claimJson?.success) setClaimCandidates(claimJson.rows || []);
    } catch (err: any) {
      setMessage(err?.message || "Failed to load payables");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filterDateType, filterFrom, filterQ, filterStatus, filterTo, filterVendorId]);

  React.useEffect(() => {
    loadLookups().catch((err) => setMessage(err?.message || "Failed to load lookups"));
  }, [loadLookups]);

  React.useEffect(() => {
    loadRows();
  }, [loadRows]);

  function resetForm() {
    setSelectedWorkSheetIds([]);
    setReceiptQtyByWs({});
    setClaimDeductionByWs({});
    setOtherDeductionByWs({});
    setVendorId("");
    setReceiptDate(today());
    setCurrency("CNY");
    setUnitCost("");
    setTermsDays("60");
    setPaymentCycle("NET_60");
    setDueDate(addDays(today(), 60));
    setNote("");
    setMessage("");
  }

  function onSelectVendor(id: string) {
    setVendorId(id);
    setSelectedWorkSheetIds([]);
    setReceiptQtyByWs({});
    setClaimDeductionByWs({});
    setOtherDeductionByWs({});
    const row = vendors.find((item) => item.id === id);
    setCurrency(row?.default_currency || "CNY");
    setUnitCost(row?.default_unit_cost_local != null ? String(row.default_unit_cost_local) : "");
    if (!advanceVendorId) {
      setAdvanceVendorId(id);
      setAdvanceCurrency(row?.default_currency || "CNY");
    }
  }

  function setQuickPeriod(mode: "THIS_MONTH" | "NEXT_30" | "OVERDUE") {
    const start = today();
    if (mode === "THIS_MONTH") {
      setFilterFrom(monthStart());
      setFilterTo(monthEnd());
      return;
    }
    if (mode === "NEXT_30") {
      setFilterDateType("DUE");
      setFilterFrom(start);
      setFilterTo(addDays(start, 30));
      return;
    }
    setFilterStatus("OPEN");
    setFilterDateType("DUE");
    setFilterFrom("2000-01-01");
    setFilterTo(addDays(start, -1));
  }

  function togglePayableSelection(id: string) {
    setSelectedPayableIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  }

  function openBulkPayment() {
    if (bulkSelectionInfo.count === 0) return setMessage("Select payable lines first");
    if (!bulkSelectionInfo.singleCurrency) return setMessage("Bulk payment must use one currency");
    if (!bulkSelectionInfo.singleVendor) return setMessage("Bulk payment must use one vendor");
    const matchedAccount = cashAccounts.find((account) => account.currency === bulkSelectionInfo.currencyLabel);
    setPayingRow(null);
    setBulkPaying(true);
    setPaymentDate(today());
    setPaymentAmount(String(bulkSelectionInfo.total));
    setPaymentAccountId(matchedAccount ? cashAccountId(matchedAccount) : "");
    setPaymentMethod("BANK_TRANSFER");
    setPaymentMemo(`Bulk subcontract payment ${bulkSelectionInfo.count} lines`);
    setMessage("");
  }

  function toggleWorkSheet(id: string) {
    const row = workSheets.find((item) => item.id === id);
    setSelectedWorkSheetIds((prev) => {
      const exists = prev.includes(id);
      if (exists) return prev.filter((item) => item !== id);
      if (!row || remainingQtyOf(row) <= 0) return prev;
      if (row) {
        setReceiptQtyByWs((current) => ({
          ...current,
          [id]: String(remainingQtyOf(row)),
        }));
      }
      return [...prev, id];
    });
    if (row?.lp_currency) setCurrency(row.lp_currency);
    if (row?.lp_unit != null && !unitCost) setUnitCost(String(row.lp_unit));
  }

  function toggleAllVendorWorkSheets() {
    const ids = receivableVendorWorkSheets.map((row) => row.id);
    const allSelected = ids.length > 0 && ids.every((id) => selectedWorkSheetIds.includes(id));
    setSelectedWorkSheetIds(allSelected ? [] : ids);
    if (allSelected) {
      setReceiptQtyByWs({});
    } else {
      setReceiptQtyByWs(Object.fromEntries(receivableVendorWorkSheets.map((row) => [row.id, String(remainingQtyOf(row))])));
    }
  }

  function applyClaimCandidate(id: string) {
    setSelectedClaimId(id);
    if (id === "NONE") return;
    const claim = claimCandidates.find((row) => row.id === id);
    if (!claim || selectedWorkSheets.length === 0) return;
    const perLine = Number(claim.subcontract_deduction_amount || 0) / selectedWorkSheets.length;
    setClaimDeductionByWs((prev) => ({
      ...prev,
      ...Object.fromEntries(selectedWorkSheets.map((row) => [row.id, String(Number(perLine.toFixed(2)))])),
    }));
  }

  function onReceiptDateChange(value: string) {
    setReceiptDate(value);
    setDueDate(calculateDueDate(value, paymentCycle, termsDays));
  }

  function onTermsChange(value: string) {
    setTermsDays(value);
    setPaymentCycle("CUSTOM_DAYS");
    setDueDate(calculateDueDate(receiptDate, "CUSTOM_DAYS", value));
  }

  function onPaymentCycleChange(value: string) {
    setPaymentCycle(value);
    if (value === "NET_60") setTermsDays("60");
    if (value === "NET_30") setTermsDays("30");
    if (value === "CUSTOM_DAYS") {
      setDueDate(calculateDueDate(receiptDate, value, termsDays));
      return;
    }
    setDueDate(calculateDueDate(receiptDate, value, value === "NET_30" ? "30" : value === "NET_60" ? "60" : termsDays));
  }

  function onFilterStatusChange(value: string) {
    setFilterStatus(value);
    if (value === "PAID") setFilterDateType("PAID");
    if (value === "OPEN" || value === "PARTIAL") setFilterDateType("DUE");
  }

  function calculateDueDate(baseDate: string, cycle: string, daysValue: string) {
    if (cycle === "WEEKLY") return nextWeekday(baseDate, 5);
    if (cycle === "HALF_MONTH") return nextHalfMonthPayDate(baseDate);
    if (cycle === "MONTH_END") return nextMonthEndPayDate(baseDate);
    return addDays(baseDate, Number(daysValue || 60));
  }

  async function savePayable() {
    setMessage("");
    if (!vendorId) return setMessage("Vendor is required");
    if (selectedWorkSheetIds.length === 0) return setMessage("Select at least one work sheet");

    setSaving(true);
    try {
      for (const ws of selectedWorkSheets) {
        const qty = receiptQtyOf(ws);
        if (!(qty > 0)) throw new Error(`Received qty is missing for ${ws.ws_no || ws.po_no || ws.id}`);
        const remaining = remainingQtyOf(ws);
        if (orderQtyOf(ws) > 0 && qty > remaining) {
          throw new Error(`Receipt qty exceeds remaining qty for ${ws.ws_no || ws.po_no || ws.id}. Remaining ${remaining}.`);
        }

        const res = await fetch("/api/production/subcontract-payables", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            work_sheet_id: ws.id,
            vendor_id: vendorId,
            receipt_date: receiptDate,
            received_qty: qty,
            currency,
            unit_cost: unitCostOf(ws),
            claim_deduction_amount: claimDeductionOf(ws),
            other_deduction_amount: otherDeductionOf(ws),
            payment_terms_days: Number(termsDays || 60),
            due_date: dueDate,
            claim_receipt_header_id: selectedClaimId !== "NONE" ? selectedClaimId : null,
            note,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json?.success) throw new Error(json?.error || "Failed to save");
      }
      resetForm();
      setMessage("Saved");
      await loadRows();
    } catch (err: any) {
      setMessage(err?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function openPayment(row: PayableRow) {
    const matchedAccount = cashAccounts.find((account) => account.currency === row.currency);
    const vendorAdvance = advances
      .filter((advance) => advance.vendor_id === row.vendor_id && advance.currency === row.currency && advance.status !== "VOID")
      .reduce((sum, advance) => sum + Math.max(Number(advance.amount || 0) - Number(advance.applied_amount || 0), 0), 0);
    setPayingRow(row);
    setBulkPaying(false);
    setPaymentDate(today());
    setPaymentAmount(String(Math.max(payableRowAmount(row) - vendorAdvance, 0)));
    setPaymentAccountId(matchedAccount ? cashAccountId(matchedAccount) : "");
    setPaymentMethod("BANK_TRANSFER");
    setPaymentMemo(`Subcontract payment ${row.po_no || ""} ${row.work_sheet_no || ""}${vendorAdvance > 0 ? ` / advance available ${vendorAdvance}` : ""}`.trim());
    setMessage("");
  }

  async function applyAdvanceToVendor(vendorId: string, currencyValue: string, amountNeeded: number) {
    let remaining = amountNeeded;
    let applied = 0;
    const usable = advances
      .filter((advance) => advance.vendor_id === vendorId && advance.currency === currencyValue && advance.status !== "VOID")
      .map((advance) => ({
        ...advance,
        balance: Math.max(Number(advance.amount || 0) - Number(advance.applied_amount || 0), 0),
      }))
      .filter((advance) => advance.balance > 0);

    for (const advance of usable) {
      if (remaining <= 0) break;
      const useAmount = Math.min(advance.balance, remaining);
      const nextApplied = Number(advance.applied_amount || 0) + useAmount;
      const res = await fetch(`/api/production/subcontract-advances/${advance.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applied_amount: nextApplied,
          status: nextApplied >= Number(advance.amount || 0) ? "APPLIED" : "OPEN",
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || "Failed to apply advance");
      applied += useAmount;
      remaining -= useAmount;
    }
    return applied;
  }

  async function confirmBulkPayment() {
    setMessage("");
    const paidAmount = Number(paymentAmount);
    if (selectedPayableRows.length === 0) return setMessage("Select payable lines first");
    if (!(paidAmount > 0)) return setMessage("Paid amount is required");
    if (!paymentDate) return setMessage("Paid date is required");
    if (!paymentAccountId) return setMessage("Payment account is required");

    try {
      const account = cashAccounts.find((item) => cashAccountId(item) === paymentAccountId);
      if (!account) throw new Error("Payment account not found");
      const currencies = Array.from(new Set(selectedPayableRows.map((row) => row.currency)));
      const vendorsInSelection = Array.from(new Set(selectedPayableRows.map((row) => row.vendor_id)));
      if (currencies.length !== 1 || account.currency !== currencies[0]) throw new Error(`Payment account currency must be ${currencies[0]}`);
      if (vendorsInSelection.length !== 1) throw new Error("Bulk payment must use one vendor");

      const batchNo = `PAY-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${Date.now().toString().slice(-5)}`;
      const vendorName = selectedPayableRows[0]?.vendor_name || "";
      const cashRes = await fetch("/api/finance/cash-ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: paymentAccountId,
          tx_date: paymentDate,
          in_out: "OUT",
          category: "EXPENSE",
          ref_type: "subcontract_payment_batch",
          ref_id: batchNo,
          description: `Subcontract bulk payment - ${vendorName}`,
          memo: paymentMemo || null,
          counterparty_type: "VENDOR",
          counterparty_id: vendorsInSelection[0],
          counterparty_name: vendorName,
          amount: paidAmount,
          purpose_code: "PURCHASE_PAYMENT",
          purpose_group: "Direct Cost",
        }),
      });
      const cashJson = await cashRes.json();
      if (!cashRes.ok || !cashJson?.ok) throw new Error(cashJson?.error || "Failed to create cashbook line");

      for (const row of selectedPayableRows) {
        const res = await fetch(`/api/production/subcontract-payables/${row.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "PAID",
            paid_amount: payableRowAmount(row),
            paid_date: paymentDate,
            payment_account_id: paymentAccountId,
            payment_method: paymentMethod,
            cash_transaction_id: cashJson.item?.id || null,
            payment_batch_no: batchNo,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json?.success) throw new Error(json?.error || "Failed to mark paid");
      }
      setBulkPaying(false);
      setSelectedPayableIds([]);
      await loadRows();
    } catch (err: any) {
      setMessage(err?.message || "Failed to process bulk payment");
    }
  }

  async function saveAdvancePayment() {
    setMessage("");
    const amount = Number(advanceAmount);
    if (!advanceVendorId) return setMessage("Advance vendor is required");
    if (!(amount > 0)) return setMessage("Advance amount is required");
    if (!advanceDate) return setMessage("Advance date is required");
    if (!advanceAccountId) return setMessage("Advance payment account is required");

    try {
      const vendor = vendors.find((row) => row.id === advanceVendorId);
      const account = cashAccounts.find((row) => cashAccountId(row) === advanceAccountId);
      if (!account) throw new Error("Payment account not found");
      if (account.currency !== advanceCurrency) throw new Error(`Payment account currency must be ${advanceCurrency}`);

      const cashRes = await fetch("/api/finance/cash-ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: advanceAccountId,
          tx_date: advanceDate,
          in_out: "OUT",
          category: "EXPENSE",
          ref_type: "subcontract_advance",
          ref_id: advanceVendorId,
          description: `Subcontract advance - ${vendor?.company_name || vendor?.code || ""}`,
          memo: advanceNote || null,
          counterparty_type: "VENDOR",
          counterparty_id: advanceVendorId,
          counterparty_name: vendor?.company_name || vendor?.code || null,
          amount,
          purpose_code: "SUBCONTRACT_ADVANCE",
          purpose_group: "Direct Cost",
        }),
      });
      const cashJson = await cashRes.json();
      if (!cashRes.ok || !cashJson?.ok) throw new Error(cashJson?.error || "Failed to create cashbook line");

      const res = await fetch("/api/production/subcontract-advances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendor_id: advanceVendorId,
          advance_date: advanceDate,
          currency: advanceCurrency,
          amount,
          payment_account_id: advanceAccountId,
          payment_method: advanceMethod,
          cash_transaction_id: cashJson.item?.id || null,
          note: advanceNote || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || "Failed to save advance");
      setAdvanceAmount("");
      setAdvanceNote("");
      await loadRows();
    } catch (err: any) {
      setMessage(err?.message || "Failed to save advance");
    }
  }

  async function confirmPayment() {
    if (!payingRow) return;
    setMessage("");
    const paidAmount = Number(paymentAmount);
    if (!paymentDate) return setMessage("Paid date is required");

    try {
      const payableAmount = payableRowAmount(payingRow);
      const advanceApplied = await applyAdvanceToVendor(payingRow.vendor_id, payingRow.currency, payableAmount);
      const cashPayAmount = Math.max(payableAmount - advanceApplied, 0);
      const finalPaidAmount = paidAmount > 0 ? paidAmount : cashPayAmount;
      if (cashPayAmount > 0 && !paymentAccountId) return setMessage("Payment account is required");
      let cashTransactionId: string | null = null;

      if (cashPayAmount > 0) {
        const account = cashAccounts.find((item) => cashAccountId(item) === paymentAccountId);
        if (!account) throw new Error("Payment account not found");
        if (account.currency !== payingRow.currency) {
          throw new Error(`Payment account currency must be ${payingRow.currency}`);
        }

        const cashRes = await fetch("/api/finance/cash-ledger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account_id: paymentAccountId,
            tx_date: paymentDate,
            in_out: "OUT",
            category: "EXPENSE",
            ref_type: "subcontract_payable",
            ref_id: payingRow.id,
            description: `Subcontract payment - ${payingRow.vendor_name || ""}`,
            memo: paymentMemo || null,
            counterparty_type: "VENDOR",
            counterparty_id: payingRow.vendor_id,
            counterparty_name: payingRow.vendor_name,
            amount: finalPaidAmount,
            purpose_code: "PURCHASE_PAYMENT",
            purpose_group: "Direct Cost",
          }),
        });
        const cashJson = await cashRes.json();
        if (!cashRes.ok || !cashJson?.ok) throw new Error(cashJson?.error || "Failed to create cashbook line");
        cashTransactionId = cashJson.item?.id || null;
      }

      const res = await fetch(`/api/production/subcontract-payables/${payingRow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "PAID",
          paid_amount: payableAmount,
          paid_date: paymentDate,
          advance_applied_amount: advanceApplied,
          payment_account_id: paymentAccountId,
          payment_method: paymentMethod,
          cash_transaction_id: cashTransactionId,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || "Failed to mark paid");
      setPayingRow(null);
      await loadRows();
    } catch (err: any) {
      setMessage(err?.message || "Failed to process payment");
    }
  }

  async function voidRow(row: PayableRow) {
    if (!window.confirm("Void this subcontract payable?")) return;
    setMessage("");
    try {
      const res = await fetch(`/api/production/subcontract-payables/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "VOID" }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || "Failed to void");
      await loadRows();
    } catch (err: any) {
      setMessage(err?.message || "Failed to void");
    }
  }

  async function restoreRow(row: PayableRow) {
    setMessage("");
    try {
      const res = await fetch(`/api/production/subcontract-payables/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "OPEN",
          paid_amount: 0,
          paid_date: null,
          payment_account_id: null,
          payment_method: null,
          cash_transaction_id: null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || "Failed to restore");
      await loadRows();
    } catch (err: any) {
      setMessage(err?.message || "Failed to restore");
    }
  }

  async function deleteRow(row: PayableRow) {
    if (!window.confirm("Delete this subcontract payable line permanently from this screen?")) return;
    setMessage("");
    try {
      const res = await fetch(`/api/production/subcontract-payables/${row.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || "Failed to delete");
      await loadRows();
    } catch (err: any) {
      setMessage(err?.message || "Failed to delete");
    }
  }

  function exportRows() {
    return rows.map((row) => {
      const gross = Number(row.gross_amount ?? Number(row.received_qty || 0) * Number(row.unit_cost || 0));
      const deduction = Number(row.claim_deduction_amount || 0) + Number(row.other_deduction_amount || 0);
      return {
        "Due Date": row.due_date,
        Vendor: row.vendor_name || "",
        PO: row.po_no || "",
        "Work Sheet": row.work_sheet_no || "",
        "Receipt Date": row.receipt_date,
        Qty: Number(row.received_qty || 0),
        Currency: row.currency,
        "Unit Cost": Number(row.unit_cost || 0),
        Gross: gross,
        Deduction: deduction,
        Payable: payableRowAmount(row),
        "Paid Date": row.paid_date || "",
        "Paid Amount": Number(row.paid_amount || 0),
        Status: row.status,
        Note: row.note || "",
      };
    });
  }

  async function exportExcel() {
    const ExcelJS = await import("exceljs");
    const data = exportRows();
    const vendorName = displayVendorName(rows);
    const payableTotal = rows.reduce((sum, row) => sum + payableRowAmount(row), 0);
    const wb = new ExcelJS.Workbook();
    wb.creator = "JM ERP";
    wb.created = new Date();

    const summarySheet = wb.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 4 }] });
    summarySheet.columns = [
      { key: "label", width: 24 },
      { key: "value", width: 24 },
    ];
    summarySheet.mergeCells("A1:B1");
    summarySheet.getCell("A1").value = "Subcontract Vendor Ledger";
    summarySheet.getCell("A1").font = { bold: true, size: 15, color: { argb: "FFFFFFFF" } };
    summarySheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
    summarySheet.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
    summarySheet.getRow(1).height = 24;

    const summaryRows = [
      ["Vendor", vendorName],
      ["Export Date", exportDate()],
      ["Status Filter", filterStatus],
      ["Search", filterQ || "-"],
      ["Total Lines", rows.length],
      ["Open", statusCounts.open],
      ["Paid", statusCounts.paid],
      ["Void", statusCounts.void],
      ["Payable Total", payableTotal],
    ];
    summarySheet.addRows(summaryRows);
    summarySheet.eachRow((row, rowNumber) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin", color: { argb: "FFD9E2EC" } },
          left: { style: "thin", color: { argb: "FFD9E2EC" } },
          bottom: { style: "thin", color: { argb: "FFD9E2EC" } },
          right: { style: "thin", color: { argb: "FFD9E2EC" } },
        };
        if (rowNumber > 1 && cell.col === "A") {
          cell.font = { bold: true };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F6FA" } };
        }
      });
    });
    summarySheet.getCell("B10").numFmt = '#,##0.00';

    const scheduleSheet = wb.addWorksheet("Payment Schedule", { views: [{ state: "frozen", ySplit: 4 }] });
    const scheduleHeaders = [
      "Due Date", "PO", "Work Sheet", "Receipt Date", "Qty", "Currency", "Unit Cost",
      "Gross", "Deduction", "Payable", "Paid Date", "Paid Amount", "Status", "Note",
    ];
    scheduleSheet.columns = [
      { key: "Due Date", width: 13 },
      { key: "PO", width: 14 },
      { key: "Work Sheet", width: 16 },
      { key: "Receipt Date", width: 13 },
      { key: "Qty", width: 10 },
      { key: "Currency", width: 10 },
      { key: "Unit Cost", width: 12 },
      { key: "Gross", width: 12 },
      { key: "Deduction", width: 12 },
      { key: "Payable", width: 12 },
      { key: "Paid Date", width: 13 },
      { key: "Paid Amount", width: 13 },
      { key: "Status", width: 10 },
      { key: "Note", width: 28 },
    ];
    for (let col = 1; col <= 14; col += 1) {
      scheduleSheet.getCell(1, col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
    }
    scheduleSheet.mergeCells("A1:H1");
    scheduleSheet.getCell("A1").value = "Subcontract Vendor Ledger";
    scheduleSheet.getCell("A1").font = { bold: true, size: 15, color: { argb: "FFFFFFFF" } };
    scheduleSheet.getCell("A1").alignment = { vertical: "middle", horizontal: "center" };
    scheduleSheet.getRow(1).height = 24;
    scheduleSheet.mergeCells("A2:H2");
    scheduleSheet.getCell("A2").value = `Vendor: ${vendorName}`;
    scheduleSheet.getCell("A2").font = { bold: true, size: 11, color: { argb: "FF111827" } };
    scheduleSheet.getCell("A2").alignment = { vertical: "middle", horizontal: "left" };
    scheduleSheet.mergeCells("A3:H3");
    scheduleSheet.getCell("A3").value = `Export Date: ${exportDate()} / Status: ${filterStatus} / Search: ${filterQ || "-"}`;
    scheduleSheet.getCell("A3").font = { color: { argb: "FF52616F" } };
    scheduleSheet.getCell("A3").alignment = { vertical: "middle", horizontal: "left" };
    scheduleSheet.getRow(4).values = scheduleHeaders;

    const headerRow = scheduleSheet.getRow(4);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF354052" } };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };
    headerRow.height = 20;

    data.forEach((row) => {
      const { Vendor: _vendor, ...ledgerRow } = row;
      scheduleSheet.addRow(ledgerRow);
    });

    scheduleSheet.eachRow((row, rowNumber) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin", color: { argb: "FFE1E7EF" } },
          left: { style: "thin", color: { argb: "FFE1E7EF" } },
          bottom: { style: "thin", color: { argb: "FFE1E7EF" } },
          right: { style: "thin", color: { argb: "FFE1E7EF" } },
        };
        if (rowNumber >= 4) {
          cell.alignment = { vertical: "middle", wrapText: true };
        }
        if (rowNumber > 4 && rowNumber % 2 === 0) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
        }
      });
    });

    scheduleSheet.getCell("A1").alignment = { vertical: "middle", horizontal: "center" };
    ["A2", "A3"].forEach((cellRef) => {
      scheduleSheet.getCell(cellRef).alignment = { vertical: "middle", horizontal: "left" };
    });

    [5, 7, 8, 9, 10, 12].forEach((col) => {
      scheduleSheet.getColumn(col).numFmt = '#,##0.00';
      scheduleSheet.getColumn(col).alignment = { horizontal: "right" };
    });
    scheduleSheet.autoFilter = {
      from: { row: 4, column: 1 },
      to: { row: Math.max(4, data.length + 4), column: 14 },
    };

    const buffer = await wb.xlsx.writeBuffer();
    downloadBlob(
      new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `subcontract_payables_${exportDate()}.xlsx`
    );
  }

  async function exportPdf() {
    const [{ jsPDF }, autoTableMod] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const autoTable = (autoTableMod as any).default || autoTableMod;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const data = exportRows();
    const fontName = "NotoSansSC";
    await registerNotoSansSC(doc);
    const vendorName = displayVendorName(rows);
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 10;
    const usableWidth = pageWidth - margin * 2;
    const payableTotal = rows.reduce((sum, row) => sum + payableRowAmount(row), 0);

    doc.setFontSize(14);
    doc.text("Subcontract Vendor Ledger", margin, 14);
    doc.setFontSize(9);
    doc.text(`Vendor: ${vendorName}`, margin, 21);
    doc.text(`Export Date: ${exportDate()} / Status: ${filterStatus} / Lines: ${rows.length}`, margin, 27);
    doc.text(`Payable Total: ${payableTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, margin, 33);
    autoTable(doc, {
      startY: 39,
      head: [[
        "Due Date", "PO", "WS", "Receipt", "Qty", "Unit", "Gross",
        "Deduction", "Payable", "Paid Date", "Status",
      ]],
      body: data.map((row) => [
        row["Due Date"],
        row.PO,
        row["Work Sheet"],
        row["Receipt Date"],
        row.Qty.toLocaleString(),
        `${row.Currency} ${row["Unit Cost"].toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        `${row.Currency} ${row.Gross.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        `${row.Currency} ${row.Deduction.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        `${row.Currency} ${row.Payable.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        row["Paid Date"],
        row.Status,
      ]),
      tableWidth: usableWidth,
      styles: {
        font: fontName,
        fontStyle: "normal",
        fontSize: 7,
        cellPadding: 1.6,
        overflow: "linebreak",
        valign: "middle",
        lineWidth: 0.1,
        lineColor: [220, 226, 235],
      },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      bodyStyles: { font: fontName, fontStyle: "normal", textColor: [30, 41, 59] },
      columnStyles: {
        0: { cellWidth: 22 },
        1: { cellWidth: 23 },
        2: { cellWidth: 26 },
        3: { cellWidth: 22 },
        4: { halign: "right", cellWidth: 18 },
        5: { halign: "right", cellWidth: 24 },
        6: { halign: "right" },
        7: { halign: "right" },
        8: { halign: "right" },
        9: { cellWidth: 22 },
        10: { cellWidth: 18 },
      },
      margin: { left: margin, right: margin },
    });
    doc.save(`subcontract_payables_${exportDate()}.pdf`);
  }

  return (
    <AppShell title="Production / Subcontract Payables">
      <div className="space-y-4 p-4 text-sm">
        <div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Subcontract Payables</h1>
            <p className="mt-1 text-xs text-gray-500">Receive outsourced work and schedule vendor payment, default 60 days after receipt.</p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-gray-600">
              <span className="rounded bg-gray-100 px-2 py-0.5">All {statusCounts.all}</span>
              <span className="rounded bg-blue-50 px-2 py-0.5 text-blue-700">Open {statusCounts.open}</span>
              <span className="rounded bg-green-50 px-2 py-0.5 text-green-700">Paid {statusCounts.paid}</span>
              <span className="rounded bg-gray-100 px-2 py-0.5">Void {statusCounts.void}</span>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Select value={filterVendorId} onValueChange={setFilterVendorId}>
              <SelectTrigger className="h-8 w-[220px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Vendors</SelectItem>
                {vendors.map((row) => (
                  <SelectItem key={row.id} value={row.id}>{row.company_name || row.code || row.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={onFilterStatusChange}>
              <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="OPEN">Open</SelectItem>
                <SelectItem value="PARTIAL">Partial</SelectItem>
                <SelectItem value="PAID">Paid</SelectItem>
                <SelectItem value="VOID">Void</SelectItem>
                <SelectItem value="ALL">All</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterDateType} onValueChange={(value) => setFilterDateType(value as "DUE" | "PAID")}>
              <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="DUE">Due Date</SelectItem>
                <SelectItem value="PAID">Paid Date</SelectItem>
              </SelectContent>
            </Select>
            <Input type="date" className="h-8 w-[210px] text-xs" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
            <Input type="date" className="h-8 w-[210px] text-xs" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
            <Input className="h-8 min-w-[220px] flex-1 text-xs" value={filterQ} onChange={(e) => setFilterQ(e.target.value)} placeholder="PO / WS / Vendor" />
            <Button onClick={exportExcel} className={`${outlineBtnCls} w-[92px]`} disabled={rows.length === 0}>Excel</Button>
            <Button onClick={exportPdf} className={`${outlineBtnCls} w-[92px]`} disabled={rows.length === 0}>PDF</Button>
            <Button onClick={loadRows} className={`${btnCls} w-[110px]`} disabled={loading}>{loading ? "Loading..." : "Refresh"}</Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="rounded border bg-white px-2.5 py-1 text-xs hover:bg-gray-50" onClick={() => setQuickPeriod("THIS_MONTH")} type="button">This Month</button>
            <button className="rounded border bg-white px-2.5 py-1 text-xs hover:bg-gray-50" onClick={() => setQuickPeriod("NEXT_30")} type="button">Next 30 Days</button>
            <button className="rounded border border-red-200 bg-white px-2.5 py-1 text-xs text-red-700 hover:bg-red-50" onClick={() => setQuickPeriod("OVERDUE")} type="button">Overdue {overdueCount}</button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
          <div className="rounded-lg border bg-white px-3 py-2">
            <div className="text-[11px] text-gray-500">Period</div>
            <div className="text-sm font-semibold">{filterFrom || "-"} to {filterTo || "-"}</div>
          </div>
          <div className="rounded-lg border bg-white px-3 py-2">
            <div className="text-[11px] text-gray-500">Total Payable</div>
            <div className="text-sm font-semibold">{periodSummary.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
          <div className="rounded-lg border bg-white px-3 py-2">
            <div className="text-[11px] text-gray-500">Paid in Period</div>
            <div className="text-sm font-semibold text-green-700">{periodSummary.paid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
          <div className="rounded-lg border bg-white px-3 py-2">
            <div className="text-[11px] text-gray-500">Unpaid / Scheduled</div>
            <div className="text-sm font-semibold text-blue-700">{periodSummary.unpaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
          <div className="rounded-lg border bg-white px-3 py-2">
            <div className="text-[11px] text-gray-500">Advance Balance</div>
            <div className="text-sm font-semibold text-amber-700">{openAdvanceBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
        </div>

        <Card className="rounded-lg">
          <CardHeader className="p-3">
            <CardTitle className="text-sm">Advance Payment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-3 pt-0">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
              <div>
                <label className="mb-1 block text-xs font-medium">Vendor</label>
                <Select value={advanceVendorId} onValueChange={(id) => {
                  const row = vendors.find((item) => item.id === id);
                  setAdvanceVendorId(id);
                  setAdvanceCurrency(row?.default_currency || "CNY");
                }}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Vendor" /></SelectTrigger>
                  <SelectContent>
                    {vendors.map((row) => (
                      <SelectItem key={row.id} value={row.id}>{row.company_name || row.code || row.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Date</label>
                <Input type="date" className="h-8 text-xs" value={advanceDate} onChange={(e) => setAdvanceDate(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Currency</label>
                <Select value={advanceCurrency} onValueChange={setAdvanceCurrency}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CNY">CNY</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="KRW">KRW</SelectItem>
                    <SelectItem value="VND">VND</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Amount</label>
                <Input className="h-8 text-xs" value={advanceAmount} onChange={(e) => setAdvanceAmount(e.target.value)} placeholder="0" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Account</label>
                <Select value={advanceAccountId} onValueChange={setAdvanceAccountId}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Cash / Bank" /></SelectTrigger>
                  <SelectContent>
                    {cashAccounts.filter((row) => row.currency === advanceCurrency).map((row) => (
                      <SelectItem key={cashAccountId(row)} value={cashAccountId(row)}>{row.account_code} / {row.account_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Method</label>
                <Select value={advanceMethod} onValueChange={setAdvanceMethod}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                    <SelectItem value="CASH">Cash</SelectItem>
                    <SelectItem value="CHECK">Check</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Action</label>
                <Button className={btnCls} onClick={saveAdvancePayment}>Save Advance</Button>
              </div>
            </div>
            <Input className="h-8 text-xs" value={advanceNote} onChange={(e) => setAdvanceNote(e.target.value)} placeholder="Advance note" />
            {advances.length > 0 ? (
              <div className="overflow-x-auto rounded-md border">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr className="border-b text-left">
                      <th className="px-2.5 py-2">Date</th>
                      <th className="px-2.5 py-2">Vendor</th>
                      <th className="px-2.5 py-2 text-right">Amount</th>
                      <th className="px-2.5 py-2 text-right">Applied</th>
                      <th className="px-2.5 py-2 text-right">Balance</th>
                      <th className="px-2.5 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {advances.slice(0, 5).map((row) => (
                      <tr key={row.id} className="border-b">
                        <td className="px-2.5 py-2">{row.advance_date}</td>
                        <td className="px-2.5 py-2">{row.vendor_name || "-"}</td>
                        <td className="px-2.5 py-2 text-right">{fmtMoney(row.currency, row.amount)}</td>
                        <td className="px-2.5 py-2 text-right">{fmtMoney(row.currency, row.applied_amount)}</td>
                        <td className="px-2.5 py-2 text-right font-semibold">{fmtMoney(row.currency, Math.max(Number(row.amount || 0) - Number(row.applied_amount || 0), 0))}</td>
                        <td className="px-2.5 py-2">{row.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader className="p-3">
            <CardTitle className="text-sm">Receive From Subcontractor</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-3 pt-0">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
              <div>
                <label className="mb-1 block text-xs font-medium">Vendor</label>
                <Select value={vendorId} onValueChange={onSelectVendor}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select Vendor" /></SelectTrigger>
                  <SelectContent>
                    {vendors.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.company_name || row.code || row.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Receipt Date</label>
                <Input type="date" className="h-8 text-xs" value={receiptDate} onChange={(e) => onReceiptDateChange(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Payment Cycle</label>
                <Select value={paymentCycle} onValueChange={onPaymentCycleChange}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NET_60">Net 60 Days</SelectItem>
                    <SelectItem value="NET_30">Net 30 Days</SelectItem>
                    <SelectItem value="WEEKLY">Weekly Friday</SelectItem>
                    <SelectItem value="HALF_MONTH">15th Cycle</SelectItem>
                    <SelectItem value="MONTH_END">Month End</SelectItem>
                    <SelectItem value="CUSTOM_DAYS">Custom Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Terms Days</label>
                <Input className="h-8 text-xs" value={termsDays} onChange={(e) => onTermsChange(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Due Date</label>
                <Input type="date" className="h-8 text-xs" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>

            <div className="rounded-md border border-gray-200">
              <div className="flex items-center justify-between border-b bg-gray-50 px-2.5 py-2">
                <div className="text-xs font-semibold">Work Sheets for Selected Vendor</div>
                <button className="rounded border px-2 py-1 text-xs hover:bg-white" onClick={toggleAllVendorWorkSheets} type="button">
                  {receivableVendorWorkSheets.length > 0 && receivableVendorWorkSheets.every((row) => selectedWorkSheetIds.includes(row.id)) ? "Clear" : "Select All"}
                </button>
              </div>
              <div className="max-h-56 overflow-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr className="border-b text-left">
                      <th className="px-2.5 py-2">Select</th>
                      <th className="px-2.5 py-2">WS</th>
                      <th className="px-2.5 py-2">PO</th>
                      <th className="px-2.5 py-2">Style</th>
                      <th className="px-2.5 py-2 text-right">Order Qty</th>
                      <th className="px-2.5 py-2 text-right">Received</th>
                      <th className="px-2.5 py-2 text-right">Remaining</th>
                      <th className="px-2.5 py-2 text-right">This Receipt</th>
                      <th className="px-2.5 py-2 text-right">Unit</th>
                      <th className="px-2.5 py-2 text-right">Gross</th>
                      <th className="px-2.5 py-2 text-right">Claim</th>
                      <th className="px-2.5 py-2 text-right">Other Deduct</th>
                      <th className="px-2.5 py-2 text-right">Payable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!vendorId ? (
                      <tr><td colSpan={13} className="px-2.5 py-4 text-center text-gray-500">Select vendor first</td></tr>
                    ) : receivableVendorWorkSheets.length === 0 ? (
                      <tr><td colSpan={13} className="px-2.5 py-4 text-center text-gray-500">No receivable work sheets for this vendor</td></tr>
                    ) : receivableVendorWorkSheets.map((row) => {
                      const remainingQty = remainingQtyOf(row);
                      return (
                      <tr key={row.id} className="border-b">
                        <td className="px-2.5 py-2">
                          <input
                            type="checkbox"
                            checked={selectedWorkSheetIds.includes(row.id)}
                            onChange={() => toggleWorkSheet(row.id)}
                          />
                        </td>
                        <td className="px-2.5 py-2 font-medium">{row.ws_no || "-"}</td>
                        <td className="px-2.5 py-2">{row.po_no || "-"}</td>
                        <td className="px-2.5 py-2">{row.buyer_style || row.jm_style || "-"}</td>
                        <td className="px-2.5 py-2 text-right">{orderQtyOf(row).toLocaleString()}</td>
                        <td className="px-2.5 py-2 text-right">{alreadyReceivedOf(row).toLocaleString()}</td>
                        <td className="px-2.5 py-2 text-right">{remainingQty.toLocaleString()}</td>
                        <td className="px-2.5 py-2 text-right">
                          <Input
                            type="number"
                            min="0"
                            max={remainingQty}
                            step="0.01"
                            className="h-7 w-24 text-right text-xs"
                            value={receiptQtyByWs[row.id] || ""}
                            disabled={!selectedWorkSheetIds.includes(row.id)}
                            onChange={(e) => {
                              const raw = e.target.value;
                              const n = Number(raw);
                              const next = raw === "" || !Number.isFinite(n)
                                ? raw
                                : String(Math.min(Math.max(n, 0), remainingQty));
                              setReceiptQtyByWs((prev) => ({ ...prev, [row.id]: next }));
                            }}
                          />
                        </td>
                        <td className="px-2.5 py-2 text-right">{fmtMoney(row.lp_currency || currency, unitCostOf(row))}</td>
                        <td className="px-2.5 py-2 text-right">{fmtMoney(currency, grossAmountOf(row))}</td>
                        <td className="px-2.5 py-2 text-right">
                          <Input
                            className="h-7 w-24 text-right text-xs"
                            value={claimDeductionByWs[row.id] || ""}
                            disabled={!selectedWorkSheetIds.includes(row.id)}
                            onChange={(e) => setClaimDeductionByWs((prev) => ({ ...prev, [row.id]: e.target.value }))}
                          />
                        </td>
                        <td className="px-2.5 py-2 text-right">
                          <Input
                            className="h-7 w-24 text-right text-xs"
                            value={otherDeductionByWs[row.id] || ""}
                            disabled={!selectedWorkSheetIds.includes(row.id)}
                            onChange={(e) => setOtherDeductionByWs((prev) => ({ ...prev, [row.id]: e.target.value }))}
                          />
                        </td>
                        <td className="px-2.5 py-2 text-right font-semibold">{fmtMoney(currency, payableAmountOf(row))}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
              <div>
                <label className="mb-1 block text-xs font-medium">Currency</label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CNY">CNY</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="KRW">KRW</SelectItem>
                    <SelectItem value="VND">VND</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Unit Cost</label>
                <Input className="h-8 text-xs" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="Fallback unit cost" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Terms Days</label>
                <Input className="h-8 text-xs" value={termsDays} onChange={(e) => onTermsChange(e.target.value)} placeholder="60" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Total</label>
                <div className={inputCls}>{fmtMoney(currency, totalAmount)}</div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Action</label>
                <Button onClick={savePayable} disabled={saving} className={btnCls}>{saving ? "Saving..." : "Save"}</Button>
              </div>
            </div>

            <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-4">
              <div className="rounded-md border bg-gray-50 px-2.5 py-1.5 text-xs text-gray-600 md:col-span-2">
                {selectedWorkSheets.length > 0 ? `${selectedWorkSheets.length} work sheet(s) selected / qty ${selectedQtyTotal.toLocaleString()}` : "Select one or more work sheets for the selected vendor."}
              </div>
              <div className="rounded-md border bg-gray-50 px-2.5 py-1.5 text-xs text-gray-600">
                {selectedVendor ? `${selectedVendor.company_name || selectedVendor.code || "-"} default ${selectedVendor.default_currency || currency}` : "Select subcontract vendor."}
              </div>
              <Button onClick={resetForm} className={outlineBtnCls}>Reset</Button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium">Claim Deduction Candidate</label>
                <Select value={selectedClaimId} onValueChange={applyClaimCandidate}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">No claim deduction</SelectItem>
                    {claimCandidates.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.deposit_date} / {row.reference_no || "-"} / {Number(row.subcontract_deduction_amount || 0).toLocaleString()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-md border bg-gray-50 px-2.5 py-1.5 text-xs text-gray-600">
                Select work sheet(s), then choose a claim to split its deduction into Claim fields.
              </div>
            </div>
            <Input className="h-8 text-xs" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" />
            {message ? <div className="text-xs text-red-600">{message}</div> : null}
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader className="p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm">Payment Schedule</CardTitle>
                <div className="mt-1 text-[11px] text-gray-500">
                  Selected {bulkSelectionInfo.count}
                  {bulkSelectionInfo.count > 0 ? ` / ${bulkSelectionInfo.vendorLabel} / ${bulkSelectionInfo.currencyLabel} / ${bulkSelectionInfo.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ""}
                </div>
                {bulkSelectionInfo.count > 0 && !bulkSelectionInfo.singleVendor ? (
                  <div className="text-[11px] text-red-600">Bulk payment requires one vendor only.</div>
                ) : null}
                {bulkSelectionInfo.count > 0 && !bulkSelectionInfo.singleCurrency ? (
                  <div className="text-[11px] text-red-600">Bulk payment requires one currency only.</div>
                ) : null}
              </div>
              <Button className={outlineBtnCls} onClick={openBulkPayment} disabled={selectedPayableRows.length === 0}>Bulk Payment</Button>
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            {payingRow || bulkPaying ? (
              <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-blue-900">{bulkPaying ? "Bulk Pay Subcontractor" : "Pay Subcontractor"}</div>
                    <div className="text-[11px] text-blue-700">
                      {bulkPaying ? `${selectedPayableRows.length} payable line(s) selected` : `${payingRow?.vendor_name || "-"} / ${payingRow?.po_no || "-"} / ${payingRow?.work_sheet_no || "-"}`}
                    </div>
                  </div>
                  <button className={outlineBtnCls} onClick={() => { setPayingRow(null); setBulkPaying(false); }} type="button">Cancel</button>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
                  <div>
                    <label className="mb-1 block text-xs font-medium">Paid Date</label>
                    <Input type="date" className="h-8 text-xs" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium">Paid Amount</label>
                    <Input className="h-8 text-xs" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium">Payment Account</label>
                    <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Cash / Bank" /></SelectTrigger>
                      <SelectContent>
                        {paymentAccountsForRow.map((row) => (
                          <SelectItem key={cashAccountId(row)} value={cashAccountId(row)}>
                            {row.account_code} / {row.account_name} / {row.currency}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium">Method</label>
                    <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                        <SelectItem value="CASH">Cash</SelectItem>
                        <SelectItem value="CHECK">Check</SelectItem>
                        <SelectItem value="OTHER">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-medium">Memo</label>
                    <Input className="h-8 text-xs" value={paymentMemo} onChange={(e) => setPaymentMemo(e.target.value)} />
                  </div>
                </div>
                <div className="mt-2 flex justify-end">
                  <Button className={btnCls} onClick={bulkPaying ? confirmBulkPayment : confirmPayment}>Confirm Payment + Cashbook</Button>
                </div>
              </div>
            ) : null}
            <div className="overflow-x-auto rounded-md border">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50">
                  <tr className="border-b text-left">
                    <th className="px-2.5 py-2">Select</th>
                    <th className="px-2.5 py-2">Due Date</th>
                    <th className="px-2.5 py-2">Vendor</th>
                    <th className="px-2.5 py-2">PO / WS</th>
                    <th className="px-2.5 py-2">Receipt</th>
                    <th className="px-2.5 py-2 text-right">Qty</th>
                    <th className="px-2.5 py-2 text-right">Unit</th>
                    <th className="px-2.5 py-2 text-right">Gross</th>
                    <th className="px-2.5 py-2 text-right">Deduction</th>
                    <th className="px-2.5 py-2 text-right">Payable</th>
                    <th className="px-2.5 py-2">Paid Date</th>
                    <th className="px-2.5 py-2">Status</th>
                    <th className="px-2.5 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={13} className="px-2.5 py-5 text-center text-gray-500">No data</td></tr>
                  ) : rows.map((row) => (
                    <tr key={row.id} className={`border-b ${isOverdue(row) ? "bg-red-50" : ""}`}>
                      <td className="px-2.5 py-2">
                        {row.status !== "PAID" && row.status !== "VOID" ? (
                          <input type="checkbox" checked={selectedPayableIds.includes(row.id)} onChange={() => togglePayableSelection(row.id)} />
                        ) : null}
                      </td>
                      <td className="px-2.5 py-2 font-medium">{row.due_date}</td>
                      <td className="px-2.5 py-2">{row.vendor_name || "-"}</td>
                      <td className="px-2.5 py-2">{row.po_no || "-"}<div className="text-[11px] text-gray-500">{row.work_sheet_no || "-"}</div></td>
                      <td className="px-2.5 py-2">{row.receipt_date}</td>
                      <td className="px-2.5 py-2 text-right">{Number(row.received_qty || 0).toLocaleString()}</td>
                      <td className="px-2.5 py-2 text-right">{fmtMoney(row.currency, row.unit_cost)}</td>
                      <td className="px-2.5 py-2 text-right">{fmtMoney(row.currency, row.gross_amount ?? Number(row.received_qty || 0) * Number(row.unit_cost || 0))}</td>
                      <td className="px-2.5 py-2 text-right">
                        {fmtMoney(row.currency, Number(row.claim_deduction_amount || 0) + Number(row.other_deduction_amount || 0))}
                      </td>
                      <td className="px-2.5 py-2 text-right font-semibold">{fmtMoney(row.currency, payableRowAmount(row))}</td>
                      <td className="px-2.5 py-2">{row.paid_date || "-"}</td>
                      <td className="px-2.5 py-2">
                        <span className={`rounded px-2 py-0.5 ${statusClass(row.status)}`}>{row.status}</span>
                        {isOverdue(row) ? <div className="mt-1 text-[11px] font-semibold text-red-700">Overdue</div> : null}
                      </td>
                      <td className="px-2.5 py-2">
                        <div className="flex gap-1">
                          {row.status !== "PAID" && row.status !== "VOID" ? <button className="rounded border px-2 py-1 text-blue-700 hover:bg-blue-50" onClick={() => openPayment(row)}>Pay</button> : null}
                          {row.status !== "PAID" && row.status !== "VOID" ? <button className="rounded border px-2 py-1 text-red-600 hover:bg-red-50" onClick={() => voidRow(row)}>Void</button> : null}
                          {row.status === "PAID" || row.status === "VOID" ? <button className="rounded border px-2 py-1 text-gray-700 hover:bg-gray-50" onClick={() => restoreRow(row)}>Reopen</button> : null}
                          <button className="rounded border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50" onClick={() => deleteRow(row)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
