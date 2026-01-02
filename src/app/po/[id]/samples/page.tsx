"use client";

/**
 * /src/app/po/[id]/samples/page.tsx
 * - Fixed layout: no overlap between date inputs & status select
 * - Grid with fixed widths + responsive fallback
 * - Select dropdown z-index (z-50)
 * - Save(blue) / Delete(red) with confirms
 * - Preview-safe Supabase boot (meta/localStorage only; no process/globalThis at module scope)
 */

import * as React from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectValue,
  SelectItem,
} from "@/components/ui/select";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

/* -------------------- preview-safe env utils -------------------- */
function safeString(x: unknown): string {
  return typeof x === "string" ? x : "";
}
function readMeta(name: string): string {
  try {
    if (typeof document === "undefined") return "";
    const el = document.querySelector(`meta[name="${name}"]`);
    return el ? safeString(el.getAttribute("content")) : "";
  } catch {
    return "";
  }
}
function readFromStorage() {
  try {
    if (typeof localStorage === "undefined") return { url: "", key: "" };
    return {
      url: safeString(localStorage.getItem("supabaseUrl")),
      key: safeString(localStorage.getItem("supabaseAnonKey")),
    };
  } catch {
    return { url: "", key: "" };
  }
}
function resolveSupabaseEnv() {
  const meta = { url: readMeta("supabase-url"), key: readMeta("supabase-anon") };
  const stor = readFromStorage();
  return { url: meta.url || stor.url || "", key: meta.key || stor.key || "" };
}

/* -------------------- types -------------------- */
type SampleType = "APPROVAL" | "PP" | "TOP" | "FINAL";
type SampleStatus = "PLANNED" | "SENT" | "RECEIVED" | "APPROVED" | "REWORK";
interface SampleRow {
  id: string;
  po_id: string;
  po_no?: string;
  po_line_id?: string;
  style_no?: string;
  origin_code?: string;
  type: SampleType;
  planned_date?: string;
  actual_date?: string;
  status: SampleStatus;
  carrier?: string;
  tracking_no?: string;
  attachments?: { name: string; url?: string }[];
}
const SAMPLE_TYPES: SampleType[] = ["APPROVAL", "PP", "TOP", "FINAL"];
const SAMPLE_STATUSES: SampleStatus[] = [
  "PLANNED",
  "SENT",
  "RECEIVED",
  "APPROVED",
  "REWORK",
];

/* -------------------- helpers -------------------- */
async function resolvePoIdByPoNo(sb: SupabaseClient | null, poNo: string) {
  if (!poNo) return null;
  if (!sb) return { id: `tmp-${poNo}`, po_no: poNo };
  const { data } = await sb
    .from("po_headers")
    .select("id,po_no")
    .eq("po_no", poNo)
    .maybeSingle();
  return (data as any) || null;
}
async function uploadAttachment(poNo: string, type: SampleType, file: File) {
  try {
    const { url, key } = resolveSupabaseEnv();
    if (!url || !key) return { url: undefined };
    const sb = createClient(url, key);
    const path = `${poNo}/${type}/${Date.now()}-${file.name}`;
    const { data, error } = await sb
      .storage
      .from("sample-files")
      .upload(path, file, { upsert: false });
    if (error) throw error;
    const { data: pub } = sb.storage.from("sample-files").getPublicUrl(data.path);
    return { url: pub?.publicUrl };
  } catch {
    return { url: undefined };
  }
}

/* -------------------- page -------------------- */
export default function Page() {
  const params = useParams() as { id?: string } | null;
  const poNoFromUrl = decodeURIComponent(params?.id || "");
  return <PoSamplesEditable poNoFromUrl={poNoFromUrl} />;
}

function PoSamplesEditable({ poNoFromUrl }: { poNoFromUrl: string }) {
  const [poNo] = React.useState(poNoFromUrl || "");
  const [resolvedPoId, setResolvedPoId] = React.useState<string>("");
  const [rows, setRows] = React.useState<SampleRow[]>([]);
  const [loading, setLoading] = React.useState(false);

  // quick add
  const [newType, setNewType] = React.useState<SampleType>("PP");
  const [newStyle, setNewStyle] = React.useState("");
  const [newPlan, setNewPlan] = React.useState("");

  // lazy supabase client
  const [sb, setSb] = React.useState<SupabaseClient | null>(null);
  React.useEffect(() => {
    try {
      const { url, key } = resolveSupabaseEnv();
      if (url && key) setSb(createClient(url, key));
    } catch {
      setSb(null);
    }
  }, []);

  const load = React.useCallback(async () => {
    if (!poNo) {
      alert("Enter PO No.");
      return;
    }
    setLoading(true);
    const resolved = await resolvePoIdByPoNo(sb, poNo);
    const poId = resolved?.id || "";
    setResolvedPoId(poId);

    if (!sb) {
      setRows([]);
      setLoading(false);
      return;
    }
    let q = sb
      .from("sample_milestones")
      .select(
        "id, po_id, po_no, po_line_id, style_no, origin_code, type, planned_date, actual_date, status, carrier, tracking_no, attachments"
      )
      .order("planned_date");
    q = poId ? q.eq("po_id", poId) : q.eq("po_no", poNo);
    const { data } = await q;
    setRows(((data as any[]) || []).map((r) => ({ ...r, attachments: r.attachments || [] })));
    setLoading(false);
  }, [poNo, sb]);

  React.useEffect(() => {
    if (poNoFromUrl) load();
  }, [poNoFromUrl, load]);

  const updateRow = (id: string, patch: Partial<SampleRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const persistRow = async (row: SampleRow) => {
    if (!confirm("Do you want to save this record?")) return;
    if (!sb) {
      alert("Saved successfully. (preview)");
      return;
    }
    const payload: any = { ...row, po_no: poNo, po_id: resolvedPoId || row.po_id };
    const { error } = await sb.from("sample_milestones").upsert(payload, { onConflict: "id" });
    if (error) {
      alert(`Save failed: ${error.message}`);
      return;
    }
    alert("Saved successfully.");
  };

  const persistAll = async () => {
    if (!confirm("Do you want to save all changes?")) return;
    if (!sb) {
      alert("Saved successfully. (preview)");
      return;
    }
    const payload = rows.map((r) => ({ ...r, po_no: poNo, po_id: resolvedPoId || r.po_id }));
    const { error } = await sb.from("sample_milestones").upsert(payload, { onConflict: "id" });
    if (error) {
      alert(`Save failed: ${error.message}`);
      return;
    }
    alert("Saved successfully.");
  };

  const removeRow = async (id: string) => {
    if (!confirm("Are you sure you want to delete this record?")) return;
    if (!sb) {
      setRows((prev) => prev.filter((r) => r.id !== id));
      alert("Deleted successfully. (preview)");
      return;
    }
    const { error } = await sb.from("sample_milestones").delete().eq("id", id);
    if (error) {
      alert(`Delete failed: ${error.message}`);
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
    alert("Deleted successfully.");
  };

  const addRow = () => {
    if (!poNo) {
      alert("Enter PO No.");
      return;
    }
    const id =
      typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function"
        ? (crypto as any).randomUUID()
        : `id-${Date.now()}`;
    const row: SampleRow = {
      id,
      po_id: resolvedPoId || `tmp-${poNo}`,
      po_no: poNo,
      type: newType,
      planned_date: newPlan || "",
      status: "PLANNED",
      style_no: newStyle || "",
      attachments: [],
    };
    setRows((prev) => [row, ...prev]);
    alert("Added. Don't forget to Save.");
  };

  const handleAttach = async (row: SampleRow, file?: File) => {
    if (!file) return;
    const upload = await uploadAttachment(row.po_no || row.po_id, row.type, file);
    const att = { name: file.name, url: upload.url };
    updateRow(row.id, { attachments: [...(row.attachments || []), att] });
    alert(upload.url ? "File uploaded." : "File kept locally in preview.");
  };

  /* -------------------- UI -------------------- */
  return (
    <div className="space-y-4">
      {/* Header / Actions */}
      <div className="flex items-center justify-between">
        <div className="text-xl font-semibold">
          PO Samples — <span className="opacity-70">PO No:</span> {poNo}
        </div>
        <div className="flex gap-2">
          <Button onClick={load} className="bg-blue-600 hover:bg-blue-700 text-white">
            Reload
          </Button>
          <Button onClick={persistAll} className="bg-blue-600 hover:bg-blue-700 text-white">
            Save All
          </Button>
          <a href="/samples" className="btn">
            Back to Samples Board
          </a>
        </div>
      </div>

      {/* Add Milestone */}
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Add Milestone</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-[120px_220px_180px_110px] grid-cols-2 items-end">
            {/* Type */}
            <div className="min-w-[110px]">
              <Label className="text-xs">Type</Label>
              <Select value={newType} onValueChange={(v) => setNewType(v as SampleType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-50">
                  {SAMPLE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Style */}
            <div className="min-w-[200px]">
              <Label className="text-xs">Style No.</Label>
              <Input
                value={newStyle}
                onChange={(e) => setNewStyle(e.target.value)}
                placeholder="optional"
              />
            </div>
            {/* Planned Date */}
            <div className="min-w-[170px]">
              <Label className="text-xs">Planned Date</Label>
              <Input type="date" value={newPlan} onChange={(e) => setNewPlan(e.target.value)} />
            </div>
            {/* Buttons */}
            <div className="flex gap-2">
              <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={addRow}>
                Add
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setNewStyle("");
                  setNewPlan("");
                }}
              >
                Clear
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Milestones */}
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Milestones</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && <div className="text-sm opacity-70">Loading…</div>}

          {/* header row (labels) */}
          <div className="hidden sm:grid grid-cols-[120px_220px_180px_180px_120px_220px_140px] gap-2 text-xs font-medium mb-1">
            <div>Type</div>
            <div>Style</div>
            <div>Planned</div>
            <div>Actual</div>
            <div>Status</div>
            <div>Carrier / Tracking / Files</div>
            <div className="text-right">Actions</div>
          </div>

          {rows.map((row) => (
            <div
              key={row.id}
              className="grid gap-2 sm:grid-cols-[120px_220px_180px_180px_120px_220px_140px] grid-cols-2 items-center py-1"
            >
              {/* Type */}
              <div className="min-w-[110px]">
                <Select
                  value={row.type}
                  onValueChange={(v) => updateRow(row.id, { type: v as SampleType })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-50">
                    {SAMPLE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Style */}
              <div className="min-w-[200px]">
                <Input
                  value={row.style_no || ""}
                  onChange={(e) => updateRow(row.id, { style_no: e.target.value })}
                />
              </div>

              {/* Planned */}
              <div className="min-w-[170px]">
                <Input
                  type="date"
                  value={row.planned_date || ""}
                  onChange={(e) => updateRow(row.id, { planned_date: e.target.value })}
                />
              </div>

              {/* Actual */}
              <div className="min-w-[170px]">
                <Input
                  type="date"
                  value={row.actual_date || ""}
                  onChange={(e) => updateRow(row.id, { actual_date: e.target.value })}
                />
              </div>

              {/* Status (with z-index so it never hides) */}
              <div className="min-w-[110px] relative">
                <Select
                  value={row.status}
                  onValueChange={(v) => updateRow(row.id, { status: v as SampleStatus })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-50">
                    {SAMPLE_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Carrier / Tracking / Upload */}
              <div className="min-w-[210px]">
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    placeholder="Carrier"
                    value={row.carrier || ""}
                    onChange={(e) => updateRow(row.id, { carrier: e.target.value })}
                    className="sm:w-[120px]"
                  />
                  <Input
                    placeholder="Tracking No."
                    value={row.tracking_no || ""}
                    onChange={(e) => updateRow(row.id, { tracking_no: e.target.value })}
                    className="sm:flex-1"
                  />
                  <label className="btn">
                    Upload
                    <input
                      type="file"
                      className="hidden"
                      accept="application/pdf,image/*"
                      onChange={(e) => handleAttach(row, e.target.files?.[0] || undefined)}
                    />
                  </label>
                </div>

                {/* attachments list */}
                <div className="mt-1 text-[11px] space-y-1">
                  {(row.attachments || []).map((f, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <span className="truncate max-w-[220px]" title={f.name}>
                        {f.name}
                      </span>
                      {f.url ? (
                        <a className="underline" href={f.url} target="_blank" rel="noreferrer">
                          view
                        </a>
                      ) : (
                        <span className="opacity-60">(pending)</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="text-right flex gap-2 justify-end">
                <Button
                  onClick={() => persistRow(row)}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  Save
                </Button>
                <Button
                  variant="ghost"
                  className="text-red-600"
                  onClick={() => removeRow(row.id)}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
