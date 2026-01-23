"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useState } from "react";

export function BankAccountModal({ open, onClose, initial }: any) {
  const [form, setForm] = useState(initial || { is_active: true });

  const save = async () => {
    await fetch("/api/bank-accounts/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    onClose(true);
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose(false)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Bank Account</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <Input
            placeholder="Account Name (ex: KR Main USD)"
            value={form.account_name || ""}
            onChange={e => setForm({ ...form, account_name: e.target.value })}
          />

          <Input
            placeholder="Site Code (empty = ANY)"
            value={form.site_code || ""}
            onChange={e => setForm({ ...form, site_code: e.target.value || null })}
          />

          <Input
            placeholder="Bank Name"
            value={form.bank_name || ""}
            onChange={e => setForm({ ...form, bank_name: e.target.value })}
          />

          <Input
            placeholder="Account No (masked)"
            value={form.account_no_masked || ""}
            onChange={e => setForm({ ...form, account_no_masked: e.target.value })}
          />

          <Input
            placeholder="Account Holder"
            value={form.account_holder_name || ""}
            onChange={e => setForm({ ...form, account_holder_name: e.target.value })}
          />

          <Input
            placeholder="SWIFT CODE"
            value={form.swift_code || ""}
            onChange={e => setForm({ ...form, swift_code: e.target.value })}
          />

          <Input
            placeholder="Currency (USD, KRW…)"
            value={form.currency || ""}
            onChange={e => setForm({ ...form, currency: e.target.value })}
          />

          <div className="flex items-center gap-2">
            <Checkbox
              checked={form.is_default_for_site}
              onCheckedChange={(v: any) =>
                setForm({ ...form, is_default_for_site: !!v })
              }
            />
            Default for Site
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onClose(false)}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
