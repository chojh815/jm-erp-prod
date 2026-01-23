"use client";

import * as React from "react";

import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type DevRole = AppRole;

type BankAccountRow = {
  id: string;
  site_code: string | null;
  account_name: string | null;
  bank_name: string | null;
  account_no_masked: string | null;
  account_holder_name: string | null;
  swift_code: string | null;
  bank_address: string | null;
  beneficiary_address: string | null;
  currency: string | null;
  opening_balance: number | null;
  is_active: boolean | null;
  is_default_for_site: boolean | null;
  sort_order: number | null;
  updated_at?: string | null;
};

function s(v: any) {
  return (v ?? "").toString().trim();
}
function fmtNum(n: any) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "";
  return x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BankAccountsPage() {
  const role: DevRole = "admin";

  const [loading, setLoading] = React.useState(false);
  const [rows, setRows] = React.useState<BankAccountRow[]>([]);
  const [q, setQ] = React.useState("");
  const [siteCode, setSiteCode] = React.useState("");
  const [activeOnly, setActiveOnly] = React.useState(true);
  const [includeAny, setIncludeAny] = React.useState(true);

  // Modal
  const [open, setOpen] = React.useState(false);
  const [edit, setEdit] = React.useState<Partial<BankAccountRow> | null>(null);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (siteCode.trim()) params.set("site_code", siteCode.trim());
      params.set("active_only", activeOnly ? "1" : "0");
      params.set("include_any", includeAny ? "1" : "0");

      const res = await fetch(`/api/bank-accounts/list?${params.toString()}`, { cache: "no-store" });
      const j = await res.json();
      if (!j?.success) throw new Error(j?.error || "Failed to load bank accounts");
      setRows(j.rows || []);
    } catch (e: any) {
      alert(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [q, siteCode, activeOnly, includeAny]);

  React.useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEdit({
      id: "",
      site_code: null,
      account_name: "",
      bank_name: "",
      account_no_masked: "",
      account_holder_name: "",
      swift_code: "",
      bank_address: "",
      beneficiary_address: "",
      currency: "USD",
      opening_balance: 0,
      is_active: true,
      is_default_for_site: false,
      sort_order: 0,
    });
    setOpen(true);
  }

  function openEdit(r: BankAccountRow) {
    setEdit({ ...r });
    setOpen(true);
  }

  async function save() {
    if (!edit) return;
    setSaving(true);
    try {
      const payload = {
        ...edit,
        site_code: s(edit.site_code) ? s(edit.site_code) : null,
        account_name: s(edit.account_name),
        bank_name: s(edit.bank_name) ? s(edit.bank_name) : null,
        account_no_masked: s(edit.account_no_masked) ? s(edit.account_no_masked) : null,
        account_holder_name: s(edit.account_holder_name) ? s(edit.account_holder_name) : null,
        swift_code: s(edit.swift_code) ? s(edit.swift_code) : null,
        bank_address: s(edit.bank_address) ? s(edit.bank_address) : null,
        beneficiary_address: s(edit.beneficiary_address) ? s(edit.beneficiary_address) : null,
        currency: s(edit.currency) ? s(edit.currency) : null,
        opening_balance: Number(edit.opening_balance ?? 0),
        sort_order: Number(edit.sort_order ?? 0),
        is_active: !!edit.is_active,
        is_default_for_site: !!edit.is_default_for_site,
      };

      if (!payload.account_name) throw new Error("Account Name is required");

      const res = await fetch("/api/bank-accounts/upsert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!j?.success) throw new Error(j?.error || "Save failed");

      setOpen(false);
      setEdit(null);
      await load();
    } catch (e: any) {
      alert(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(id: string) {
    if (!confirm("Deactivate this bank account? (soft delete)")) return;
    try {
      const res = await fetch(`/api/bank-accounts/${id}/delete`, { method: "DELETE" });
      const j = await res.json();
      if (!j?.success) throw new Error(j?.error || "Delete failed");
      await load();
    } catch (e: any) {
      alert(e?.message ?? String(e));
    }
  }

  return (
    <AppShell role={role}>
      <div className="p-6 space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Bank Accounts</CardTitle>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => load()} disabled={loading}>
                Reload
              </Button>
              <Button onClick={openCreate}>New Account</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Search</div>
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="name / bank / swift / currency" />
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-1">Site Code (optional)</div>
                <Input value={siteCode} onChange={(e) => setSiteCode(e.target.value)} placeholder="KR_SEOUL / VN_BACNINH / ..." />
                <div className="text-xs text-muted-foreground mt-1">
                  If set, list shows that site (+ optional ANY).
                </div>
              </div>

              <div className="flex items-end gap-6">
                <div className="flex items-center gap-2">
                  <Switch checked={activeOnly} onCheckedChange={setActiveOnly} />
                  <span className="text-sm">Active only</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={includeAny} onCheckedChange={setIncludeAny} />
                  <span className="text-sm">Include ANY</span>
                </div>
              </div>

              <div className="flex items-end">
                <Button className="w-full" variant="outline" onClick={() => load()} disabled={loading}>
                  Search
                </Button>
              </div>
            </div>

            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Site</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead>Bank</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>SWIFT</TableHead>
                    <TableHead>Opening</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.site_code ?? <Badge variant="secondary">ANY</Badge>}</TableCell>
                      <TableCell>
                        <div className="font-medium">{r.account_name}</div>
                        <div className="text-xs text-muted-foreground">{r.account_holder_name || ""}</div>
                      </TableCell>
                      <TableCell>{r.currency ?? ""}{r.is_default_for_site ? <Badge className="ml-2">DEFAULT</Badge> : null}</TableCell>
                      <TableCell>{r.bank_name ?? ""}</TableCell>
                      <TableCell>{r.account_no_masked ?? ""}</TableCell>
                      <TableCell>{r.swift_code ?? ""}</TableCell>
                      <TableCell>{fmtNum(r.opening_balance ?? 0)}</TableCell>
                      <TableCell>
                        {r.is_active ? <Badge>ACTIVE</Badge> : <Badge variant="secondary">INACTIVE</Badge>}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => deactivate(r.id)} disabled={!r.is_active}>
                          Deactivate
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-10">
                        No bank accounts.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>

            <div className="text-xs text-muted-foreground">
              Tip: set <b>Site</b> to blank = ANY (usable for any site). Set <b>Default</b> to auto-pick per site.
            </div>
          </CardContent>
        </Card>

        <Dialog open={open} onOpenChange={(v) => { if (!v) setEdit(null); setOpen(v); }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{edit?.id ? "Edit Bank Account" : "New Bank Account"}</DialogTitle>
            </DialogHeader>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Site Code (blank = ANY)</div>
                <Input
                  value={edit?.site_code ?? ""}
                  onChange={(e) => setEdit((p) => ({ ...(p ?? {}), site_code: e.target.value }))}
                  placeholder="KR_SEOUL / VN_BACNINH / ..."
                />
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Currency</div>
                <Input
                  value={edit?.currency ?? ""}
                  onChange={(e) => setEdit((p) => ({ ...(p ?? {}), currency: e.target.value }))}
                  placeholder="USD / KRW / CNY ..."
                />
              </div>

              <div className="md:col-span-2">
                <div className="text-xs text-muted-foreground mb-1">Account Name (internal label)</div>
                <Input
                  value={edit?.account_name ?? ""}
                  onChange={(e) => setEdit((p) => ({ ...(p ?? {}), account_name: e.target.value }))}
                  placeholder="KR Main USD / VN USD / ..."
                />
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-1">Bank Name</div>
                <Input
                  value={edit?.bank_name ?? ""}
                  onChange={(e) => setEdit((p) => ({ ...(p ?? {}), bank_name: e.target.value }))}
                  placeholder="Kookmin Bank / Bank of China ..."
                />
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Account No (masked)</div>
                <Input
                  value={edit?.account_no_masked ?? ""}
                  onChange={(e) => setEdit((p) => ({ ...(p ?? {}), account_no_masked: e.target.value }))}
                  placeholder="123-456-**** / 12345678-901234 ..."
                />
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-1">Account Holder</div>
                <Input
                  value={edit?.account_holder_name ?? ""}
                  onChange={(e) => setEdit((p) => ({ ...(p ?? {}), account_holder_name: e.target.value }))}
                  placeholder="JM International"
                />
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">SWIFT Code</div>
                <Input
                  value={edit?.swift_code ?? ""}
                  onChange={(e) => setEdit((p) => ({ ...(p ?? {}), swift_code: e.target.value }))}
                  placeholder="CZNBKRSE / ..."
                />
              </div>

              <div className="md:col-span-2">
                <div className="text-xs text-muted-foreground mb-1">Bank Address</div>
                <Textarea
                  value={edit?.bank_address ?? ""}
                  onChange={(e) => setEdit((p) => ({ ...(p ?? {}), bank_address: e.target.value }))}
                  placeholder="Bank address (street, city, country)"
                  rows={3}
                />
              </div>

              <div className="md:col-span-2">
                <div className="text-xs text-muted-foreground mb-1">Beneficiary Address</div>
                <Textarea
                  value={edit?.beneficiary_address ?? ""}
                  onChange={(e) => setEdit((p) => ({ ...(p ?? {}), beneficiary_address: e.target.value }))}
                  placeholder="Beneficiary (account holder) address"
                  rows={3}
                />
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-1">Opening Balance</div>
                <Input
                  value={String(edit?.opening_balance ?? 0)}
                  onChange={(e) => setEdit((p) => ({ ...(p ?? {}), opening_balance: e.target.value as any }))}
                  placeholder="0"
                />
                <div className="text-xs text-muted-foreground mt-1">
                  Used by Monthly Bank Balance dashboard as starting cash.
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-1">Sort Order</div>
                <Input
                  value={String(edit?.sort_order ?? 0)}
                  onChange={(e) => setEdit((p) => ({ ...(p ?? {}), sort_order: e.target.value as any }))}
                  placeholder="0"
                />
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={!!edit?.is_active}
                  onCheckedChange={(v) => setEdit((p) => ({ ...(p ?? {}), is_active: v }))}
                />
                <span className="text-sm">Active</span>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={!!edit?.is_default_for_site}
                  onCheckedChange={(v) => setEdit((p) => ({ ...(p ?? {}), is_default_for_site: v }))}
                />
                <span className="text-sm">Default for Site</span>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
