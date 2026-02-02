"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import StyleAutocompleteInput from "@/components/quotation/StyleAutocompleteInput";
import LineAttachments from "@/components/quotation/LineAttachments";

type BuyerItem = {
  id: string;
  name: string;
  code: string;
  buyer_brand?: string | null; // comma-separated list
};

type LineDraft = {
  style_no: string;
  qty: string; // keep as string for input
  target_price: string;
  remarks: string;
  _files?: File[]; // local files pending upload (before Create)
};

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export default function NewQuotationPage() {
  const router = useRouter();

  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [buyers, setBuyers] = React.useState<BuyerItem[]>([]);
  const [buyerId, setBuyerId] = React.useState<string>("");
  const [brandName, setBrandName] = React.useState<string>(""); // optional
  const [receivedAt, setReceivedAt] = React.useState<string>(todayISO());
  const [notes, setNotes] = React.useState<string>("");

  const [lines, setLines] = React.useState<LineDraft[]>([
    { style_no: "", qty: "", target_price: "", remarks: "", _files: [] },
  ]);

  async function loadBootstrap() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/quotations/bootstrap", { method: "GET" });
      const j = await safeJson(res);
      if (!res.ok || !j?.success) throw new Error(j?.error || `Failed (${res.status})`);
      setBuyers(Array.isArray(j.buyers) ? j.buyers : []);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    loadBootstrap();
  }, []);

  function addLine() {
    setLines((prev) => [...prev, { style_no: "", qty: "", target_price: "", remarks: "", _files: [] }]);
  }

  function removeLine(idx: number) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  function updateLine(idx: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  const brandOptions = React.useMemo(() => {
    const b = buyers.find((x) => x.id === buyerId);
    const raw = b?.buyer_brand || "";
    const arr = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return arr;
  }, [buyers, buyerId]);

  async function uploadPendingFiles(quotationId: string, lineDrafts: LineDraft[]) {
    // 1) re-fetch to get created line ids in order
    const res = await fetch(`/api/quotations/${encodeURIComponent(quotationId)}`, { method: "GET" });
    const j = await safeJson(res);
    if (!res.ok || !j?.success) throw new Error(j?.error || `Fetch quotation failed (${res.status})`);
    const createdLines: Array<{ id: string; style_no?: string | null }> = Array.isArray(j.lines) ? j.lines : [];
    if (!createdLines.length) return;

    // 2) upload line by line (index-based). (If you later add stable client_line_key, we'll match by key.)
    for (let i = 0; i < Math.min(createdLines.length, lineDrafts.length); i++) {
      const lineId = createdLines[i]?.id;
      const files = lineDrafts[i]?._files || [];
      if (!lineId || files.length === 0) continue;

      for (const f of files) {
        const fd = new FormData();
        fd.append("file", f);
        const up = await fetch(`/api/quotations/lines/${encodeURIComponent(lineId)}/attachments`, {
          method: "POST",
          body: fd,
        });
        const uj = await safeJson(up);
        if (!up.ok || !uj?.success) {
          // don't fail the whole create for one attachment, but surface in console
          console.error("Attachment upload failed", { lineId, file: f.name, error: uj?.error || up.status });
        }
      }
    }
  }

  async function createQuotation() {
    setError(null);

    if (!buyerId) {
      setError("Buyer를 선택해 주세요.");
      return;
    }

    const cleanLines = lines
      .map((l) => ({
        style_no: l.style_no.trim(),
        qty: l.qty.trim(),
        target_price: l.target_price.trim(),
        remarks: l.remarks.trim(),
        _files: l._files || [],
      }))
      .filter((l) => l.style_no);

    if (cleanLines.length === 0) {
      setError("최소 1개 이상의 Style을 입력해 주세요.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/quotations/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buyer_id: buyerId,
          brand_name: brandName ? brandName.trim() : null,
          received_at: receivedAt || todayISO(),
          notes: notes?.trim() || null,
          lines: cleanLines.map((l) => ({
            style_no: l.style_no,
            qty: l.qty === "" ? null : Number(l.qty),
            target_price: l.target_price === "" ? null : Number(l.target_price),
            remarks: l.remarks || null,
          })),
        }),
      });

      const j = await safeJson(res);
      if (!res.ok || !j?.success) throw new Error(j?.error || `Create failed (${res.status})`);

      const id = j.id as string;
      const quotationNo = j.quotation_no as string;

      // Upload pending attachments (best-effort)
      try {
        await uploadPendingFiles(id, cleanLines as any);
      } catch (e) {
        console.error("uploadPendingFiles error", e);
      }

      alert(`Created: ${quotationNo}`);
      router.push(`/quotations/${encodeURIComponent(id)}`);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell title="New Quotation">
      <div className="mx-auto w-full max-w-6xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-semibold">Create Quotation</div>
            <div className="text-sm text-muted-foreground">
              메일 1건(요청 묶음) → Quotation 1건으로 등록
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => router.back()}>Back</Button>
            <Button onClick={createQuotation} disabled={saving}>
              {saving ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>

        {error ? (
          <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Header</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Buyer</div>
                <Select
                  value={buyerId}
                  onValueChange={(v) => {
                    setBuyerId(v);
                    setBrandName("");
                    setError(null); // IMPORTANT: clear stale "buyer_id required" banner
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={loading ? "Loading..." : "Select buyer"} />
                  </SelectTrigger>
                  <SelectContent>
                    {buyers.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.code} • {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Brand (optional)</div>
                <Select
                  value={brandName || "__none__"}
                  onValueChange={(v) => {
                    setBrandName(v === "__none__" ? "" : v);
                    setError(null);
                  }}
                  disabled={!buyerId || brandOptions.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Buyer-level (no brand)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Buyer-level (no brand)</SelectItem>
                    {brandOptions.map((bn) => (
                      <SelectItem key={bn} value={bn}>{bn}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="text-xs text-muted-foreground">
                  LDC처럼 브랜드별 운영이면 Brand 선택, RBK처럼 바이어 단위면 Buyer-level 그대로.
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Received Date</div>
                <Input
                  type="date"
                  value={receivedAt}
                  onChange={(e) => {
                    setReceivedAt(e.target.value);
                    setError(null);
                  }}
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Notes (mail summary)</div>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. SS26 price request (Chico's + Guess)..."
              />
            </div>

            <div className="flex items-center gap-2">
              <Badge variant="secondary">Quotation No</Badge>
              <div className="text-sm text-muted-foreground">
                생성 시 자동 발번: QT-ACCOUNT-YYMMDD-SEQ
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Lines</CardTitle>
            <Button onClick={addLine}>+ Add line</Button>
          </CardHeader>
          <CardContent className="space-y-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead className="w-56">Style No</TableHead>
                  <TableHead className="w-28">MOQ/Qty</TableHead>
                  <TableHead className="w-36">Target Price</TableHead>
                  <TableHead>Remarks</TableHead>
                  <TableHead className="w-[460px]">Files</TableHead>
                  <TableHead className="w-28 text-right"> </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {lines.map((l, idx) => (
                  <TableRow key={idx}>
                    <TableCell>{idx + 1}</TableCell>

                    <TableCell>
                      <StyleAutocompleteInput
                        value={l.style_no}
                        onChangeValue={(v) => updateLine(idx, { style_no: v })}
                        placeholder="Type to search (e.g. JK260001)"
                      />
                    </TableCell>

                    <TableCell>
                      <Input
                        value={l.qty}
                        onChange={(e) => updateLine(idx, { qty: e.target.value })}
                        placeholder="e.g. 5000"
                      />
                    </TableCell>

                    <TableCell>
                      <Input
                        value={l.target_price}
                        onChange={(e) => updateLine(idx, { target_price: e.target.value })}
                        placeholder="optional"
                      />
                    </TableCell>

                    <TableCell>
                      <Input
                        value={l.remarks}
                        onChange={(e) => updateLine(idx, { remarks: e.target.value })}
                        placeholder="optional"
                      />
                    </TableCell>

                    <TableCell>
                      <LineAttachments
                        mode="local"
                        localFiles={l._files || []}
                        onChangeLocalFiles={(files) => updateLine(idx, { _files: files })}
                      />
                    </TableCell>

                    <TableCell className="text-right">
                      <Button variant="destructive" onClick={() => removeLine(idx)}>
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="text-xs text-muted-foreground">
              * Qty는 요청 수량(또는 MOQ 티어)입니다. (기본 티어: 100/500/1000/3000 — Step4에서 바이어별 override 예정)
              * 첨부파일 업로드는 Create 후 자동 업로드됩니다(라인별).
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
