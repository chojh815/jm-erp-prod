"use client";

import * as React from "react";
import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type PayableType = "MATERIAL" | "PROCESSING";
type SourceType = "WORK_SHEET" | "EXTRA";

type WorkSheetOption = {
  id: string;
  po_no?: string | null;
  ws_no?: string | null;
  buyer_style?: string | null;
  jm_style?: string | null;
  production_mode?: string | null;
};

type WorkSheetLine = {
  id: string;
  qty?: number | null;
  jm_style_no?: string | null;
  buyer_style?: string | null;
  description?: string | null;
  production_mode?: string | null;
  vendor_id?: string | null;
};

type WorkSheetMaterialSpec = {
  id: string;
  work_sheet_line_id: string;
  material_type?: string | null;
  material_name: string;
  spec_text?: string | null;
  note?: string | null;
  source_vendor_id?: string | null;
  source_vendor_text?: string | null;
};

type Vendor = {
  id: string;
  company_name: string | null;
  code: string | null;
  default_currency?: string | null;
};

type CashAccount = {
  account_id?: string;
  id?: string;
  account_code: string;
  account_name: string;
  currency: string;
  is_active?: boolean;
};

type PayableRow = {
  id: string;
  work_sheet_id: string;
  work_sheet_line_id: string | null;
  work_sheet_material_spec_id?: string | null;
  vendor_id: string;
  po_no: string | null;
  work_sheet_no: string | null;
  vendor_name: string | null;
  style_no?: string | null;
  buyer_style?: string | null;
  payable_type: PayableType;
  source_type: SourceType;
  reason_code?: string | null;
  entry_date: string;
  item_name: string;
  spec_text?: string | null;
  qty: number;
  currency: string;
  unit_cost: number;
  gross_amount: number;
  payment_terms_days: number;
  due_date: string;
  status: "OPEN" | "PAID" | "VOID";
  paid_amount: number;
  paid_date?: string | null;
  payment_account_id?: string | null;
  payment_method?: string | null;
  cash_transaction_id?: string | null;
  note?: string | null;
};

const inputCls =
  "h-9 w-full rounded-md border border-gray-300 px-2.5 text-sm outline-none focus:border-blue-500";
const btnCls =
  "h-9 rounded-md bg-blue-600 px-3 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const outlineBtnCls =
  "h-9 rounded-md border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-50";
const CURRENCY_OPTIONS = ["CNY", "USD", "KRW", "VND"] as const;

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

function fmtMoney(currency: string, value: number | null | undefined) {
  return `${currency || ""} ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function accountId(row: CashAccount) {
  return row.account_id || row.id || "";
}

function statusClass(status: string) {
  if (status === "PAID") return "bg-green-100 text-green-700";
  if (status === "VOID") return "bg-gray-100 text-gray-600";
  return "bg-blue-100 text-blue-700";
}

function payableAmount(row: PayableRow) {
  return Number(row.gross_amount || Number(row.qty || 0) * Number(row.unit_cost || 0));
}

function workSheetOptionLabel(row: WorkSheetOption) {
  const po = row.po_no || "-";
  const style = row.buyer_style || row.jm_style || "";
  const ws = row.ws_no || "";
  if (style && ws) return `${po} / ${style} / ${ws}`;
  if (style) return `${po} / ${style}`;
  if (ws) return `${po} / ${ws}`;
  return po || row.id;
}

function lineOptionLabel(row: WorkSheetLine) {
  const buyerStyle = row.buyer_style || "";
  const jmStyle = row.jm_style_no || "";
  const desc = row.description || "";
  if (buyerStyle && jmStyle) return `${buyerStyle} / ${jmStyle}`;
  if (buyerStyle) return buyerStyle;
  if (jmStyle && desc) return `${jmStyle} / ${desc}`;
  if (jmStyle) return jmStyle;
  if (desc) return desc;
  return row.id;
}

function materialSpecLabel(row: WorkSheetMaterialSpec, orderQty?: number | null) {
  const perUnitQty = extractQtyFromNote(row.note);
  const unitCost = extractUnitCostFromNote(row.note);
  const safeOrderQty = Number(orderQty || 0);
  const totalQty =
    perUnitQty !== null && Number.isFinite(safeOrderQty) ? perUnitQty * safeOrderQty : null;

  const meta: string[] = [];
  if (totalQty !== null && totalQty > 0) meta.push(`Qty ${totalQty.toLocaleString()}`);
  else if (perUnitQty !== null) meta.push(`Per unit ${perUnitQty.toLocaleString()}`);
  if (unitCost !== null) meta.push(`Unit ${unitCost.toLocaleString()}`);

  const spec = row.spec_text?.trim();
  const pieces = [row.material_name];
  if (spec) pieces.push(spec);
  if (meta.length > 0) pieces.push(meta.join(" / "));
  return pieces.join(" | ");
}

function extractQtyFromNote(note?: string | null): number | null {
  const s = (note ?? "").toString();
  const m = s.match(/\bQTY\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)\b/i);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function extractUnitCostFromNote(note?: string | null): number | null {
  const s = (note ?? "").toString();
  const m = s.match(/\bUNIT[_\s-]*COST\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)\b/i);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export default function InhousePayablesPage() {
  const [rows, setRows] = React.useState<PayableRow[]>([]);
  const [workSheets, setWorkSheets] = React.useState<WorkSheetOption[]>([]);
  const [vendors, setVendors] = React.useState<Vendor[]>([]);
  const [cashAccounts, setCashAccounts] = React.useState<CashAccount[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [messageTone, setMessageTone] = React.useState<"error" | "success">("error");

  const [tab, setTab] = React.useState<PayableType>("MATERIAL");
  const [workSheetId, setWorkSheetId] = React.useState("");
  const [lineId, setLineId] = React.useState("");
  const [sourceType, setSourceType] = React.useState<SourceType>("WORK_SHEET");
  const [specId, setSpecId] = React.useState("");
  const [vendorId, setVendorId] = React.useState("");
  const [entryDate, setEntryDate] = React.useState(today());
  const [currency, setCurrency] = React.useState("CNY");
  const [qty, setQty] = React.useState("");
  const [unitCost, setUnitCost] = React.useState("");
  const [termsDays, setTermsDays] = React.useState("30");
  const [dueDate, setDueDate] = React.useState(addDays(today(), 30));
  const [itemName, setItemName] = React.useState("");
  const [specText, setSpecText] = React.useState("");
  const [reasonCode, setReasonCode] = React.useState("MISSING_IN_WS");
  const [note, setNote] = React.useState("");

  const [detailLines, setDetailLines] = React.useState<WorkSheetLine[]>([]);
  const [materialsByLineId, setMaterialsByLineId] = React.useState<Record<string, WorkSheetMaterialSpec[]>>({});

  const [filterStatus, setFilterStatus] = React.useState("ALL");
  const [filterVendorId, setFilterVendorId] = React.useState("ALL");
  const [filterDateType, setFilterDateType] = React.useState<"DUE" | "PAID">("DUE");
  const [filterFrom, setFilterFrom] = React.useState(monthStart());
  const [filterTo, setFilterTo] = React.useState(monthEnd());
  const [filterQ, setFilterQ] = React.useState("");

  const [payingRow, setPayingRow] = React.useState<PayableRow | null>(null);
  const [paymentDate, setPaymentDate] = React.useState(today());
  const [paymentAccountId, setPaymentAccountId] = React.useState("");
  const [paymentMethod, setPaymentMethod] = React.useState("BANK_TRANSFER");
  const [paymentMemo, setPaymentMemo] = React.useState("");

  const activeCashAccounts = React.useMemo(
    () => cashAccounts.filter((row) => row.is_active !== false),
    [cashAccounts]
  );

  const selectedLine = React.useMemo(
    () => detailLines.find((row) => row.id === lineId) || null,
    [detailLines, lineId]
  );

  const availableSpecs = React.useMemo(() => {
    const list = materialsByLineId[lineId] || [];
    return list.filter((row) => {
      const type = String(row.material_type || "").toUpperCase();
      return tab === "MATERIAL" ? type === "MATERIAL" : type !== "MATERIAL";
    });
  }, [lineId, materialsByLineId, tab]);

  const selectedSpec = React.useMemo(
    () => availableSpecs.find((row) => row.id === specId) || null,
    [availableSpecs, specId]
  );

  const visibleRows = React.useMemo(() => {
    return rows.filter((row) => row.payable_type === tab);
  }, [rows, tab]);

  const amount = React.useMemo(() => {
    const q = Number(qty || 0);
    const u = Number(unitCost || 0);
    if (!Number.isFinite(q) || !Number.isFinite(u)) return 0;
    return q * u;
  }, [qty, unitCost]);

  const validationMessage = React.useMemo(() => {
    if (!workSheetId) return "PO / Work Sheet를 선택하세요.";
    if (!lineId) return "Line을 선택하세요.";
    if (!vendorId) return "Vendor를 선택하세요.";
    if (sourceType === "WORK_SHEET" && !specId) {
      return tab === "MATERIAL"
        ? "Material Row를 선택하세요."
        : "Operation Row를 선택하세요.";
    }
    if (sourceType === "EXTRA" && !itemName.trim()) return "품목명을 입력하세요.";
    if (!(Number(qty || 0) > 0)) return "Qty는 0보다 커야 합니다.";
    if (!(Number(unitCost || 0) >= 0)) return "Unit Cost를 확인하세요.";
    return "";
  }, [workSheetId, lineId, vendorId, sourceType, specId, tab, itemName, qty, unitCost]);

  const canSave = !validationMessage && !saving;

  const summary = React.useMemo(() => {
    return visibleRows.reduce(
      (acc, row) => {
        const amt = payableAmount(row);
        acc.total += amt;
        if (row.status === "PAID") acc.paid += amt;
        if (row.status === "OPEN") acc.open += amt;
        return acc;
      },
      { total: 0, paid: 0, open: 0 }
    );
  }, [visibleRows]);

  async function loadWorkSheets() {
    const res = await fetch("/api/work-sheets/list?all=1", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json?.success) throw new Error(json?.error || "Failed to load work sheets");
    const list = (json.rows || []).filter(
      (row: any) => String(row?.production_mode || "").toUpperCase() === "IN_HOUSE"
    );
    setWorkSheets(list);
  }

  async function loadVendors() {
    const res = await fetch("/api/work-sheets/vendors?limit=1000", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json?.success) throw new Error(json?.error || "Failed to load vendors");
    setVendors(json.rows || []);
  }

  async function loadCashAccounts() {
    const res = await fetch("/api/finance/cash-accounts?active_only=true", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to load cash accounts");
    setCashAccounts(json.items || []);
  }

  async function loadRows(options?: {
    preserveMessage?: boolean;
    dueFrom?: string;
    dueTo?: string;
    paidFrom?: string;
    paidTo?: string;
  }) {
    setLoading(true);
    if (!options?.preserveMessage) {
      setMessage("");
      setMessageTone("error");
    }
    try {
      const params = new URLSearchParams();
      if (filterStatus !== "ALL") params.set("status", filterStatus);
      if (filterVendorId !== "ALL") params.set("vendor_id", filterVendorId);
      if (filterQ.trim()) params.set("q", filterQ.trim());
      if (filterDateType === "DUE") {
        params.set("due_from", options?.dueFrom || filterFrom);
        params.set("due_to", options?.dueTo || filterTo);
      } else {
        params.set("paid_from", options?.paidFrom || filterFrom);
        params.set("paid_to", options?.paidTo || filterTo);
      }
      params.set("limit", "1000");
      const res = await fetch(`/api/production/inhouse-payables?${params.toString()}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || "Failed to load rows");
      setRows(json.rows || []);
    } catch (e: any) {
      setMessage(e?.message || "Failed to load rows");
      setMessageTone("error");
    } finally {
      setLoading(false);
    }
  }

  async function loadWorkSheetDetail(id: string) {
    if (!id) {
      setDetailLines([]);
      setMaterialsByLineId({});
      setLineId("");
      return;
    }
    const res = await fetch(`/api/work-sheets/${id}`, { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json?.success) throw new Error(json?.error || "Failed to load work sheet detail");
    const rawLines = json.lines || [];
    const filteredLines = rawLines.filter(
      (row: any) => String(row?.production_mode || "").toUpperCase() === "IN_HOUSE"
    );
    const lines = filteredLines.length > 0 ? filteredLines : rawLines;
    setDetailLines(lines);
    setMaterialsByLineId(json.materialsByLineId || {});
    setLineId((current) => {
      if (current && lines.some((row: any) => row.id === current)) return current;
      return lines[0]?.id || "";
    });
  }

  async function refreshAll() {
    await Promise.all([loadWorkSheets(), loadVendors(), loadCashAccounts(), loadRows()]);
  }

  React.useEffect(() => {
    void (async () => {
      try {
        await refreshAll();
      } catch (e: any) {
        setMessage(e?.message || "Failed to initialize inhouse payables");
        setMessageTone("error");
      }
    })();
  }, []);

  React.useEffect(() => {
    void loadWorkSheetDetail(workSheetId).catch((e: any) => {
      setMessage(e?.message || "Failed to load work sheet detail");
      setMessageTone("error");
    });
  }, [workSheetId]);

  React.useEffect(() => {
    if (detailLines.length === 0) return;
    if (lineId && detailLines.some((row) => row.id === lineId)) return;
    setLineId(detailLines[0].id);
  }, [detailLines, lineId]);

  React.useEffect(() => {
    setSpecId("");
    setQty("");
    setUnitCost("");
    if (sourceType === "EXTRA") {
      setItemName("");
      setSpecText("");
    }
  }, [tab, lineId, sourceType]);

  React.useEffect(() => {
    if (sourceType !== "WORK_SHEET") return;
    if (!lineId) return;
    if (specId && availableSpecs.some((row) => row.id === specId)) return;
    if (availableSpecs.length > 0) {
      setSpecId(availableSpecs[0].id);
    }
  }, [sourceType, lineId, specId, availableSpecs]);

  React.useEffect(() => {
    if (sourceType !== "WORK_SHEET") return;
    if (!selectedSpec) {
      setQty("");
      setUnitCost("");
      return;
    }

    const perUnitQty = extractQtyFromNote(selectedSpec.note) ?? 0;
    const orderQty = Number(selectedLine?.qty || 0);
    const defaultQty =
      perUnitQty > 0 && Number.isFinite(orderQty) ? perUnitQty * orderQty : 0;
    const defaultUnitCost = extractUnitCostFromNote(selectedSpec.note) ?? 0;

    setItemName(selectedSpec.material_name || "");
    setSpecText(selectedSpec.spec_text || "");
    setQty(defaultQty > 0 ? String(defaultQty) : "");
    setUnitCost(defaultUnitCost > 0 ? String(defaultUnitCost) : "");
  }, [sourceType, selectedSpec, selectedLine]);

  React.useEffect(() => {
    if (vendorId) return;

    const candidateIds = [
      selectedSpec?.source_vendor_id,
      selectedLine?.vendor_id,
    ]
      .map((value) => (value ?? "").toString().trim())
      .filter(Boolean);

    const match = candidateIds.find((candidateId) =>
      vendors.some((row) => String(row.id) === candidateId)
    );

    if (match) {
      setVendorId(match);
    }
  }, [vendorId, selectedSpec, selectedLine, vendors]);

  React.useEffect(() => {
    setDueDate(addDays(entryDate, Number(termsDays || 0)));
  }, [entryDate, termsDays]);

  function resetEntry() {
    setLineId("");
    setSourceType("WORK_SHEET");
    setSpecId("");
    setVendorId("");
    setEntryDate(today());
    setCurrency("CNY");
    setQty("");
    setUnitCost("");
    setTermsDays("30");
    setDueDate(addDays(today(), 30));
    setItemName("");
    setSpecText("");
    setReasonCode("MISSING_IN_WS");
    setNote("");
  }

  async function saveEntry() {
    if (!workSheetId) {
      setMessageTone("error");
      return setMessage("Work sheet is required");
    }
    if (!lineId) {
      setMessageTone("error");
      return setMessage("Work sheet line is required");
    }
    if (!vendorId) {
      setMessageTone("error");
      return setMessage("Vendor is required");
    }
    if (!entryDate) {
      setMessageTone("error");
      return setMessage("Entry date is required");
    }
    if (sourceType === "WORK_SHEET" && !specId) {
      setMessageTone("error");
      return setMessage("Planned material/processing row is required");
    }
    if (sourceType === "EXTRA" && !itemName.trim()) {
      setMessageTone("error");
      return setMessage("Extra item name is required");
    }

    setSaving(true);
    setMessage("");
    setMessageTone("error");
    try {
      const res = await fetch("/api/production/inhouse-payables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          work_sheet_id: workSheetId,
          work_sheet_line_id: lineId,
          work_sheet_material_spec_id: sourceType === "WORK_SHEET" ? specId : null,
          vendor_id: vendorId,
          payable_type: tab,
          source_type: sourceType,
          entry_date: entryDate,
          qty: Number(qty || 0),
          unit_cost: Number(unitCost || 0),
          payment_terms_days: Number(termsDays || 0),
          due_date: dueDate,
          currency,
          item_name: itemName || null,
          spec_text: specText || null,
          reason_code: sourceType === "EXTRA" ? reasonCode : null,
          note,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || "Failed to save inhouse payable");
      const nextDueFrom = filterDateType === "DUE" && filterFrom > dueDate ? dueDate : filterFrom;
      const nextDueTo = filterDateType === "DUE" && filterTo < dueDate ? dueDate : filterTo;
      if (filterDateType === "DUE") {
        if (nextDueFrom !== filterFrom) setFilterFrom(nextDueFrom);
        if (nextDueTo !== filterTo) setFilterTo(nextDueTo);
      }
      setMessage(
        filterDateType === "DUE" && (nextDueFrom !== filterFrom || nextDueTo !== filterTo)
          ? "Saved successfully. Payment Schedule date filter was expanded to include the new due date."
          : "Saved successfully."
      );
      setMessageTone("success");
      resetEntry();
      await loadRows({
        preserveMessage: true,
        dueFrom: nextDueFrom,
        dueTo: nextDueTo,
      });
    } catch (e: any) {
      setMessage(e?.message || "Failed to save inhouse payable");
      setMessageTone("error");
    } finally {
      setSaving(false);
    }
  }

  async function payRow() {
    if (!payingRow) return;
    const account = activeCashAccounts.find((row) => accountId(row) === paymentAccountId);
    if (!account) return setMessage("Payment account is required");
    if (account.currency !== payingRow.currency) {
      return setMessage(`Payment account currency must be ${payingRow.currency}`);
    }

    setSaving(true);
    setMessage("");
    setMessageTone("error");
    try {
      const amount = payableAmount(payingRow);
      const cashRes = await fetch("/api/finance/cash-ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: paymentAccountId,
          tx_date: paymentDate,
          in_out: "OUT",
          category: "EXPENSE",
          ref_type: "inhouse_payable",
          ref_id: payingRow.id,
          description: `${payingRow.payable_type === "MATERIAL" ? "Inhouse material" : "Inhouse processing"} payment - ${payingRow.vendor_name || ""}`,
          memo: paymentMemo || null,
          counterparty_type: "VENDOR",
          counterparty_id: payingRow.vendor_id,
          counterparty_name: payingRow.vendor_name,
          amount,
          purpose_code: "PURCHASE_PAYMENT",
          purpose_group: "Direct Cost",
        }),
      });
      const cashJson = await cashRes.json();
      if (!cashRes.ok || !cashJson?.ok) throw new Error(cashJson?.error || "Failed to create cashbook line");

      const res = await fetch(`/api/production/inhouse-payables/${payingRow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "PAID",
          paid_amount: amount,
          paid_date: paymentDate,
          payment_account_id: paymentAccountId,
          payment_method: paymentMethod,
          cash_transaction_id: cashJson.item?.id || null,
          note: payingRow.note,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || "Failed to mark paid");
      setPayingRow(null);
      setPaymentAccountId("");
      setPaymentMemo("");
      await loadRows();
    } catch (e: any) {
      setMessage(e?.message || "Failed to pay row");
      setMessageTone("error");
    } finally {
      setSaving(false);
    }
  }

  async function patchRow(row: PayableRow, payload: Record<string, any>, fallbackMessage: string) {
    setSaving(true);
    setMessage("");
    setMessageTone("error");
    try {
      const res = await fetch(`/api/production/inhouse-payables/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || fallbackMessage);
      await loadRows();
    } catch (e: any) {
      setMessage(e?.message || fallbackMessage);
      setMessageTone("error");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRow(row: PayableRow) {
    if (!window.confirm("Delete this inhouse payable?")) return;
    setSaving(true);
    setMessage("");
    setMessageTone("error");
    try {
      const res = await fetch(`/api/production/inhouse-payables/${row.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || "Failed to delete row");
      await loadRows();
    } catch (e: any) {
      setMessage(e?.message || "Failed to delete row");
      setMessageTone("error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Inhouse Payables</h1>
            <p className="text-sm text-gray-500">
              Register planned or extra material/processing payables for inhouse production and settle them through cashbook.
            </p>
          </div>
          <Button className={outlineBtnCls} onClick={() => void loadRows()}>
            Refresh
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold">{fmtMoney("CNY", summary.total)}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Paid</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold text-green-600">{fmtMoney("CNY", summary.paid)}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Open</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold text-blue-600">{fmtMoney("CNY", summary.open)}</CardContent>
          </Card>
        </div>

        <Tabs value={tab} onValueChange={(value) => setTab(value as PayableType)}>
          <TabsList>
            <TabsTrigger value="MATERIAL">Material</TabsTrigger>
            <TabsTrigger value="PROCESSING">Processing</TabsTrigger>
          </TabsList>

          <TabsContent value="MATERIAL" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Register Material Payable</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-4">
                  <div>
                    <Label>PO / Work Sheet</Label>
                    <Select value={workSheetId} onValueChange={setWorkSheetId}>
                      <SelectTrigger className={inputCls}>
                        <SelectValue placeholder="Select PO / work sheet" />
                      </SelectTrigger>
                      <SelectContent>
                        {workSheets.map((row) => (
                          <SelectItem key={row.id} value={row.id}>
                            {workSheetOptionLabel(row)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Line</Label>
                    <Select value={lineId} onValueChange={setLineId}>
                      <SelectTrigger className={inputCls}>
                        <SelectValue placeholder="Select line" />
                      </SelectTrigger>
                      <SelectContent>
                        {detailLines.map((row) => (
                          <SelectItem key={row.id} value={row.id}>
                            {lineOptionLabel(row)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Source</Label>
                    <Select value={sourceType} onValueChange={(value) => setSourceType(value as SourceType)}>
                      <SelectTrigger className={inputCls}>
                        <SelectValue placeholder="Source" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="WORK_SHEET">Planned from Work Sheet</SelectItem>
                        <SelectItem value="EXTRA">Extra Material</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Vendor</Label>
                    <Select value={String(vendorId || "")} onValueChange={(value) => setVendorId(String(value || ""))}>
                      <SelectTrigger className={inputCls}>
                        <SelectValue placeholder="Select vendor" />
                      </SelectTrigger>
                      <SelectContent>
                        {vendors.map((row) => (
                          <SelectItem key={row.id} value={String(row.id)}>
                            {(row.company_name || row.code || row.id) as string}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {sourceType === "WORK_SHEET" ? (
                  <div>
                    <Label>Material Row</Label>
                    <Select value={specId} onValueChange={setSpecId}>
                      <SelectTrigger className={inputCls}>
                        <SelectValue placeholder="Select planned material" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableSpecs.map((row) => (
                          <SelectItem key={row.id} value={row.id}>
                            {materialSpecLabel(row, selectedLine?.qty)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-3">
                    <div>
                      <Label>Item / Material Name</Label>
                      <Input className={inputCls} value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="Extra material name" />
                    </div>
                    <div>
                      <Label>Spec</Label>
                      <Input className={inputCls} value={specText} onChange={(e) => setSpecText(e.target.value)} placeholder="Optional spec" />
                    </div>
                    <div>
                      <Label>Reason</Label>
                      <Select value={reasonCode} onValueChange={setReasonCode}>
                        <SelectTrigger className={inputCls}>
                          <SelectValue placeholder="Reason" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="MISSING_IN_WS">Missing in WS</SelectItem>
                          <SelectItem value="REPLACEMENT">Replacement</SelectItem>
                          <SelectItem value="ADDITIONAL_USAGE">Additional usage</SelectItem>
                          <SelectItem value="DEFECT_REORDER">Defect re-order</SelectItem>
                          <SelectItem value="EMERGENCY_PURCHASE">Emergency purchase</SelectItem>
                          <SelectItem value="PACKING_EXTRA">Packing extra</SelectItem>
                          <SelectItem value="OTHER">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-7">
                  <div>
                    <Label>Entry Date</Label>
                    <Input className={inputCls} type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
                  </div>
                  <div>
                    <Label>Currency</Label>
                    <Select value={currency} onValueChange={setCurrency}>
                      <SelectTrigger className={inputCls}>
                        <SelectValue placeholder="Currency" />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCY_OPTIONS.map((code) => (
                          <SelectItem key={code} value={code}>
                            {code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Qty</Label>
                    <Input className={inputCls} value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" />
                  </div>
                  <div>
                    <Label>Unit Cost</Label>
                    <Input className={inputCls} value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0" />
                  </div>
                  <div>
                    <Label>Amount</Label>
                    <Input className={`${inputCls} bg-gray-50`} value={fmtMoney(currency, amount)} readOnly />
                  </div>
                  <div>
                    <Label>Terms Days</Label>
                    <Input className={inputCls} value={termsDays} onChange={(e) => setTermsDays(e.target.value)} />
                  </div>
                  <div>
                    <Label>Due Date</Label>
                    <Input className={inputCls} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
                  <div>
                    <Label>Note</Label>
                    <Input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note" />
                    {validationMessage ? (
                      <div className="mt-2 text-sm text-amber-600">{validationMessage}</div>
                    ) : null}
                  </div>
                  <Button className={outlineBtnCls} onClick={resetEntry}>
                    Reset
                  </Button>
                  <Button className={btnCls} onClick={() => void saveEntry()} disabled={!canSave}>
                    {saving ? "Saving..." : "Save Material"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="PROCESSING" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Register Processing Payable</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-4">
                  <div>
                    <Label>PO / Work Sheet</Label>
                    <Select value={workSheetId} onValueChange={setWorkSheetId}>
                      <SelectTrigger className={inputCls}>
                        <SelectValue placeholder="Select PO / work sheet" />
                      </SelectTrigger>
                      <SelectContent>
                        {workSheets.map((row) => (
                          <SelectItem key={row.id} value={row.id}>
                            {workSheetOptionLabel(row)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Line</Label>
                    <Select value={lineId} onValueChange={setLineId}>
                      <SelectTrigger className={inputCls}>
                        <SelectValue placeholder="Select line" />
                      </SelectTrigger>
                      <SelectContent>
                        {detailLines.map((row) => (
                          <SelectItem key={row.id} value={row.id}>
                            {lineOptionLabel(row)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Source</Label>
                    <Select value={sourceType} onValueChange={(value) => setSourceType(value as SourceType)}>
                      <SelectTrigger className={inputCls}>
                        <SelectValue placeholder="Source" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="WORK_SHEET">Planned from Work Sheet</SelectItem>
                        <SelectItem value="EXTRA">Extra Processing</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Vendor</Label>
                    <Select value={String(vendorId || "")} onValueChange={(value) => setVendorId(String(value || ""))}>
                      <SelectTrigger className={inputCls}>
                        <SelectValue placeholder="Select vendor" />
                      </SelectTrigger>
                      <SelectContent>
                        {vendors.map((row) => (
                          <SelectItem key={row.id} value={String(row.id)}>
                            {(row.company_name || row.code || row.id) as string}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {sourceType === "WORK_SHEET" ? (
                  <div>
                    <Label>Operation Row</Label>
                    <Select value={specId} onValueChange={setSpecId}>
                      <SelectTrigger className={inputCls}>
                        <SelectValue placeholder="Select planned processing row" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableSpecs.map((row) => (
                          <SelectItem key={row.id} value={row.id}>
                            {materialSpecLabel(row, selectedLine?.qty)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-3">
                    <div>
                      <Label>Processing Name</Label>
                      <Input className={inputCls} value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="Extra processing name" />
                    </div>
                    <div>
                      <Label>Spec</Label>
                      <Input className={inputCls} value={specText} onChange={(e) => setSpecText(e.target.value)} placeholder="Optional spec" />
                    </div>
                    <div>
                      <Label>Reason</Label>
                      <Select value={reasonCode} onValueChange={setReasonCode}>
                        <SelectTrigger className={inputCls}>
                          <SelectValue placeholder="Reason" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="MISSING_IN_WS">Missing in WS</SelectItem>
                          <SelectItem value="REPLACEMENT">Replacement</SelectItem>
                          <SelectItem value="ADDITIONAL_USAGE">Additional usage</SelectItem>
                          <SelectItem value="DEFECT_REORDER">Defect re-order</SelectItem>
                          <SelectItem value="EMERGENCY_PURCHASE">Emergency purchase</SelectItem>
                          <SelectItem value="OTHER">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-7">
                  <div>
                    <Label>Entry Date</Label>
                    <Input className={inputCls} type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
                  </div>
                  <div>
                    <Label>Currency</Label>
                    <Select value={currency} onValueChange={setCurrency}>
                      <SelectTrigger className={inputCls}>
                        <SelectValue placeholder="Currency" />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCY_OPTIONS.map((code) => (
                          <SelectItem key={code} value={code}>
                            {code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Qty</Label>
                    <Input className={inputCls} value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" />
                  </div>
                  <div>
                    <Label>Unit Cost</Label>
                    <Input className={inputCls} value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0" />
                  </div>
                  <div>
                    <Label>Amount</Label>
                    <Input className={`${inputCls} bg-gray-50`} value={fmtMoney(currency, amount)} readOnly />
                  </div>
                  <div>
                    <Label>Terms Days</Label>
                    <Input className={inputCls} value={termsDays} onChange={(e) => setTermsDays(e.target.value)} />
                  </div>
                  <div>
                    <Label>Due Date</Label>
                    <Input className={inputCls} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
                  <div>
                    <Label>Note</Label>
                    <Input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note" />
                    {validationMessage ? (
                      <div className="mt-2 text-sm text-amber-600">{validationMessage}</div>
                    ) : null}
                  </div>
                  <Button className={outlineBtnCls} onClick={resetEntry}>
                    Reset
                  </Button>
                  <Button className={btnCls} onClick={() => void saveEntry()} disabled={!canSave}>
                    {saving ? "Saving..." : "Save Processing"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Card>
          <CardHeader>
            <CardTitle>Payment Schedule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {payingRow ? (
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-blue-900">Pay Inhouse Vendor</div>
                    <div className="text-xs text-blue-700">
                      {payingRow.vendor_name || "-"} / {payingRow.po_no || "-"} / {payingRow.work_sheet_no || "-"}
                    </div>
                  </div>
                  <Button className={outlineBtnCls} onClick={() => setPayingRow(null)}>
                    Cancel
                  </Button>
                </div>
                <div className="grid gap-3 md:grid-cols-6">
                  <div>
                    <Label>Paid Date</Label>
                    <Input className={inputCls} type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
                  </div>
                  <div>
                    <Label>Paid Amount</Label>
                    <Input className={`${inputCls} bg-gray-50`} value={fmtMoney(payingRow.currency, payableAmount(payingRow))} readOnly />
                  </div>
                  <div>
                    <Label>Payment Account</Label>
                    <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
                      <SelectTrigger className={inputCls}>
                        <SelectValue placeholder="Cash / Bank" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeCashAccounts
                          .filter((row) => row.currency === payingRow.currency)
                          .map((row) => (
                            <SelectItem key={accountId(row)} value={accountId(row)}>
                              {row.account_code} / {row.account_name} / {row.currency}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Method</Label>
                    <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                      <SelectTrigger className={inputCls}>
                        <SelectValue placeholder="Method" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                        <SelectItem value="CASH">Cash</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-2">
                    <Label>Memo</Label>
                    <Input className={inputCls} value={paymentMemo} onChange={(e) => setPaymentMemo(e.target.value)} placeholder="Optional memo" />
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <Button className={btnCls} onClick={() => void payRow()} disabled={saving}>
                    {saving ? "Saving..." : "Confirm Payment + Cashbook"}
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-5">
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className={inputCls}>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Status</SelectItem>
                  <SelectItem value="OPEN">Open</SelectItem>
                  <SelectItem value="PAID">Paid</SelectItem>
                  <SelectItem value="VOID">Void</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterVendorId} onValueChange={setFilterVendorId}>
                <SelectTrigger className={inputCls}>
                  <SelectValue placeholder="Vendor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Vendors</SelectItem>
                  {vendors.map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {(row.company_name || row.code || row.id) as string}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterDateType} onValueChange={(value) => setFilterDateType(value as "DUE" | "PAID")}>
                <SelectTrigger className={inputCls}>
                  <SelectValue placeholder="Date Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DUE">Due Date</SelectItem>
                  <SelectItem value="PAID">Paid Date</SelectItem>
                </SelectContent>
              </Select>
              <Input className={inputCls} type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
              <Input className={inputCls} type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <Input className={inputCls} value={filterQ} onChange={(e) => setFilterQ(e.target.value)} placeholder="Search by PO / WS / Vendor / Item" />
              <Button className={btnCls} onClick={() => void loadRows()}>
                Apply
              </Button>
            </div>

            {message ? (
              <div className={messageTone === "success" ? "text-sm text-green-600" : "text-sm text-red-600"}>
                {message}
              </div>
            ) : null}

            <div className="overflow-x-auto rounded-md border border-gray-200">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="border-b text-left">
                    <th className="px-3 py-2">Due Date</th>
                    <th className="px-3 py-2">Vendor</th>
                    <th className="px-3 py-2">PO / WS</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Unit</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td className="px-3 py-4 text-center text-gray-500" colSpan={10}>
                        Loading...
                      </td>
                    </tr>
                  ) : visibleRows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-4 text-center text-gray-500" colSpan={10}>
                        No data
                      </td>
                    </tr>
                  ) : (
                    visibleRows.map((row) => (
                      <tr key={row.id} className="border-b">
                        <td className="px-3 py-2">{row.due_date}</td>
                        <td className="px-3 py-2">{row.vendor_name || "-"}</td>
                        <td className="px-3 py-2">
                          <div>{row.po_no || "-"}</div>
                          <div className="text-xs text-gray-500">{row.work_sheet_no || "-"}</div>
                        </td>
                        <td className="px-3 py-2">
                          <span className="rounded-full bg-gray-100 px-2 py-1 text-xs">
                            {row.source_type === "WORK_SHEET" ? "Planned" : "Extra"}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div>{row.item_name}</div>
                          {row.spec_text ? <div className="text-xs text-gray-500">{row.spec_text}</div> : null}
                        </td>
                        <td className="px-3 py-2 text-right">{Number(row.qty || 0).toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{fmtMoney(row.currency, row.unit_cost)}</td>
                        <td className="px-3 py-2 text-right">{fmtMoney(row.currency, payableAmount(row))}</td>
                        <td className="px-3 py-2">
                          <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass(row.status)}`}>
                            {row.status}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            {row.status === "OPEN" ? (
                              <>
                                <Button className={btnCls} onClick={() => setPayingRow(row)}>
                                  Pay
                                </Button>
                                <Button
                                  className={outlineBtnCls}
                                  onClick={() => void patchRow(row, { status: "VOID" }, "Failed to void")}
                                >
                                  Void
                                </Button>
                              </>
                            ) : null}
                            {row.status === "PAID" ? (
                              <Button
                                className={outlineBtnCls}
                                onClick={() =>
                                  void patchRow(
                                    row,
                                    {
                                      status: "OPEN",
                                      paid_amount: 0,
                                      paid_date: null,
                                      payment_account_id: null,
                                      payment_method: null,
                                      cash_transaction_id: null,
                                    },
                                    "Failed to reopen"
                                  )
                                }
                              >
                                Reopen
                              </Button>
                            ) : null}
                            {row.status === "VOID" ? (
                              <Button
                                className={outlineBtnCls}
                                onClick={() => void patchRow(row, { status: "OPEN" }, "Failed to restore")}
                              >
                                Restore
                              </Button>
                            ) : null}
                            <Button className={outlineBtnCls} onClick={() => void deleteRow(row)}>
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
