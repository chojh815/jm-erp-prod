"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";

import AppShell from "@/components/layout/AppShell";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

type WorkSheetHeader = {
  id: string;
  po_header_id: string | null;
  po_no: string | null;
  buyer_id: string | null;
  buyer_name: string | null;
  buyer_code: string | null;
  currency: string | null;
  status: string;

  // ✅ header에는 이것만
  notes: string | null; // Internal Notes
  general_notes?: string | null; // Special Instructions

  created_at?: string | null;
  updated_at?: string | null;
};

type WorkSheetLine = {
  id: string;
  work_sheet_id: string;
  po_line_id: string | null;

  product_id: string | null;
  jm_style_no: string;

  buyer_style: string | null;
  description: string | null;

  qty: number;

  image_url_primary: string | null;
  image_urls: any | null;

  plating_color?: string | null;
  plating_spec?: string | null;
  spec_summary?: string | null;

  // ✅ Work/QC/Packing은 line에 존재
  work_notes?: string | null;
  qc_points?: string | null;
  packing_notes?: string | null;

  vendor_id?: string | null;
  vendor_currency?: string | null;
  vendor_unit_cost_local?: number | null;

  is_deleted?: boolean;
};

type CompanyOption = {
  id: string;
  company_name: string | null;
  code: string | null;
  company_type?: string | null;
};

type SourcePolicy = "MANDATORY" | "PREFERRED" | "FREE";

type WorkSheetMaterialSpec = {
  id: string;
  work_sheet_line_id: string;

  material_type: string | null;
  material_name: string;
  spec_text: string | null;
  color: string | null;

  source_policy: SourcePolicy;
  source_vendor_id: string | null;
  source_vendor_text: string | null;
  note: string | null;
  sort_order: number;
  is_deleted?: boolean;
};

type ApiGetResponse = {
  success: boolean;
  header?: WorkSheetHeader | null;
  lines?: WorkSheetLine[];
  materialsByLineId?: Record<string, WorkSheetMaterialSpec[]>;
  po?: any;
  error?: string;
};

type ApiSaveResponse = ApiGetResponse;

function nnum(v: any, fallback = 0) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isNaN(n) ? fallback : n;
}
function toStr(v: any) {
  return v === null || v === undefined ? "" : String(v);
}
function safeArray(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String);
  try {
    const parsed = typeof v === "string" ? JSON.parse(v) : v;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
function fmtDate(d?: string | null) {
  if (!d) return "";
  return String(d).slice(0, 10);
}
function stableStringify(obj: any): string {
  const seen = new WeakSet();
  const replacer = (_k: string, v: any) => {
    if (v && typeof v === "object") {
      if (seen.has(v)) return;
      seen.add(v);

      if (Array.isArray(v)) return v;

      const keys = Object.keys(v).sort();
      const out: any = {};
      for (const k of keys) out[k] = v[k];
      return out;
    }
    return v;
  };
  return JSON.stringify(obj, replacer);
}

export default function WorkSheetDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [header, setHeader] = React.useState<WorkSheetHeader | null>(null);
  const [po, setPo] = React.useState<any>(null);

  const [lines, setLines] = React.useState<WorkSheetLine[]>([]);
  const [materialsByLineId, setMaterialsByLineId] = React.useState<
    Record<string, WorkSheetMaterialSpec[]>
  >({});

  // Vendors (Subcontractors) for Work Sheet line
  const [vendors, setVendors] = React.useState<CompanyOption[]>([]);
  const [vendorSearch, setVendorSearch] = React.useState("");
  const [vendorsLoading, setVendorsLoading] = React.useState(false);
  const [vendorLoadError, setVendorLoadError] = React.useState<string | null>(
    null
  );

  const vendorMap = React.useMemo(() => {
    const m = new Map<string, CompanyOption>();
    for (const v of vendors) {
      if (v?.id) m.set(v.id, v);
    }
    return m;
  }, [vendors]);

  const filteredVendors = React.useMemo(() => {
    const t = vendorSearch.trim().toLowerCase();
    if (!t) return vendors;
    return vendors.filter((v) => {
      const name = (v.company_name ?? "").toLowerCase();
      const code = (v.code ?? "").toLowerCase();
      return name.includes(t) || code.includes(t);
    });
  }, [vendors, vendorSearch]);

  function vendorLabel(v: CompanyOption) {
    const n = (v.company_name ?? "").trim() || "Vendor";
    const c = (v.code ?? "").trim();
    return c ? `${n} (${c})` : n;
  }

  async function loadVendors() {
    try {
      setVendorLoadError(null);
      setVendorsLoading(true);
      const res = await fetch(`/api/work-sheets/vendors?limit=2000`, {
        cache: "no-store" as any,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) {
        throw new Error(j?.error || "Failed to load vendors");
      }
      setVendors(Array.isArray(j.rows) ? j.rows : []);
    } catch (e: any) {
      console.error(e);
      setVendorLoadError(e?.message ?? "Failed to load vendors");
    } finally {
      setVendorsLoading(false);
    }
  }

  const [activeLineId, setActiveLineId] = React.useState<string | null>(null);

  /**
   * ✅ 1번 방식 핵심:
   * 하단 3박스(Work/QC/Packing)는 "공통 박스"로 보이지만,
   * 실제 저장은 work_sheet_lines 중 "고정된 1개 라인(masterLineId)"에 저장한다.
   *
   * 중요: masterLineId는 lines[0]처럼 매번 계산하지 않고 "상태로 고정"한다.
   */
  const [masterLineId, setMasterLineId] = React.useState<string | null>(null);

  const masterLine = React.useMemo(() => {
    if (!masterLineId) return null;
    return lines.find((l) => l.id === masterLineId) ?? null;
  }, [lines, masterLineId]);

  const activeLine = React.useMemo(() => {
    if (!activeLineId) return null;
    return lines.find((l) => l.id === activeLineId) ?? null;
  }, [lines, activeLineId]);

  const lastSavedHashRef = React.useRef<string>("");
  const didInitRef = React.useRef(false);

  const isDirty = React.useMemo(() => {
    if (!didInitRef.current) return false;
    const now = stableStringify({
      header,
      po,
      lines,
      materialsByLineId,
      activeLineId,
      masterLineId,
    });
    return now !== lastSavedHashRef.current;
  }, [header, po, lines, materialsByLineId, activeLineId, masterLineId]);

  function updateHeader(patch: Partial<WorkSheetHeader>) {
    setHeader((prev) => (prev ? { ...prev, ...patch } : prev));
  }
  function updateLine(lineId: string, patch: Partial<WorkSheetLine>) {
    setLines((prev) =>
      prev.map((l) => (l.id === lineId ? ({ ...l, ...patch } as any) : l))
    );
  }

  async function load() {
    if (!id) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/work-sheets/${id}`, { cache: "no-store" });
      const json: ApiGetResponse = await res.json().catch(() => ({} as any));
      if (!res.ok || !json?.success)
        throw new Error(json?.error || "Load failed");

      const h = (json.header ?? null) as WorkSheetHeader | null;
      const l = (json.lines ?? []).filter(
        (x) => !x.is_deleted
      ) as WorkSheetLine[];
      const m = (json.materialsByLineId ??
        {}) as Record<string, WorkSheetMaterialSpec[]>;
      const p = (json.po ?? null) as any;

      setHeader(h);
      setPo(p);
      setLines(l);
      setMaterialsByLineId(m);

      // ✅ activeLineId: 기존 유지, 없으면 첫 라인
      setActiveLineId((prev) => {
        if (prev && l.some((x) => x.id === prev)) return prev;
        return l?.[0]?.id ?? null;
      });

      // ✅ masterLineId: "고정" 유지가 핵심
      setMasterLineId((prev) => {
        if (prev && l.some((x) => x.id === prev)) return prev;
        return l?.[0]?.id ?? null;
      });

      const nextActive =
        activeLineId && l.some((x) => x.id === activeLineId)
          ? activeLineId
          : l?.[0]?.id ?? null;

      const nextMaster =
        masterLineId && l.some((x) => x.id === masterLineId)
          ? masterLineId
          : l?.[0]?.id ?? null;

      lastSavedHashRef.current = stableStringify({
        header: h,
        po: p,
        lines: l,
        materialsByLineId: m,
        activeLineId: nextActive,
        masterLineId: nextMaster,
      });
      didInitRef.current = true;
    } catch (e: any) {
      setError(e?.message ?? "Load error");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  React.useEffect(() => {
    void loadVendors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function confirmIfDirty(actionLabel: string) {
    if (!isDirty) return true;
    return window.confirm(
      `저장되지 않은 변경사항이 있습니다(Draft).\n그래도 ${actionLabel} 하시겠습니까?`
    );
  }

  function openPdf(mode: "vendor" | "internal") {
    if (!confirmIfDirty("PDF 열기")) return;
    window.open(
      `/work-sheets/${id}/pdf?mode=${mode}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  async function onSave() {
    if (!header) return;

    for (const l of lines) {
      const v = (l?.jm_style_no ?? "").trim();
      if (!v) {
        alert("JM Style No 는 필수입니다.");
        return;
      }
    }

    setSaving(true);
    setError(null);

    try {
      const payload = {
        header: {
          id: header.id,
          status: header.status,
          notes: header.notes ?? null,
          general_notes: header.general_notes ?? null,
        },

        lines: lines.map((l) => ({
          id: l.id,
          work_sheet_id: l.work_sheet_id,
          po_line_id: l.po_line_id ?? null,
          product_id: l.product_id ?? null,

          jm_style_no: (l.jm_style_no ?? "").trim(),
          qty: l.qty,

          buyer_style: l.buyer_style ?? null,
          description: l.description ?? null,

          plating_color: l.plating_color ?? null,
          plating_spec: l.plating_spec ?? null,
          spec_summary: l.spec_summary ?? null,

          work_notes: l.work_notes ?? null,
          qc_points: l.qc_points ?? null,
          packing_notes: l.packing_notes ?? null,

          image_url_primary: l.image_url_primary ?? null,
          image_urls: l.image_urls ?? null,

          vendor_id: l.vendor_id ?? null,
          vendor_currency: l.vendor_currency ?? null,
          vendor_unit_cost_local: l.vendor_unit_cost_local ?? null,
        })),

        materialsByLineId: Object.fromEntries(
          Object.entries(materialsByLineId).map(([lineId, arr]) => [
            lineId,
            (arr ?? []).map((s) => ({
              id: s.id,
              work_sheet_line_id: s.work_sheet_line_id ?? lineId,
              material_type: s.material_type ?? null,
              material_name: s.material_name ?? "",
              spec_text: s.spec_text ?? null,
              color: s.color ?? null,
              source_policy: s.source_policy,
              source_vendor_id: s.source_vendor_id ?? null,
              source_vendor_text: s.source_vendor_text ?? null,
              note: s.note ?? null,
              sort_order: nnum(s.sort_order, 0),
              is_deleted: !!s.is_deleted,
            })),
          ])
        ),
      };

      const res = await fetch(`/api/work-sheets/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json: ApiSaveResponse = await res.json().catch(() => ({} as any));
      if (!res.ok || !json?.success)
        throw new Error(json?.error || "Save failed");

      const incomingHeader = (json.header ??
        null) as WorkSheetHeader | null;
      const incomingLines = (json.lines ?? []).filter(
        (l: any) => !l.is_deleted
      ) as WorkSheetLine[];
      const incomingMaterials =
        (json.materialsByLineId ??
          {}) as Record<string, WorkSheetMaterialSpec[]>;
      const incomingPo = (json as any)?.po ?? null;

      const nextHeader = incomingHeader
        ? { ...(header as any), ...(incomingHeader as any) }
        : header;

      // ✅ lines merge: 로컬 값을 "우선" 유지하면서 서버값 덮기
      const incomingMap = new Map(incomingLines.map((x) => [x.id, x]));
      const nextLines =
        incomingLines.length > 0
          ? lines.map((l) => {
              const saved = incomingMap.get(l.id);
              return saved ? ({ ...l, ...saved } as any) : l;
            })
          : lines;

      const nextMaterials = { ...materialsByLineId, ...incomingMaterials };

      setHeader(nextHeader);
      setPo(incomingPo ?? po);
      setLines(nextLines);
      setMaterialsByLineId(nextMaterials);

      setActiveLineId((prev) => {
        if (prev && nextLines.some((x) => x.id === prev)) return prev;
        return nextLines?.[0]?.id ?? null;
      });

      setMasterLineId((prev) => {
        if (prev && nextLines.some((x) => x.id === prev)) return prev;
        return nextLines?.[0]?.id ?? null;
      });

      const nextActive =
        activeLineId && nextLines.some((x) => x.id === activeLineId)
          ? activeLineId
          : nextLines?.[0]?.id ?? null;

      const nextMaster =
        masterLineId && nextLines.some((x) => x.id === masterLineId)
          ? masterLineId
          : nextLines?.[0]?.id ?? null;

      lastSavedHashRef.current = stableStringify({
        header: nextHeader,
        po: incomingPo ?? po,
        lines: nextLines,
        materialsByLineId: nextMaterials,
        activeLineId: nextActive,
        masterLineId: nextMaster,
      });
      didInitRef.current = true;
    } catch (e: any) {
      setError(e?.message ?? "Save error");
    } finally {
      setSaving(false);
    }
  }

  const reqShipDate = fmtDate(po?.requested_ship_date ?? null);
  const brand = toStr(po?.buyer_brand_name ?? "").trim();
  const dept = toStr(po?.buyer_dept_name ?? "").trim();
  const brandDept = [brand, dept].filter(Boolean).join(" / ");

  return (
    // ✅ requiredRoles 제거 (AppShellProps에 없어서 빌드 에러)
    <AppShell title="Work Sheets">
      <div className="mx-auto w-full max-w-[1200px] space-y-4 p-4">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>Work Sheet Detail</CardTitle>

              <div className="mt-1 text-sm text-muted-foreground">
                PO:{" "}
                <span className="font-medium text-foreground">
                  {header?.po_no ?? "-"}
                </span>
                {" · "}
                Buyer:{" "}
                <span className="font-medium text-foreground">
                  {header?.buyer_name ?? "-"}
                </span>
                {" · "}
                Currency:{" "}
                <span className="font-medium text-foreground">
                  {header?.currency ?? "USD"}
                </span>
              </div>

              <div className="mt-1 text-xs text-muted-foreground">
                {brandDept ? (
                  <>
                    Brand/Dept:{" "}
                    <span className="text-foreground">{brandDept}</span>
                    {" · "}
                  </>
                ) : null}
                {po?.ship_mode ? (
                  <>
                    Ship Mode:{" "}
                    <span className="text-foreground">{po.ship_mode}</span>
                    {" · "}
                  </>
                ) : null}
                Req Ship Date:{" "}
                <span className="text-foreground">{reqShipDate || "-"}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {didInitRef.current ? (
                isDirty ? (
                  <Badge variant="destructive">Draft</Badge>
                ) : (
                  <Badge variant="secondary">Saved</Badge>
                )
              ) : (
                <Badge variant="outline">Loading...</Badge>
              )}

              <div className="min-w-[180px]">
                <Select
                  value={header?.status ?? "DRAFT"}
                  onValueChange={(v) => updateHeader({ status: v })}
                  disabled={!header}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DRAFT">DRAFT</SelectItem>
                    <SelectItem value="SENT">SENT</SelectItem>
                    <SelectItem value="CLOSED">CLOSED</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button onClick={onSave} disabled={saving || loading || !header}>
                {saving ? "Saving..." : "Save"}
              </Button>

              <Button
                variant="outline"
                onClick={() => openPdf("vendor")}
                disabled={!header}
              >
                PDF Vendor
              </Button>
              <Button
                variant="outline"
                onClick={() => openPdf("internal")}
                disabled={!header}
              >
                PDF Internal
              </Button>

              <Button variant="outline" onClick={() => router.back()}>
                Back
              </Button>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Special / Internal */}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Special Instructions (공통 주의사항)</Label>
                <Textarea
                  value={header?.general_notes ?? ""}
                  onChange={(e) =>
                    updateHeader({ general_notes: e.target.value })
                  }
                  placeholder="Special instructions..."
                  rows={4}
                  disabled={!header}
                />
              </div>
              <div className="space-y-2">
                <Label>Internal Notes (내부 메모)</Label>
                <Textarea
                  value={header?.notes ?? ""}
                  onChange={(e) => updateHeader({ notes: e.target.value })}
                  placeholder="Internal memo..."
                  rows={4}
                  disabled={!header}
                />
              </div>
            </div>

            {/* ✅ Work/QC/Packing : "고정된 masterLineId"에 저장/표시 */}
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Work</Label>
                <Textarea
                  value={masterLine?.work_notes ?? ""}
                  onChange={(e) =>
                    masterLineId &&
                    updateLine(masterLineId, { work_notes: e.target.value })
                  }
                  rows={5}
                  placeholder="Work instructions..."
                  disabled={!masterLineId}
                />
              </div>
              <div className="space-y-2">
                <Label>QC</Label>
                <Textarea
                  value={masterLine?.qc_points ?? ""}
                  onChange={(e) =>
                    masterLineId &&
                    updateLine(masterLineId, { qc_points: e.target.value })
                  }
                  rows={5}
                  placeholder="QC points..."
                  disabled={!masterLineId}
                />
              </div>
              <div className="space-y-2">
                <Label>Packing</Label>
                <Textarea
                  value={masterLine?.packing_notes ?? ""}
                  onChange={(e) =>
                    masterLineId &&
                    updateLine(masterLineId, { packing_notes: e.target.value })
                  }
                  rows={5}
                  placeholder="Packing notes..."
                  disabled={!masterLineId}
                />
              </div>
            </div>

            {error ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                {error}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          {/* Left: line list */}
          <Card className="h-full md:col-span-1">
            <CardHeader>
              <CardTitle className="text-base">Styles</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {lines.length === 0 ? (
                <div className="text-sm text-muted-foreground">No lines.</div>
              ) : (
                <div className="space-y-2">
                  {lines.map((l) => {
                    const active = l.id === activeLineId;
                    const thumb =
                      l.image_url_primary || safeArray(l.image_urls)[0] || null;

                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => setActiveLineId(l.id)}
                        className={[
                          "w-full rounded-md border p-2 text-left transition",
                          active
                            ? "border-primary/60 bg-primary/5"
                            : "hover:bg-muted/50",
                        ].join(" ")}
                      >
                        <div className="flex gap-3">
                          <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-md border bg-muted">
                            {thumb ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={thumb}
                                alt={l.jm_style_no}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                                No Image
                              </div>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="truncate font-medium">
                                {l.jm_style_no}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Qty {nnum(l.qty, 0)}
                              </div>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                              {l.plating_color ? (
                                <span className="rounded-full border bg-background px-2 py-0.5">
                                  Plating: {l.plating_color}
                                </span>
                              ) : null}
                              {l.description ? (
                                <span className="truncate">
                                  {String(l.description).slice(0, 50)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Right: line detail */}
          <Card className="h-full md:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">
                {activeLine?.jm_style_no ?? "(select style)"}
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-4">
              {!activeLine ? (
                <div className="text-sm text-muted-foreground">
                  Select a line.
                </div>
              ) : (
                <>
                  <Tabs defaultValue="spec" className="w-full">
                    <TabsList>
                      <TabsTrigger value="spec">Spec</TabsTrigger>
                      <TabsTrigger value="materials">Materials</TabsTrigger>
                      <TabsTrigger value="vendor">Vendor</TabsTrigger>
                    </TabsList>

                    <TabsContent value="spec" className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>JM Style No</Label>
                          <Input value={activeLine.jm_style_no} disabled />
                        </div>
                        <div className="space-y-2">
                          <Label>Buyer Style / SKU</Label>
                          <Input
                            value={activeLine.buyer_style ?? ""}
                            onChange={(e) =>
                              updateLine(activeLine.id, {
                                buyer_style: e.target.value,
                              })
                            }
                            placeholder="Optional"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Description</Label>
                        <Input
                          value={activeLine.description ?? ""}
                          onChange={(e) =>
                            updateLine(activeLine.id, {
                              description: e.target.value,
                            })
                          }
                          placeholder="e.g. 5star bracelet"
                        />
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Qty</Label>
                          <Input
                            value={String(activeLine.qty ?? 0)}
                            onChange={(e) =>
                              updateLine(activeLine.id, {
                                qty: nnum(e.target.value, 0),
                              })
                            }
                            className="text-right"
                            inputMode="numeric"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Plating Color</Label>
                          <Input
                            value={activeLine.plating_color ?? ""}
                            onChange={(e) =>
                              updateLine(activeLine.id, {
                                plating_color: e.target.value,
                              })
                            }
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Plating Spec</Label>
                        <Input
                          value={activeLine.plating_spec ?? ""}
                          onChange={(e) =>
                            updateLine(activeLine.id, {
                              plating_spec: e.target.value,
                            })
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Spec Summary</Label>
                        <Textarea
                          value={activeLine.spec_summary ?? ""}
                          onChange={(e) =>
                            updateLine(activeLine.id, {
                              spec_summary: e.target.value,
                            })
                          }
                          rows={3}
                        />
                      </div>

                      <Separator />
                      <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                        ✅ Work/QC/Packing은 공통 박스로 보이지만, DB 구조상
                        “고정된 1개 라인(masterLineId)”에 저장됩니다.
                        <br />
                        (Save 후에도 masterLineId가 유지되므로 입력값이 사라지지
                        않습니다.)
                      </div>
                    </TabsContent>

                    <TabsContent value="materials" className="space-y-3">
                      <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                        Materials / Operations는{" "}
                        <span className="font-medium text-foreground">
                          Product Development
                        </span>
                        에서 자동으로 가져옵니다. (Work Sheet에서는
                        수정/추가하지 않습니다.)
                      </div>

                      <div className="space-y-2">
                        {(materialsByLineId[activeLine.id] ?? [])
                          .filter((s) => !s.is_deleted)
                          .sort((a, b) => nnum(a.sort_order, 0) - nnum(b.sort_order, 0))
                          .length === 0 ? (
                          <div className="text-sm text-muted-foreground">
                            No material specs found for this style. (Check
                            Product Development)
                          </div>
                        ) : (
                          <div className="overflow-x-auto rounded-md border">
                            <table className="w-full text-sm">
                              <thead className="bg-muted/50">
                                <tr className="text-left">
                                  <th className="p-2">Type</th>
                                  <th className="p-2">Material</th>
                                  <th className="p-2">Spec</th>
                                  <th className="p-2">Color</th>
                                  <th className="p-2">Remarks</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(materialsByLineId[activeLine.id] ?? [])
                                  .filter((s) => !s.is_deleted)
                                  .sort(
                                    (a, b) =>
                                      nnum(a.sort_order, 0) -
                                      nnum(b.sort_order, 0)
                                  )
                                  .map((s) => (
                                    <tr key={s.id} className="border-t">
                                      <td className="p-2">
                                        {s.material_type ?? ""}
                                      </td>
                                      <td className="p-2">
                                        {s.material_name ?? ""}
                                      </td>
                                      <td className="p-2">
                                        {s.spec_text ?? ""}
                                      </td>
                                      <td className="p-2">{s.color ?? ""}</td>
                                      <td className="p-2">{s.note ?? ""}</td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent value="vendor" className="space-y-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="md:col-span-2 space-y-2">
                          <Label>Vendor / Subcontractor</Label>
                          <div className="flex flex-col md:flex-row gap-2">
                            <Input
                              placeholder="Search vendor..."
                              value={vendorSearch}
                              onChange={(e) => setVendorSearch(e.target.value)}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={loadVendors}
                              disabled={vendorsLoading}
                              className="md:w-[140px]"
                            >
                              {vendorsLoading ? "Loading..." : "Refresh"}
                            </Button>
                          </div>

                          <Select
                            value={(activeLine.vendor_id ?? "NONE") as any}
                            onValueChange={(v) => {
                              const val = v === "NONE" ? null : v;
                              updateLine(activeLine.id, { vendor_id: val });
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select vendor" />
                            </SelectTrigger>
                            <SelectContent className="max-h-[340px]">
                              <SelectItem value="NONE">None</SelectItem>
                              {filteredVendors.map((v) => (
                                <SelectItem key={v.id} value={v.id}>
                                  {vendorLabel(v)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          {vendorLoadError ? (
                            <div className="text-xs text-red-600">
                              {vendorLoadError}
                            </div>
                          ) : null}

                          {activeLine.vendor_id &&
                          vendorMap.get(activeLine.vendor_id) ? (
                            <div className="text-xs text-slate-500">
                              Selected:{" "}
                              {vendorLabel(
                                vendorMap.get(activeLine.vendor_id)!
                              )}
                            </div>
                          ) : null}
                        </div>

                        <div className="space-y-2">
                          <Label>Vendor Currency</Label>
                          <Input
                            value={activeLine.vendor_currency ?? ""}
                            onChange={(e) =>
                              updateLine(activeLine.id, {
                                vendor_currency: e.target.value,
                              })
                            }
                            placeholder="CNY / VND / KRW"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Vendor Unit Cost (Local)</Label>
                          <Input
                            value={activeLine.vendor_unit_cost_local ?? ""}
                            onChange={(e) =>
                              updateLine(activeLine.id, {
                                vendor_unit_cost_local: e.target.value as any,
                              })
                            }
                            placeholder="e.g. 12.5"
                            inputMode="decimal"
                          />
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : null}
      </div>
    </AppShell>
  );
}
