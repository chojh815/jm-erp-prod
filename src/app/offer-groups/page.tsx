"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import AppShell from "@/components/layout/AppShell";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type OfferGroupRow = {
  id: string;
  buyer_name?: string | null;
  buyer_code?: string | null;
  currency?: string | null;
  status?: string | null;
  title?: string | null;
  updated_at?: string | null;
};

function fmtDate(s?: string | null) {
  if (!s) return "";
  try {
    const d = new Date(s);
    return d.toISOString().slice(0, 10);
  } catch {
    return s;
  }
}

export default function OfferGroupsPage() {
  const router = useRouter();
  const [rows, setRows] = React.useState<OfferGroupRow[]>([]);
  const [loading, setLoading] = React.useState(false);

  const [buyerName, setBuyerName] = React.useState("");
  const [buyerCode, setBuyerCode] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [currency, setCurrency] = React.useState("USD");

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/offer-groups", { cache: "no-store" });
      const j = await r.json();
      if (!j?.success) throw new Error(j?.error || "Failed");
      setRows(j.rows || []);
    } catch (e: any) {
      alert(e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function create() {
    setLoading(true);
    try {
      const r = await fetch("/api/offer-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buyer_name: buyerName || null,
          buyer_code: buyerCode || null,
          title: title || null,
          currency: currency || "USD",
        }),
      });
      const j = await r.json();
      if (!j?.success) throw new Error(j?.error || "Failed");
      router.push(`/offer-groups/${j.row.id}`);
    } catch (e: any) {
      alert(e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Offer Groups</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={load} disabled={loading}>
              Refresh
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Create Offer Group</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Buyer Name</div>
                <Input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="e.g. RED BEAUTY INC" />
              </div>
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Buyer Code</div>
                <Input value={buyerCode} onChange={(e) => setBuyerCode(e.target.value)} placeholder="e.g. RBK" />
              </div>
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Title</div>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Feb Offer Sheet" />
              </div>
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Currency</div>
                <Input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="USD" />
              </div>
            </div>
            <div className="mt-4">
              <Button onClick={create} disabled={loading}>
                Create
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Groups</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Buyer</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rows || []).map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => router.push(`/offer-groups/${r.id}`)}>
                    <TableCell>{r.buyer_name || "-"}</TableCell>
                    <TableCell>{r.buyer_code || "-"}</TableCell>
                    <TableCell>{r.title || "-"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{r.status || "DRAFT"}</Badge>
                    </TableCell>
                    <TableCell>{r.currency || "USD"}</TableCell>
                    <TableCell>{fmtDate(r.updated_at)}</TableCell>
                  </TableRow>
                ))}
                {(!rows || rows.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No groups
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
