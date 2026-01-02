"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Select, SelectTrigger, SelectContent, SelectValue, SelectItem } from "@/components/ui/select";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// =====================================================
// Supabase boot (works in preview without process.env)
// =====================================================
function readMeta(name: string) {
  if (typeof document === "undefined") return "";
  const m = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  return m?.content || "";
}
function readEnvFromAny(): { url: string; key: string } {
  const g: any = typeof globalThis !== "undefined" ? (globalThis as any) : {};
  const fromGlobal = {
    url: g.__env?.NEXT_PUBLIC_SUPABASE_URL || g.NEXT_PUBLIC_SUPABASE_URL || "",
    key: g.__env?.NEXT_PUBLIC_SUPABASE_ANON_KEY || g.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  };
  const fromMeta = { url: readMeta("supabase-url"), key: readMeta("supabase-anon") };
  const fromStorage = {
    url: (typeof localStorage !== "undefined" && localStorage.getItem("supabaseUrl")) || "",
    key: (typeof localStorage !== "undefined" && localStorage.getItem("supabaseAnonKey")) || "",
  } as { url: string; key: string };
  // @ts-ignore
  const fromProcess = {
    url: (typeof process !== "undefined" ? (process as any).env?.NEXT_PUBLIC_SUPABASE_URL : "") || "",
    key: (typeof process !== "undefined" ? (process as any).env?.NEXT_PUBLIC_SUPABASE_ANON_KEY : "") || "",
  };
  const url = fromGlobal.url || fromMeta.url || fromStorage.url || fromProcess.url || "";
  const key = fromGlobal.key || fromMeta.key || fromStorage.key || fromProcess.key || "";
  return { url, key };
}
const { url: SB_URL, key: SB_ANON } = readEnvFromAny();
const supabase: SupabaseClient | null = SB_URL && SB_ANON ? createClient(SB_URL, SB_ANON) : null;

// =====================================================
// Types & constants
// =====================================================
type SampleType = "APPROVAL" | "PP" | "TOP" | "FINAL";
type SampleStatus = "PLANNED" | "SENT" | "RECEIVED" | "APPROVED" | "REWORK";
interface SampleRow {
  id: string;
  po_id: string;             // FK to po_headers.id
  po_no?: string;            // convenience for board
  po_line_id?: string;       // FK to po_lines.id
  style_no?: string;         // convenience
  origin_code?: string;      // KR_SEOUL / VN_BACNINH ...
  type: SampleType;
  planned_date?: string;     // yyyy-mm-dd
  actual_date?: string;      // yyyy-mm-dd
  status: SampleStatus;
  carrier?: string;          // DHL/FEDEX/UPS
  tracking_no?: string;
  attachments?: {name: string; url?: string}[];
}

const SAMPLE_TYPES: SampleType[] = ["APPROVAL", "PP", "TOP", "FINAL"];
const SAMPLE_STATUSES: SampleStatus[] = ["PLANNED", "SENT", "RECEIVED", "APPROVED", "REWORK"];

// Mock seed for preview
const MOCK_ROWS: SampleRow[] = [
  { id: crypto.randomUUID(), po_id: "po-1", po_no: "4400003943", style_no: "JN240501", origin_code: "VN_BACNINH", type: "APPROVAL", planned_date: "2025-11-20", actual_date: "", status: "PLANNED", carrier: "DHL", tracking_no: "", attachments: [] },
  { id: crypto.randomUUID(), po_id: "po-1", po_no: "4400003943", style_no: "JN240501", origin_code: "VN_BACNINH", type: "PP", planned_date: "2025-11-25", actual_date: "", status: "PLANNED", carrier: "", tracking_no: "", attachments: [] },
  { id: crypto.randomUUID(), po_id: "po-2", po_no: "RB-2025-101", style_no: "JE250102", origin_code: "KR_SEOUL", type: "FINAL", planned_date: "2025-11-28", actual_date: "", status: "SENT", carrier: "FEDEX", tracking_no: "7788-9900", attachments: [] },
];

// =====================================================
// Storage helpers (optional)
// =====================================================
async function uploadAttachment(file: File, poNo: string, type: SampleType) {
  if (!supabase) return { url: undefined };
  const path = `${poNo}/${type}/${Date.now()}-${file.name}`;
  const { data, error } = await supabase.storage.from("sample-files").upload(path, file, { upsert: false });
  if (error) throw error;
  const { data: pub } = supabase.storage.from("sample-files").getPublicUrl(data.path);
  return { url: pub?.publicUrl };
}

// =====================================================
// Samples Board (all POs)
// =====================================================
function SamplesBoard() {
  const [rows, setRows] = React.useState<SampleRow[]>([]);
  const [qPo, setQPo] = React.useState("");
  const [qStyle, setQStyle] = React.useState("");
  // Radix Select disallows empty string for item values → use ALL sentinel
  const [qType, setQType] = React.useState<string>("ALL");
  const [qStatus, setQStatus] = React.useState<string>("ALL");
  const [qOrigin, setQOrigin] = React.useState<string>("ALL");

  React.useEffect(() => {
    (async () => {
      if (!supabase) { setRows(MOCK_ROWS); return; }
      const { data, error } = await supabase
        .from("sample_milestones")
        .select("id, po_id, po_no, po_line_id, style_no, origin_code, type, planned_date, actual_date, status, carrier, tracking_no, attachments")
        .order("planned_date");
      if (!error) setRows((data as any[]) || []);
    })();
  }, []);

  const filtered = rows.filter(r =>
    (!qPo || (r.po_no||"").toLowerCase().includes(qPo.toLowerCase())) &&
    (!qStyle || (r.style_no||"").toLowerCase().includes(qStyle.toLowerCase())) &&
    (qType === "ALL" || r.type === qType) &&
    (qStatus === "ALL" || r.status === qStatus) &&
    (qOrigin === "ALL" || (r.origin_code||"") === qOrigin)
  );

  const updateRow = (id: string, patch: Partial<SampleRow>) => {
    setRows(prev => prev.map(r => r.id === id ? ({ ...r, ...patch }) : r));
    // TODO: persist to Supabase if available
  };

  const handleAttach = async (row: SampleRow, file?: File) => {
    if (!file) return;
    try {
      const upload = await uploadAttachment(file, row.po_no || row.po_id, row.type);
      const att = { name: file.name, url: upload.url };
      updateRow(row.id, { attachments: [...(row.attachments||[]), att] });
    } catch (e) {
      console.warn("attachment upload failed", e);
    }
  };

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-2xl">Samples Board</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <Label className="text-xs">PO No.</Label>
            <Input value={qPo} onChange={(e)=>setQPo(e.target.value)} placeholder="e.g., 4400003943"/>
          </div>
          <div>
            <Label className="text-xs">Style No.</Label>
            <Input value={qStyle} onChange={(e)=>setQStyle(e.target.value)} placeholder="e.g., JN240501"/>
          </div>
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={qType} onValueChange={setQType}>
              <SelectTrigger><SelectValue placeholder="All"/></SelectTrigger>
              <SelectContent className="z-50">
                <SelectItem value="ALL">All</SelectItem>
                {SAMPLE_TYPES.map(t=> <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={qStatus} onValueChange={setQStatus}>
              <SelectTrigger><SelectValue placeholder="All"/></SelectTrigger>
              <SelectContent className="z-50">
                <SelectItem value="ALL">All</SelectItem>
                {SAMPLE_STATUSES.map(s=> <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Origin</Label>
            <Select value={qOrigin} onValueChange={setQOrigin}>
              <SelectTrigger><SelectValue placeholder="All"/></SelectTrigger>
              <SelectContent className="z-50">
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="KR_SEOUL">KR_SEOUL</SelectItem>
                <SelectItem value="CN_QINGDAO">CN_QINGDAO</SelectItem>
                <SelectItem value="CN_JIAOZHOU">CN_JIAOZHOU</SelectItem>
                <SelectItem value="VN_BACNINH">VN_BACNINH</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Separator className="my-4"/>

        {/* Grid header */}
        <div className="grid grid-cols-12 gap-2 text-xs font-medium">
          <div className="col-span-2">PO No.</div>
          <div className="col-span-2">Style</div>
          <div className="col-span-1">Origin</div>
          <div className="col-span-1">Type</div>
          <div className="col-span-2">Planned / Actual</div>
          <div className="col-span-1">Status</div>
          <div className="col-span-1">Carrier</div>
          <div className="col-span-2">Tracking / Files</div>
        </div>

        {filtered.map(row => (
          <div key={row.id} className="grid grid-cols-12 gap-2 mt-2 items-center">
            <div className="col-span-2 text-sm">{row.po_no || row.po_id}</div>
            <div className="col-span-2 text-sm">{row.style_no || "—"}</div>
            <div className="col-span-1 text-xs">{row.origin_code || "—"}</div>
            <div className="col-span-1">
              <Select value={row.type} onValueChange={(v)=>updateRow(row.id, { type: v as SampleType })}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent className="z-50">
                  {SAMPLE_TYPES.map(t=> <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 flex gap-2">
              <Input type="date" value={row.planned_date||""} onChange={(e)=>updateRow(row.id,{planned_date:e.target.value})}/>
              <Input type="date" value={row.actual_date||""} onChange={(e)=>updateRow(row.id,{actual_date:e.target.value})}/>
            </div>
            <div className="col-span-1">
              <Select value={row.status} onValueChange={(v)=>updateRow(row.id, { status: v as SampleStatus })}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent className="z-50">
                  {SAMPLE_STATUSES.map(s=> <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-1"><Input value={row.carrier||""} onChange={(e)=>updateRow(row.id,{carrier:e.target.value})}/></div>
            <div className="col-span-2">
              <div className="flex gap-2">
                <Input placeholder="Tracking No." value={row.tracking_no||""} onChange={(e)=>updateRow(row.id,{tracking_no:e.target.value})}/>
                <label className="text-xs px-2 py-1 rounded bg-zinc-100 border cursor-pointer">
                  Upload
                  <input type="file" className="hidden" accept="application/pdf,image/*" onChange={(e)=>handleAttach(row, e.target.files?.[0]||undefined)}/>
                </label>
              </div>
              <div className="mt-1 text-[11px] space-y-1">
                {(row.attachments||[]).map((f,i)=> (
                  <div key={i} className="flex items-center justify-between">
                    <span className="truncate max-w-[220px]" title={f.name}>{f.name}</span>
                    {f.url ? <a className="underline" href={f.url} target="_blank" rel="noreferrer">view</a> : <span className="opacity-60">(pending)</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// =====================================================
// Helper: resolve PO Id by PO No (so end users don't need ids)
// =====================================================
async function resolvePoIdByPoNo(poNo: string): Promise<{ id?: string; po_no?: string } | null> {
  if (!poNo) return null;
  if (!supabase) {
    const m = MOCK_ROWS.find(r => r.po_no === poNo);
    return m ? { id: m.po_id, po_no: m.po_no } : null;
  }
  const { data, error } = await supabase.from("po_headers").select("id,po_no").eq("po_no", poNo).maybeSingle();
  if (error) { console.warn("resolvePoId error", error); return null; }
  return (data as any) || null;
}

// =====================================================
// PO-specific Samples Tab (PO No only; PO Id auto-resolved)
// =====================================================
function PoSamplesTab() {
  const [poNo, setPoNo] = React.useState("");
  const [resolvedPoId, setResolvedPoId] = React.useState<string>("");
  const [rows, setRows] = React.useState<SampleRow[]>([]);
  const [newType, setNewType] = React.useState<SampleType>("PP");
  const [newStyle, setNewStyle] = React.useState("");
  const [newPlan, setNewPlan] = React.useState("");
  const [notFound, setNotFound] = React.useState(false);
  const [lastTried, setLastTried] = React.useState<string>("");

  const doResolve = React.useCallback(async (po_no: string) => {
    const res = await resolvePoIdByPoNo(po_no);
    setResolvedPoId(res?.id || "");
    return res?.id || "";
  }, []);

  const load = React.useCallback(async () => {
    if (!poNo) { setRows([]); setResolvedPoId(""); setNotFound(false); return; }
    setLastTried(poNo);
    const id = await doResolve(poNo);
    if (!supabase) {
      const data = MOCK_ROWS.filter(r => (poNo && r.po_no===poNo));
      setRows(data);
      setNotFound(data.length === 0);
      if (data.length === 0) alert(`No samples found for PO No: ${poNo}`);
      return;
    }
    let q = supabase.from("sample_milestones").select("id, po_id, po_no, po_line_id, style_no, origin_code, type, planned_date, actual_date, status, carrier, tracking_no, attachments").order("planned_date");
    if (id) q = q.eq("po_id", id); else q = q.eq("po_no", poNo);
    const { data, error } = await q;
    const arr = (data as any[]) || [];
    setRows(arr);
    const none = !error && arr.length === 0;
    setNotFound(none);
    if (none) alert(`No samples found for PO No: ${poNo}. You can create a new PO or verify the number.`);
  }, [poNo, doResolve]);

  React.useEffect(() => { /* optional auto-load on poNo change */ }, [poNo]);

  const updateRow = (id: string, patch: Partial<SampleRow>) => {
    setRows(prev => prev.map(r => r.id===id ? ({...r, ...patch}) : r));
    // TODO: persist
  };
  const removeRow = (id: string) => {
    setRows(prev => prev.filter(r => r.id!==id));
    // TODO: delete in DB
  };
  const addRow = () => {
    if (!poNo) { alert("Enter PO No."); return; }
    const row: SampleRow = {
      id: crypto.randomUUID(),
      po_id: resolvedPoId || `tmp-${poNo}`,
      po_no: poNo,
      type: newType,
      planned_date: newPlan || "",
      status: "PLANNED",
      style_no: newStyle || "",
      attachments: [],
    };
    setRows(prev => [row, ...prev]);
  };

  const handleAttach = async (row: SampleRow, file?: File) => {
    if (!file) return;
    try {
      const upload = await uploadAttachment(file, row.po_no || row.po_id, row.type);
      const att = { name: file.name, url: upload.url };
      updateRow(row.id, { attachments: [...(row.attachments||[]), att] });
    } catch (e) {
      console.warn("attachment upload failed", e);
    }
  };

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-2xl">PO Samples</CardTitle>
      </CardHeader>
      <CardContent>
        {/* PO lookup by number (Id auto-resolved internally) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">PO No.</Label>
            <Input value={poNo} onChange={(e)=>{ setPoNo(e.target.value); setNotFound(false); }} placeholder="e.g., 4400003943"/>
          </div>
          <div className="flex items-end gap-2">
            <Button className="bg-blue-500 hover:bg-blue-600 text-white" onClick={load}>Load</Button>
            {resolvedPoId && <div className="text-[11px] opacity-60">resolved id: {resolvedPoId}</div>}
          </div>
        </div>

        {notFound && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
            <div className="font-medium">No data found for PO No: {lastTried}</div>
            <div className="mt-1 opacity-80">Check the number, or create a new PO if this is a new order.</div>
            <div className="mt-2 flex gap-2">
              <a href="/po/create" className="px-3 py-1 rounded bg-blue-500 text-white hover:bg-blue-600">Create PO</a>
              <a href="/po" className="px-3 py-1 rounded border">Open PO List</a>
            </div>
          </div>
        )}

        <Separator className="my-4"/>

        {/* quick add */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={newType} onValueChange={(v)=>setNewType(v as SampleType)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent className="z-50">
                {SAMPLE_TYPES.map(t=> <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Style No.</Label>
            <Input value={newStyle} onChange={(e)=>setNewStyle(e.target.value)} placeholder="optional"/>
          </div>
          <div>
            <Label className="text-xs">Planned Date</Label>
            <Input type="date" value={newPlan} onChange={(e)=>setNewPlan(e.target.value)} />
          </div>
          <div className="md:col-span-2 flex gap-2">
            <Button className="bg-blue-500 hover:bg-blue-600 text-white" onClick={addRow}>Add Milestone</Button>
            <Button variant="ghost" onClick={()=>{setNewStyle(""); setNewPlan("");}}>Clear</Button>
          </div>
        </div>

        <Separator className="my-4"/>

        {/* header */}
        <div className="grid grid-cols-12 gap-2 text-xs font-medium">
          <div className="col-span-2">Type</div>
          <div className="col-span-2">Style</div>
          <div className="col-span-2">Planned / Actual</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-1">Carrier</div>
          <div className="col-span-2">Tracking / Files</div>
          <div className="col-span-1 text-right">Actions</div>
        </div>

        {rows.map(row => (
          <div key={row.id} className="grid grid-cols-12 gap-2 mt-2 items-center">
            <div className="col-span-2">
              <Select value={row.type} onValueChange={(v)=>updateRow(row.id, { type: v as SampleType })}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent className="z-50">
                  {SAMPLE_TYPES.map(t=> <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2"><Input value={row.style_no||""} onChange={(e)=>updateRow(row.id,{style_no:e.target.value})}/></div>
            <div className="col-span-2 flex gap-2">
              <Input type="date" value={row.planned_date||""} onChange={(e)=>updateRow(row.id,{planned_date:e.target.value})}/>
              <Input type="date" value={row.actual_date||""} onChange={(e)=>updateRow(row.id,{actual_date:e.target.value})}/>
            </div>
            <div className="col-span-2">
              <Select value={row.status} onValueChange={(v)=>updateRow(row.id, { status: v as SampleStatus })}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent className="z-50">
                  {SAMPLE_STATUSES.map(s=> <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-1"><Input value={row.carrier||""} onChange={(e)=>updateRow(row.id,{carrier:e.target.value})}/></div>
            <div className="col-span-2">
              <div className="flex gap-2">
                <Input placeholder="Tracking No." value={row.tracking_no||""} onChange={(e)=>updateRow(row.id,{tracking_no:e.target.value})}/>
                <label className="text-xs px-2 py-1 rounded bg-zinc-100 border cursor-pointer">
                  Upload
                  <input type="file" className="hidden" accept="application/pdf,image/*" onChange={(e)=>handleAttach(row, e.target.files?.[0]||undefined)}/>
                </label>
              </div>
              <div className="mt-1 text-[11px] space-y-1">
                {(row.attachments||[]).map((f,i)=> (
                  <div key={i} className="flex items-center justify-between">
                    <span className="truncate max-w-[220px]" title={f.name}>{f.name}</span>
                    {f.url ? <a className="underline" href={f.url} target="_blank" rel="noreferrer">view</a> : <span className="opacity-60">(pending)</span>}
                  </div>
                ))}
              </div>
            </div>
            <div className="col-span-1 text-right">
              <Button variant="ghost" className="text-red-600 hover:text-red-700" onClick={()=>removeRow(row.id)}>Remove</Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// =====================================================
// Main wrapper with simple tab switch (Board / PO)
// =====================================================
export default function SamplesModule() {
  const [tab, setTab] = React.useState<"board"|"po">("board");
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button className={tab==="board"?"bg-blue-500 hover:bg-blue-600 text-white":""} onClick={()=>setTab("board")}>Samples Board</Button>
        <Button className={tab==="po"?"bg-blue-500 hover:bg-blue-600 text-white":""} onClick={()=>setTab("po")}>PO Samples</Button>
      </div>
      {tab === "board" ? <SamplesBoard/> : <PoSamplesTab/>}
    </div>
  );
}
