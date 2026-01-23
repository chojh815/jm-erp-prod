"use client";

import * as React from "react";
import AppShell from "@/components/layout/AppShell";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";

type Buyer = { id: string; name: string };
type Inv = { id: string; invoice_no: string; currency: string | null; total_amount: number; applied_amount: number; balance: number };
type BankAccount = { id: string; account_name: string; currency?: string | null };

function pickName(r: any) {
  return r.company_name || r.name || r.companyName || r.buyer_name || r.company || r.email || r.code || r.id;
}

function fmt(v: any) {
  const x = Number(v || 0);
  return x.toLocaleString();
}

export default function CreditNotesPage() {
  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);
  const [buyers, setBuyers] = React.useState<Buyer[]>([]);
  const [banks, setBanks] = React.useState<BankAccount[]>([]);
  const [buyerId, setBuyerId] = React.useState("");
  const [bankId, setBankId] = React.useState("");
  const [date, setDate] = React.useState<string>(new Date().toISOString().slice(0, 10));
  const [ref, setRef] = React.useState("");
  const [note, setNote] = React.useState("");
  const [invoices, setInvoices] = React.useState<Inv[]>([]);
  const [amounts, setAmounts] = React.useState<Record<string, string>>({});
  const [msg, setMsg] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      // buyers
      try {
        const res = await fetch("/api/companies/buyers", { cache: "no-store" });
        const j = await res.json();
        const list = (j.data || j.rows || []).map((r: any) => ({ id: r.id, name: pickName(r) }));
        setBuyers(list);
      } catch {
        // fallback to direct query
        const { data } = await supabase.from("companies").select("id, company_name, name, company_type, type").order("company_name");
        const list = ((data as any) || []).map((r: any) => ({ id: r.id, name: pickName(r) }));
        setBuyers(list);
      }

      // bank accounts (optional for CREDIT)
      try {
        const { data: bdata } = await supabase
          .from("bank_accounts")
          .select("id, account_name, currency, is_active, sort_order")
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("account_name", { ascending: true });
        setBanks(((bdata as any) || []) as BankAccount[]);
      } catch {
        setBanks([]);
      }

    })();
  }, [supabase]);

  React.useEffect(() => {
    (async () => {
      if (!buyerId) {
        setInvoices([]);
        setAmounts({});
        return;
      }
      setLoading(true);
      setMsg("");
      try {
        const res = await fetch(`/api/invoices/unpaid?buyer_id=${buyerId}`, { cache: "no-store" });
        const j = await res.json();
        if (!j.success) throw new Error(j.error || "Failed to load invoices");
        setInvoices(j.rows || []);
        setAmounts({});
      } catch (e: any) {
        setMsg(e.message || "Failed");
        setInvoices([]);
        setAmounts({});
      } finally {
        setLoading(false);
      }
    })();
  }, [buyerId]);

  const total = React.useMemo(() => {
    let t = 0;
    for (const [id, v] of Object.entries(amounts)) {
      const n = Math.abs(Number(v || 0));
      if (n) t += n;
    }
    return t;
  }, [amounts]);

  async function save() {
    setMsg("");
    if (!buyerId) return setMsg("Select buyer.");
        const lines = Object.entries(amounts)
      .map(([invoice_id, v]) => ({ invoice_id, amount: Math.abs(Number(v || 0)) }))
      .filter((x) => x.invoice_id && x.amount > 0);

    if (lines.length === 0) return setMsg("Enter credit amount(s).");

    const payload = {
      buyer_id: buyerId,
      deposit_date: date,
      reference_no: ref || null,
      note: note || null,
      lines,
    };

    const res = await fetch("/api/credits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await res.json();
    if (!res.ok) return setMsg(j.error || "Failed");
    setMsg(`Saved CREDIT: ${j.receipt_id}`);
    setAmounts({});
  }

  return (
    <AppShell>
      <Card>
        <CardHeader>
          <CardTitle>Credit Note</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 items-end mb-4">
            <div className="w-96">
              <div className="text-xs text-muted-foreground mb-1">Buyer</div>
              <select className="w-full border rounded-md h-10 px-2 text-sm" value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
                <option value="">Select buyer</option>
                {buyers.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>

            <div className="w-96">
              <div className="text-xs text-muted-foreground mb-1">Bank Account</div>
              <select className="w-full border rounded-md h-10 px-2 text-sm" value={bankId} onChange={(e) => setBankId(e.target.value)}>
                <option value="">Select bank account</option>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>{b.account_name} {b.currency ? `(${b.currency})` : ""}</option>
                ))}
              </select>
            </div>

            <div className="w-44">
              <div className="text-xs text-muted-foreground mb-1">Date</div>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>

            <div className="w-56">
              <div className="text-xs text-muted-foreground mb-1">Reference</div>
              <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Bank ref" />
            </div>

            <div className="flex-1 min-w-[220px]">
              <div className="text-xs text-muted-foreground mb-1">Note</div>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason / memo" />
            </div>

            <Button onClick={save} disabled={loading}>
              Save Credit Note
            </Button>
          </div>

          <div className="text-sm text-muted-foreground mb-2">
            Total Credit Note: <b>{fmt(total)}</b>
          </div>

          {msg ? <div className="text-sm text-amber-600 mb-3">{msg}</div> : null}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice No</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Applied</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">Credit Note Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>{inv.invoice_no}</TableCell>
                  <TableCell className="text-right">{fmt(inv.total_amount)}</TableCell>
                  <TableCell className="text-right">{fmt(inv.applied_amount)}</TableCell>
                  <TableCell className="text-right">{fmt(inv.balance)}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      className="text-right"
                      value={amounts[inv.id] || ""}
                      onChange={(e) => setAmounts({ ...amounts, [inv.id]: e.target.value })}
                      placeholder="0"
                    />
                  </TableCell>
                </TableRow>
              ))}
              {invoices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-sm text-muted-foreground">
                    {buyerId ? (loading ? "Loading..." : "No unpaid invoices.") : "Select buyer."}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
