"use client";

import React from "react";
import useSWR from "swr";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const fetcher = async (url: string) => {
  const r = await fetch(url, { cache: "no-store" });
  return r.json();
};

type Buyer = { id: string; name: string; code: string };
type FileItem = { name: string; path: string; url: string; size?: number; type?: string };

type RequestForm = {
  id?: string;
  request_no: string;
  request_title: string;
  buyer_id: string;
  buyer_code: string;
  buyer_name: string;
  buyer_contact_name: string;
  buyer_contact_email: string;
  buyer_contact_phone: string;
  our_owner_name: string;
  our_owner_email: string;
  request_date: string;
  due_date: string;
  target_ship_date: string;
  sent_date: string;
  feedback_date: string;
  next_follow_up_date: string;
  progress_status: string;
  result_status: string;
  current_step: string;
  requested_items_text: string;
  progress_note: string;
  buyer_feedback: string;
  buyer_additional_request: string;
  carrier: string;
  tracking_no: string;
  shipping_cost: number;
  ship_to_country: string;
  ship_to_address_summary: string;
  is_converted_to_order: boolean;
  po_no: string;
  converted_date: string;
  estimated_order_value: number;
  development_cost_material: number;
  development_cost_labor: number;
  development_cost_shipping: number;
  cost_currency: string;
  sample_chargeable: boolean;
  charged_to_buyer: boolean;
  charged_amount: number;
  charged_currency: string;
  attachments: FileItem[];
  reference_images: FileItem[];
  shipment_proof_files: FileItem[];
  internal_note: string;
  buyer_note: string;
};

type Summary = {
  total_requests: number;
  in_progress: number;
  completed: number;
  converted_requests: number;
  conversion_pct: number;
  overdue: number;
  waiting_feedback: number;
};

const PROGRESS_OPTIONS = [
  "REQUESTED",
  "IN_PROGRESS",
  "READY_TO_SEND",
  "SENT",
  "WAITING_FEEDBACK",
  "FEEDBACK_RECEIVED",
  "REVISE_REQUIRED",
  "APPROVED",
  "REJECTED",
  "COMPLETED",
] as const;

const RESULT_OPTIONS = [
  "WAITING",
  "APPROVED",
  "REVISE",
  "REJECTED",
  "CONVERTED_TO_ORDER",
  "CLOSED_NO_ORDER",
] as const;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function makeEmptyForm(): RequestForm {
  return {
    request_no: "",
    request_title: "",
    buyer_id: "",
    buyer_code: "",
    buyer_name: "",
    buyer_contact_name: "",
    buyer_contact_email: "",
    buyer_contact_phone: "",
    our_owner_name: "",
    our_owner_email: "",
    request_date: todayISO(),
    due_date: "",
    target_ship_date: "",
    sent_date: "",
    feedback_date: "",
    next_follow_up_date: "",
    progress_status: "REQUESTED",
    result_status: "WAITING",
    current_step: "",
    requested_items_text: "",
    progress_note: "",
    buyer_feedback: "",
    buyer_additional_request: "",
    carrier: "",
    tracking_no: "",
    shipping_cost: 0,
    ship_to_country: "",
    ship_to_address_summary: "",
    is_converted_to_order: false,
    po_no: "",
    converted_date: "",
    estimated_order_value: 0,
    development_cost_material: 0,
    development_cost_labor: 0,
    development_cost_shipping: 0,
    cost_currency: "USD",
    sample_chargeable: false,
    charged_to_buyer: false,
    charged_amount: 0,
    charged_currency: "USD",
    attachments: [],
    reference_images: [],
    shipment_proof_files: [],
    internal_note: "",
    buyer_note: "",
  };
}

function fmtPct(n: number) {
  return `${Number(n || 0).toFixed(2)}%`;
}

function alertBadgeClass(v: string) {
  const s = (v || "").toUpperCase();
  if (s === "OVERDUE") return "bg-rose-100 text-rose-700 border border-rose-200";
  if (s === "DUE_SOON" || s === "FOLLOW_UP_DUE") return "bg-amber-100 text-amber-700 border border-amber-200";
  if (s === "WAITING_FEEDBACK") return "bg-sky-100 text-sky-700 border border-sky-200";
  return "bg-slate-100 text-slate-700 border border-slate-200";
}

function normalizeResultStatus(v: string) {
  const s = (v || "").toUpperCase();
  if (s === "CONVERTED") return "CONVERTED_TO_ORDER";
  if (s === "CLOSED" || s === "NO_ORDER") return "CLOSED_NO_ORDER";
  if ((RESULT_OPTIONS as readonly string[]).includes(s)) return s;
  return "WAITING";
}

function normalizeProgressStatus(v: string, resultStatus?: string) {
  const s = (v || "").toUpperCase();
  const result = normalizeResultStatus(resultStatus || "");
  if (s === "CONVERTED_TO_ORDER" || s === "CLOSED_NO_ORDER") return "COMPLETED";
  if ((PROGRESS_OPTIONS as readonly string[]).includes(s)) return s;
  if (result === "CONVERTED_TO_ORDER" || result === "CLOSED_NO_ORDER") return "COMPLETED";
  return "REQUESTED";
}

function normalizeForm(input: RequestForm): RequestForm {
  const resultStatus = normalizeResultStatus(input.result_status);
  let progressStatus = normalizeProgressStatus(input.progress_status, resultStatus);
  let normalizedResultStatus = resultStatus;

  if (normalizedResultStatus === "CONVERTED_TO_ORDER" || normalizedResultStatus === "CLOSED_NO_ORDER") {
    progressStatus = "COMPLETED";
  }
  if (progressStatus !== "COMPLETED" && (normalizedResultStatus === "CONVERTED_TO_ORDER" || normalizedResultStatus === "CLOSED_NO_ORDER")) {
    normalizedResultStatus = "WAITING";
  }

  return {
    ...input,
    progress_status: progressStatus,
    result_status: normalizedResultStatus,
    is_converted_to_order: normalizedResultStatus === "CONVERTED_TO_ORDER",
  };
}

function computeSummary(items: any[]): Summary {
  const today = todayISO();
  let total = 0;
  let inProgress = 0;
  let completed = 0;
  let converted = 0;
  let overdue = 0;
  let waitingFeedback = 0;

  for (const raw of items || []) {
    total += 1;
    const result = normalizeResultStatus(raw?.result_status);
    const progress = normalizeProgressStatus(raw?.progress_status, result);
    const targetShipDate = String(raw?.target_ship_date || "").slice(0, 10);

    if (progress === "COMPLETED") completed += 1;
    else inProgress += 1;

    if (result === "CONVERTED_TO_ORDER") converted += 1;
    if (result === "WAITING" || progress === "WAITING_FEEDBACK") waitingFeedback += 1;
    if (targetShipDate && targetShipDate < today && progress !== "COMPLETED") overdue += 1;
  }

  return {
    total_requests: total,
    in_progress: inProgress,
    completed,
    converted_requests: converted,
    conversion_pct: total ? (converted / total) * 100 : 0,
    overdue,
    waiting_feedback: waitingFeedback,
  };
}

function hasDuplicateRequestNoError(json: any) {
  const text = `${json?.error || ""} ${json?.message || ""} ${json?.detail || ""}`.toLowerCase();
  return text.includes("sample_requests_request_no_key") || text.includes("duplicate key") || text.includes("request_no");
}

function FileUploader({
  label,
  files,
  onChange,
}: {
  label: string;
  files: FileItem[];
  onChange: (files: FileItem[]) => void;
}) {
  async function upload(ev: React.ChangeEvent<HTMLInputElement>) {
    const f = ev.target.files?.[0];
    if (!f) return;
    const form = new FormData();
    form.append("file", f);
    const res = await fetch("/api/sample-requests/upload", { method: "POST", body: form });
    const json = await res.json();
    if (json?.ok && json?.file) {
      onChange([...(files || []), json.file]);
    } else {
      alert(json?.error || "Upload failed");
    }
    ev.target.value = "";
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type="file" onChange={upload} />
      <div className="space-y-2">
        {(files || []).map((f, idx) => (
          <div key={idx} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
            <a className="truncate text-blue-600 underline" href={f.url} target="_blank" rel="noreferrer">
              {f.name}
            </a>
            <Button type="button" variant="outline" size="sm" onClick={() => onChange(files.filter((_, i) => i !== idx))}>
              Remove
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SampleRequestsPage() {
  const [q, setQ] = React.useState("");
  const [buyerFilter, setBuyerFilter] = React.useState("ALL");
  const [selectedId, setSelectedId] = React.useState("");
  const [form, setForm] = React.useState<RequestForm>(makeEmptyForm());
  const [isSaving, setIsSaving] = React.useState(false);

  const listQs = new URLSearchParams();
  if (q.trim()) listQs.set("q", q.trim());
  if (buyerFilter !== "ALL") listQs.set("buyer_id", buyerFilter);

  const { data, mutate } = useSWR(`/api/sample-requests?${listQs.toString()}`, fetcher);
  const { data: optData, isLoading: buyersLoading } = useSWR(`/api/sample-requests/options`, fetcher);

  const buyers: Buyer[] = optData?.buyers || [];
  const buyersLoadError = !buyersLoading && optData?.ok === false ? (optData?.error || "Failed to load buyers") : "";
  const items = data?.items || [];
  const buyerKpis = data?.buyer_kpis || [];
  const summary = React.useMemo(() => computeSummary(items), [items]);

  async function fetchNextNo(buyerCode: string, requestDate: string) {
    if (!buyerCode) return "";
    const qs = new URLSearchParams({ buyerCode, requestDate }).toString();
    const res = await fetch(`/api/sample-requests/next-no?${qs}`, { cache: "no-store" });
    const json = await res.json();
    return json?.ok && json?.request_no ? String(json.request_no) : "";
  }

  async function hydrateNo(buyerCode: string, requestDate: string) {
    const nextNo = await fetchNextNo(buyerCode, requestDate);
    if (nextNo) {
      setForm((prev) => ({ ...prev, request_no: nextNo }));
    }
  }

  React.useEffect(() => {
    if (!form.id && form.buyer_code) hydrateNo(form.buyer_code, form.request_date || todayISO());
  }, [form.buyer_code, form.request_date]); // eslint-disable-line react-hooks/exhaustive-deps

  function setField<K extends keyof RequestForm>(key: K, value: RequestForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function onNew() {
    setSelectedId("");
    setForm(makeEmptyForm());
  }

  function load(item: any) {
    setSelectedId(item.id || "");
    const merged = normalizeForm({
      ...makeEmptyForm(),
      ...item,
      attachments: item.attachments || [],
      reference_images: item.reference_images || [],
      shipment_proof_files: item.shipment_proof_files || [],
    });
    setForm(merged);
  }

  async function save() {
    if (isSaving) return;
    setIsSaving(true);
    try {
      let payload = normalizeForm(form);

      if (!payload.request_title.trim()) {
        alert("Request Title is required.");
        return;
      }
      if (!payload.buyer_id || !payload.buyer_code) {
        alert("Please select a buyer.");
        return;
      }

      if (!payload.id) {
        const latestNo = await fetchNextNo(payload.buyer_code, payload.request_date || todayISO());
        if (latestNo) {
          payload = { ...payload, request_no: latestNo };
          setForm((prev) => ({ ...prev, request_no: latestNo }));
        }
      }

      const method = payload.id ? "PUT" : "POST";
      const url = payload.id ? `/api/sample-requests/${payload.id}` : `/api/sample-requests`;
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      if (!json?.ok) {
        if (!payload.id && hasDuplicateRequestNoError(json)) {
          const refreshedNo = await fetchNextNo(payload.buyer_code, payload.request_date || todayISO());
          if (refreshedNo) {
            setForm((prev) => ({ ...prev, request_no: refreshedNo }));
          }
          alert(`Request No already exists. A new number has been generated${refreshedNo ? `: ${refreshedNo}` : ""}. Please save again.`);
          return;
        }
        alert(json?.error || "Save failed");
        return;
      }

      await mutate();
      if (json?.item) {
        load(json.item);
      } else if (!payload.id) {
        onNew();
      }
      alert("Saved");
    } finally {
      setIsSaving(false);
    }
  }

  async function removeCurrent() {
    if (!form.id) return;
    if (!confirm("Delete this request?")) return;
    const res = await fetch(`/api/sample-requests/${form.id}`, { method: "DELETE" });
    const json = await res.json();
    if (!json?.ok) {
      alert(json?.error || "Delete failed");
      return;
    }
    onNew();
    await mutate();
  }

  const resultDisabled = form.progress_status !== "COMPLETED";

  return (
    <AppShell title="Sample Requests">
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-6">
          {[
            ["Total Requests", summary.total_requests, ""],
            ["In Progress", summary.in_progress, ""],
            ["Completed", summary.completed, ""],
            ["Converted", summary.converted_requests, ""],
            ["Overdue", summary.overdue, "text-rose-600"],
            ["Waiting Feedback", summary.waiting_feedback, ""],
          ].map(([title, value, valueClass], idx) => (
            <Card key={idx}>
              <CardContent className="flex h-[132px] flex-col justify-between p-6">
                <div className="min-h-[44px] text-sm font-medium leading-5 text-muted-foreground">{title as string}</div>
                <div className={`text-3xl font-bold leading-none ${valueClass as string}`}>{String(value)}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Buyer Conversion KPI</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="p-2 text-left">Buyer</th>
                  <th className="p-2 text-right">Requests</th>
                  <th className="p-2 text-right">Converted</th>
                  <th className="p-2 text-right">Conversion %</th>
                  <th className="p-2 text-right">Overdue</th>
                  <th className="p-2 text-right">Waiting</th>
                </tr>
              </thead>
              <tbody>
                {buyerKpis.map((r: any, i: number) => (
                  <tr key={i} className="border-b">
                    <td className="p-2">{r.buyer_name}</td>
                    <td className="p-2 text-right">{r.requests}</td>
                    <td className="p-2 text-right">{r.converted}</td>
                    <td className="p-2 text-right">{fmtPct(r.conversion_pct)}</td>
                    <td className="p-2 text-right">{r.overdue}</td>
                    <td className="p-2 text-right">{r.waiting}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <Card>
              <CardHeader><CardTitle className="text-base">List</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-12 gap-3">
                  <div className="col-span-8">
                    <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title / request no / buyer / requested items..." />
                  </div>
                  <div className="col-span-4">
                    <Select value={buyerFilter} onValueChange={setBuyerFilter}>
                      <SelectTrigger><SelectValue placeholder="Buyer" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All Buyers</SelectItem>
                        {buyers.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button type="button" onClick={onNew}>New Request</Button>
                <div className="space-y-3">
                  {items.map((r: any) => (
                    <div key={r.id} className={`rounded-xl border p-4 ${selectedId === r.id ? "border-blue-500 bg-blue-50/40" : ""}`}>
                      <div className="flex items-start justify-between gap-3">
                        <button type="button" className="w-full text-left" onClick={() => load(r)}>
                          <div className="font-semibold">{r.request_title || "(Untitled request)"}</div>
                          <div className="mt-1 text-xs text-muted-foreground">Buyer: {r.buyer_name || "—"}</div>
                          <div className="mt-1 text-xs text-muted-foreground">Request No: {r.request_no || "—"}</div>
                          <div className="mt-1 text-sm line-clamp-2 text-muted-foreground">{r.requested_items_text || "—"}</div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs">
                            <span className={`inline-flex rounded-full px-2 py-1 ${alertBadgeClass(r.alert_status)}`}>{r.alert_status}</span>
                            <span className="inline-flex rounded-full border px-2 py-1">{normalizeProgressStatus(r.progress_status, r.result_status)}</span>
                          </div>
                        </button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={async () => {
                            if (!confirm("Delete this request?")) return;
                            const res = await fetch(`/api/sample-requests/${r.id}`, { method: "DELETE" });
                            const json = await res.json();
                            if (!json?.ok) {
                              alert(json?.error || "Delete failed");
                              return;
                            }
                            if (selectedId === r.id) onNew();
                            await mutate();
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-7">
            <Card>
              <CardHeader><CardTitle className="text-base">{form.id ? "Edit Request" : "New Request"}</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                {buyersLoading ? null : buyersLoadError ? (
                  <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Buyer list load issue: {buyersLoadError}
                  </div>
                ) : buyers.length === 0 ? (
                  <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Buyer list is empty. Check /api/sample-requests/options and your buyer master data.
                  </div>
                ) : null}

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <Label>Request Title</Label>
                    <Input value={form.request_title} onChange={(e) => setField("request_title", e.target.value)} placeholder="e.g. Cubic earring sample request" />
                  </div>

                  <div>
                    <Label>Buyer</Label>
                    <Select
                      value={form.buyer_id && buyers.some((b) => b.id === form.buyer_id) ? form.buyer_id : "__NONE__"}
                      onValueChange={(v) => {
                        if (v === "__NONE__") {
                          setForm((prev) => ({
                            ...prev,
                            buyer_id: "",
                            buyer_name: "",
                            buyer_code: "",
                            request_no: "",
                          }));
                          return;
                        }
                        const b = buyers.find((x) => x.id === v);
                        setForm((prev) => ({
                          ...prev,
                          buyer_id: v,
                          buyer_name: b?.name || "",
                          buyer_code: b?.code || "GEN",
                          request_no: prev.id ? prev.request_no : "",
                        }));
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Select buyer" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__NONE__">Select buyer</SelectItem>
                        {buyers.map((b) => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Request No</Label>
                    <Input value={form.request_no} onChange={(e) => setField("request_no", e.target.value)} />
                  </div>

                  <div>
                    <Label>Buyer Contact</Label>
                    <Input value={form.buyer_contact_name} onChange={(e) => setField("buyer_contact_name", e.target.value)} />
                  </div>

                  <div>
                    <Label>Our Owner</Label>
                    <Input value={form.our_owner_name} onChange={(e) => setField("our_owner_name", e.target.value)} />
                  </div>

                  <div>
                    <Label>Request Date</Label>
                    <Input type="date" value={form.request_date} onChange={(e) => setField("request_date", e.target.value)} />
                  </div>

                  <div>
                    <Label>Target Ship Date</Label>
                    <Input type="date" value={form.target_ship_date} onChange={(e) => setField("target_ship_date", e.target.value)} />
                  </div>

                  <div>
                    <Label>Status</Label>
                    <Select
                      value={normalizeProgressStatus(form.progress_status, form.result_status)}
                      onValueChange={(v) => {
                        const nextProgress = normalizeProgressStatus(v, form.result_status);
                        setForm((prev) => ({
                          ...prev,
                          progress_status: nextProgress,
                          result_status:
                            nextProgress === "COMPLETED" ? prev.result_status : "WAITING",
                        }));
                      }}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PROGRESS_OPTIONS.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Result Status</Label>
                    <Select
                      value={normalizeResultStatus(form.result_status)}
                      disabled={resultDisabled}
                      onValueChange={(v) => {
                        const nextResult = normalizeResultStatus(v);
                        setForm((prev) => ({
                          ...prev,
                          progress_status:
                            nextResult === "CONVERTED_TO_ORDER" || nextResult === "CLOSED_NO_ORDER"
                              ? "COMPLETED"
                              : prev.progress_status,
                          result_status: nextResult,
                        }));
                      }}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {RESULT_OPTIONS.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="md:col-span-2">
                    <Label>Requested Items / Details</Label>
                    <Textarea
                      className="min-h-[140px]"
                      value={form.requested_items_text}
                      onChange={(e) => setField("requested_items_text", e.target.value)}
                      placeholder="e.g. cubic earring styles, round / drop / heart options, silver + gold plating, send by 5/10"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <Label>Buyer Additional Request</Label>
                    <Textarea value={form.buyer_additional_request} onChange={(e) => setField("buyer_additional_request", e.target.value)} />
                  </div>

                  <div className="md:col-span-2">
                    <Label>Buyer Feedback</Label>
                    <Textarea value={form.buyer_feedback} onChange={(e) => setField("buyer_feedback", e.target.value)} />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <FileUploader label="Attachments" files={form.attachments} onChange={(files) => setField("attachments", files)} />
                  <FileUploader label="Reference Images" files={form.reference_images} onChange={(files) => setField("reference_images", files)} />
                  <FileUploader label="Shipment Proof Files" files={form.shipment_proof_files} onChange={(files) => setField("shipment_proof_files", files)} />
                </div>

                <div className="rounded border bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  Status is the progress stage. Result Status is the outcome. Final outcomes can only be saved when Status is COMPLETED.
                </div>

                <div className="flex gap-2">
                  <Button type="button" onClick={save} disabled={isSaving}>{isSaving ? "Saving..." : "Save"}</Button>
                  {form.id ? <Button type="button" variant="destructive" onClick={removeCurrent}>Delete</Button> : null}
                  <Button type="button" variant="outline" onClick={onNew}>Reset</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
