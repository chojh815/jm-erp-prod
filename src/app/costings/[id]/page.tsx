"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronDown, ChevronUp } from "lucide-react";

import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { createSupabaseBrowserClient } from "@/lib/supabaseClient";

type BuyerRow = {
  id: string;
  company_name: string;
  company_type: string;
  code?: string | null;
  buyer_brand?: string | null;
};

type CostingHeaderRow = {
  id: string;
  style_no?: string | null;
  status?: string | null;
  stage?: string | null;
  currency?: string | null;
  buyer_id?: string | null;
  buyer_name?: string | null;
  buyer_code?: string | null;
  buyer_brand_name?: string | null;
  fx_cny_per_usd?: number | null;
  target_margin_pct?: number | null;
  offer_usd?: number | null;
  remarks?: string | null;
  updated_at?: string | null;
};

type MaterialLineRow = {
  id?: string;
  row_index: number;
  material_name: string;
  spec?: string | null;
  qty: number | "";
  unit_cost_cny: number | "";
  supplier_name?: string | null;
  note?: string | null;
};

type OperationLineRow = {
  id?: string;
  row_index: number;
  operation_name: string;
  spec?: string | null;
  qty: number | "";
  unit_cost_cny: number | "";
  supplier_name?: string | null;
  note?: string | null;
};

type CostingImageRow = {
  id: string;
  costing_id: string;
  image_url: string;
  storage_path: string;
  sort_order: number;
  is_primary: boolean;
  created_at?: string | null;
};

function n(v: unknown, fallback = 0) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function sortLinesSafe<T extends Record<string, any>>(rows: T[]) {
  // Prefer row_index if present; otherwise created_at; otherwise id
  return [...rows].sort((a, b) => {
    const ai = typeof (a as any).row_index === "number" ? (a as any).row_index : null;
    const bi = typeof (b as any).row_index === "number" ? (b as any).row_index : null;
    if (ai != null && bi != null) return ai - bi;
    const ac = (a as any).created_at ? String((a as any).created_at) : "";
    const bc = (b as any).created_at ? String((b as any).created_at) : "";
    if (ac && bc && ac !== bc) return ac.localeCompare(bc);
    const aid = (a as any).id ? String((a as any).id) : "";
    const bid = (b as any).id ? String((b as any).id) : "";
    return aid.localeCompare(bid);
  });
}

function round4(x: number) {
  return Math.round(x * 10000) / 10000;
}

function round2(x: number) {
  return Math.round(x * 100) / 100;
}

function fmtMoney(x: number) {
  if (!Number.isFinite(x)) return "-";
  return x.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function splitCsv(s?: string | null): string[] {
  if (!s) return [];
  return s
    .split(/[,\n]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

export default function CostingDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id as string;

  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [buyers, setBuyers] = React.useState<BuyerRow[]>([]);

  const [header, setHeader] = React.useState<CostingHeaderRow>({ id });
  const [priceDriver, setPriceDriver] = React.useState<"MARGIN" | "OFFER">("MARGIN");
  const [materials, setMaterials] = React.useState<MaterialLineRow[]>([]);
  const [operations, setOperations] = React.useState<OperationLineRow[]>([]);

  // Images (max 3)
  // Supabase Storage bucket name (case-sensitive)
  // Default: "costing-images" (override via NEXT_PUBLIC_COSTING_IMAGES_BUCKET)
  const BUCKET = (process.env.NEXT_PUBLIC_COSTING_IMAGES_BUCKET || "costing-images").trim();
  const [images, setImages] = React.useState<CostingImageRow[]>([]);
  const [imgBusy, setImgBusy] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [imagesOpen, setImagesOpen] = React.useState(true);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);


  // Derived totals
  const materialTotalCny = React.useMemo(
    () => materials.reduce((s, r) => s + n(r.qty) * n(r.unit_cost_cny), 0),
    [materials]
  );
  const operationTotalCny = React.useMemo(
    () => operations.reduce((s, r) => s + n(r.qty) * n(r.unit_cost_cny), 0),
    [operations]
  );
  const totalCny = materialTotalCny + operationTotalCny;

  const fx = n(header.fx_cny_per_usd, 0);
  const totalUsd = fx > 0 ? totalCny / fx : 0;

  const marginPct = n(header.target_margin_pct, 0);
  const offerUsdByMargin = React.useMemo(() => {
    const m = marginPct / 100;
    if (!(m >= 0 && m < 1)) return 0;
    if (totalUsd <= 0) return 0;
    return totalUsd / (1 - m);
  }, [marginPct, totalUsd]);


// Keep offer_usd and target_margin_pct in sync (A안: last-edited wins)
React.useEffect(() => {
  const offer = n(header.offer_usd, 0);
  const margin = n(header.target_margin_pct, 0);
  const total = totalUsd;

  // Nothing to do if no cost yet
  if (!(total > 0)) return;

  // Guard bounds
  const m01 = Math.max(0, Math.min(99.99, margin)) / 100;

  if (priceDriver === "MARGIN") {
    // margin -> offer
    const nextOffer = m01 < 1 ? total / (1 - m01) : 0;
    if (nextOffer > 0) {
      const rounded = round4(nextOffer);
      if (Math.abs(rounded - offer) > 1e-6) {
        setHeader((h) => ({ ...h, offer_usd: rounded }));
      }
    }
    return;
  }

  // OFFER driver: offer -> margin
  if (offer > 0) {
    const nextMargin = (1 - total / offer) * 100;
    const clamped = Math.max(0, Math.min(99.99, nextMargin));
    const rounded = round2(clamped);
    if (Math.abs(rounded - margin) > 1e-6) {
      setHeader((h) => ({ ...h, target_margin_pct: rounded }));
    }
  }
}, [priceDriver, header.offer_usd, header.target_margin_pct, totalUsd]);


  const offerUsd = n(header.offer_usd, 0);
  const offerCny = fx > 0 ? offerUsd * fx : 0;
  const impliedMarginPct = React.useMemo(() => {
    if (offerUsd <= 0) return 0;
    if (totalUsd <= 0) return 0;
    const m = 1 - totalUsd / offerUsd;
    return Math.max(0, Math.min(0.9999, m)) * 100;
  }, [offerUsd, totalUsd]);

  const buyerBrands = React.useMemo(() => {
    const b = buyers.find((x) => x.id === header.buyer_id);
    return splitCsv(b?.buyer_brand);
  }, [buyers, header.buyer_id]);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      // Buyers
      const { data: buyerRows, error: bErr } = await supabase
        .from("companies")
        .select("id, company_name, company_type, code, buyer_brand")
        .eq("company_type", "buyer")
        .order("company_name", { ascending: true });
      if (bErr) throw bErr;
      setBuyers((buyerRows ?? []) as BuyerRow[]);

      // Header
      const { data: h, error: hErr } = await supabase
        .from("costing_headers")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (hErr) throw hErr;

      const nextHeader: CostingHeaderRow = {
        id,
        ...(h ?? {}),
      };
      // Default base currency is CNY for costing input (as requested)
      if (!nextHeader.currency) nextHeader.currency = "CNY";
      setHeader(nextHeader);

      // Lines: try common fk names (costing_id/header_id)
      const { data: m1, error: mErr } = await supabase
        .from("costing_material_lines")
        .select("*")
        .eq("costing_id", id)
        ;
      if (mErr) throw mErr;

      const matsRaw: MaterialLineRow[] = (m1 ?? [])
        .filter((r: any) => !(r?.is_deleted === true) && !r?.deleted_at)
        .map((r: any, idx: number) => ({
  id: r.id,
  row_index: typeof r.row_index === "number" ? r.row_index : idx + 1,
  material_name: r.material_name ?? r.name ?? "",
  spec: r.spec ?? r.spec_description ?? null,
  qty: n(r.qty, 1),
  unit_cost_cny: n(r.unit_cost_cny ?? r.unit_cost ?? r.unit_price, 0),
  supplier_name: r.supplier_name ?? r.vendor_name ?? null,
  note: r.note ?? r.remarks ?? null,
}));
const mats: MaterialLineRow[] = sortLinesSafe(matsRaw);

const { data: o1, error: oErr } = await supabase
        .from("costing_operation_lines")
        .select("*")
        .eq("costing_id", id)
        ;
      if (oErr) throw oErr;

      const opsRaw: OperationLineRow[] = (o1 ?? [])
        .filter((r: any) => !(r?.is_deleted === true) && !r?.deleted_at)
        .map((r: any, idx: number) => ({
  id: r.id,
  row_index: typeof r.row_index === "number" ? r.row_index : idx + 1,
  operation_name: r.operation_name ?? r.name ?? "",
  spec: r.spec ?? r.spec_description ?? null,
  qty: n(r.qty, 1),
  unit_cost_cny: n(r.unit_cost_cny ?? r.unit_cost ?? r.unit_price, 0),
  supplier_name: r.supplier_name ?? r.vendor_name ?? null,
  note: r.note ?? r.remarks ?? null,
}));
const ops: OperationLineRow[] = sortLinesSafe(opsRaw);

setMaterials(mats.length ? mats : [{ row_index: 1, material_name: "", qty: 1, unit_cost_cny: 0 }]);
      setOperations(ops.length ? ops : [{ row_index: 1, operation_name: "", qty: 1, unit_cost_cny: 0 }]);

      // Images (max 3)
      const { data: imgRows, error: imgErr } = await supabase
        .from("costing_images")
        .select("*")
        .eq("costing_id", id)
        .order("sort_order", { ascending: true });
      if (imgErr) throw imgErr;
      setImages(((imgRows ?? []) as any[]).map((r) => ({
        id: String(r.id),
        costing_id: String(r.costing_id),
        image_url: String(r.image_url),
        storage_path: String(r.storage_path),
        sort_order: typeof r.sort_order === "number" ? r.sort_order : 0,
        is_primary: !!r.is_primary,
        created_at: r.created_at ?? null,
      })));

    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (!id) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function setBuyer(buyerId: string) {
    const b = buyers.find((x) => x.id === buyerId);
    setHeader((h) => ({
      ...h,
      buyer_id: buyerId,
      buyer_name: b?.company_name ?? null,
      buyer_code: b?.code ?? null,
      buyer_brand_name: null,
    }));
  }

  async function saveAll() {
    if (!window.confirm("Do you want to save this costing? Existing material and operation lines will be overwritten.")) return;
    setSaving(true);
    setError(null);
    try {
      // 1) Header upsert
      const headerPayload: any = {
        ...header,
        id,
        currency: header.currency ?? "CNY",
        fx_cny_per_usd: fx > 0 ? fx : null,
        target_margin_pct: n(header.target_margin_pct, 0),
        offer_usd: offerUsd > 0 ? offerUsd : null,
        updated_at: new Date().toISOString(),
      };

      const { error: upErr } = await supabase
        .from("costing_headers")
        .upsert(headerPayload, { onConflict: "id" });
      if (upErr) throw upErr;

      // 2) Replace lines.
      // 현재 DB에서 is_deleted 같은 소프트삭제 컬럼이 없을 수 있어요.
      // 그래서 A안은 **hard delete + insert**로 처리해서 (1) 중복 저장 (2) 스키마 캐시 에러를 같이 줄입니다.

      // Materials
      {
        const { error: delErr } = await supabase.from("costing_material_lines").delete().eq("costing_id", id);
        if (delErr) throw delErr;

        const matRows = materials
          .map((r) => ({
            costing_id: id,
            material_name: r.material_name?.trim() ?? "",
            spec: r.spec ?? null,
            qty: n(r.qty, 1),
            unit_cost_cny: n(r.unit_cost_cny, 0),
            supplier_name: r.supplier_name ?? null,
            note: r.note ?? null,
          }))
          .filter((r) => r.material_name);

        if (matRows.length) {
          const { error: miErr } = await supabase.from("costing_material_lines").insert(matRows);
          if (miErr) throw miErr;
        }
      }

      // Operations
      {
        const { error: delErr } = await supabase.from("costing_operation_lines").delete().eq("costing_id", id);
        if (delErr) throw delErr;

        const opRows = operations
          .map((r) => ({
            costing_id: id,
            operation_name: r.operation_name?.trim() ?? "",
            spec: r.spec ?? null,
            qty: n(r.qty, 1),
            unit_cost_cny: n(r.unit_cost_cny, 0),
            supplier_name: r.supplier_name ?? null,
            note: r.note ?? null,
          }))
          .filter((r) => r.operation_name);

        if (opRows.length) {
          const { error: oiErr } = await supabase.from("costing_operation_lines").insert(opRows);
          if (oiErr) throw oiErr;
        }
      }

      // reload for clean ids/order
      await loadAll();
      alert("Saved.");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  function addMaterial() {
    setMaterials((rows) => [...rows, { row_index: rows.length + 1, material_name: "", qty: 1, unit_cost_cny: 0 }]);
  }
  function addOperation() {
    setOperations((rows) => [...rows, { row_index: rows.length + 1, operation_name: "", qty: 1, unit_cost_cny: 0 }]);
  }

  function removeMaterial(rowIndex: number) {
    setMaterials((rows) => {
      const next = rows.filter((_, i) => i !== rowIndex);
      const normalized = next.length
        ? next.map((r, i) => ({ ...r, row_index: i + 1 }))
        : [{ row_index: 1, material_name: "", qty: 1, unit_cost_cny: 0 }];
      return normalized;
    });
  }

  function removeOperation(rowIndex: number) {
    setOperations((rows) => {
      const next = rows.filter((_, i) => i !== rowIndex);
      const normalized = next.length
        ? next.map((r, i) => ({ ...r, row_index: i + 1 }))
        : [{ row_index: 1, operation_name: "", qty: 1, unit_cost_cny: 0 }];
      return normalized;
    });
  }

  async function fileToWebpBlob(file: File, maxSide = 1600, quality = 0.82): Promise<Blob> {
    // Browser-only resize + compress to webp
    const img = document.createElement("img");
    const url = URL.createObjectURL(file);
    try {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = (e) => reject(e);
        img.src = url;
      });

      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;

      let tw = w;
      let th = h;
      const longest = Math.max(w, h);
      if (longest > maxSide) {
        const scale = maxSide / longest;
        tw = Math.round(w * scale);
        th = Math.round(h * scale);
      }

      const canvas = document.createElement("canvas");
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas not supported");
      ctx.drawImage(img, 0, 0, tw, th);

      const blob: Blob = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b as Blob), "image/webp", quality)
      );
      return blob;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function friendlyUploadError(e: any) {
    const msg = (e?.message ?? String(e) ?? "").toString();
    // Supabase Storage common message when bucket name is wrong or missing
    if (/bucket not found/i.test(msg)) {
      return `Bucket not found: "${BUCKET}". Please create this bucket in Supabase Storage (Buckets → New bucket) or set NEXT_PUBLIC_COSTING_IMAGES_BUCKET to your bucket name.`;
    }
    // Some projects run buckets as private; public URL will be empty
    if (/public url/i.test(msg) || /is bucket public/i.test(msg)) {
      return `Failed to get a public URL. If your bucket is private, either make bucket public or switch to signed URL approach.`;
    }
    return msg;
  }

  async function refreshImages() {
    const { data: imgRows, error: imgErr } = await supabase
      .from("costing_images")
      .select("*")
      .eq("costing_id", id)
      .order("sort_order", { ascending: true });
    if (imgErr) throw imgErr;
    setImages(((imgRows ?? []) as any[]).map((r) => ({
      id: String(r.id),
      costing_id: String(r.costing_id),
      image_url: String(r.image_url),
      storage_path: String(r.storage_path),
      sort_order: typeof r.sort_order === "number" ? r.sort_order : 0,
      is_primary: !!r.is_primary,
      created_at: r.created_at ?? null,
    })));
  }

  async function onPickImages(files: FileList | null) {
    if (!files || !files.length) return;
    if (imgBusy) return;

    const remain = Math.max(0, 3 - images.length);
    if (remain <= 0) {
      setError("You can upload up to 3 images.");
      return;
    }

    const picked = Array.from(files).slice(0, remain);
    setImgBusy(true);
    setError(null);
    try {
      for (let i = 0; i < picked.length; i++) {
        const f = picked[i];
        const blob = await fileToWebpBlob(f, 1600, 0.82);
        const safeName = (f.name || "image").replace(/[^a-zA-Z0-9._-]+/g, "_");
        const path = `costings/${id}/${Date.now()}_${i}_${safeName}.webp`;

        const up = await supabase.storage.from(BUCKET).upload(path, blob, {
          contentType: "image/webp",
          upsert: false,
        });
        if (up.error) throw up.error;

        const pub = supabase.storage.from(BUCKET).getPublicUrl(path);
        const publicUrl = pub?.data?.publicUrl;
        if (!publicUrl) throw new Error("Failed to get public URL (is bucket public?)");

        const nextOrder = images.length + i;
        const isPrimary = images.length === 0 && i === 0;

        const { error: insErr } = await supabase.from("costing_images").insert({
          costing_id: id,
          image_url: publicUrl,
          storage_path: path,
          sort_order: nextOrder,
          is_primary: isPrimary,
        });
        if (insErr) throw insErr;
      }

      // Ensure exactly one primary if we added images to empty set
      await refreshImages();
      const hasPrimary = images.some((x) => x.is_primary);
      if (!hasPrimary) {
        const first = images[0];
        if (first) await setPrimary(first.id);
      }
    } catch (e: any) {
      setError(friendlyUploadError(e));
    } finally {
      setImgBusy(false);
      // reset input value by re-render; we do it in JSX with key below
    }
  }

  async function setPrimary(imageId: string) {
    if (imgBusy) return;
    setImgBusy(true);
    setError(null);
    try {
      const { error: clrErr } = await supabase
        .from("costing_images")
        .update({ is_primary: false })
        .eq("costing_id", id);
      if (clrErr) throw clrErr;

      const { error: setErr } = await supabase.from("costing_images").update({ is_primary: true }).eq("id", imageId);
      if (setErr) throw setErr;

      await refreshImages();
    } catch (e: any) {
      setError(friendlyUploadError(e));
    } finally {
      setImgBusy(false);
    }
  }

  async function deleteImage(imageId: string) {
    if (imgBusy) return;
    const row = images.find((x) => x.id === imageId);
    if (!row) return;
    if (!window.confirm("Do you want to delete this image?")) return;

    setImgBusy(true);
    setError(null);
    try {
      // delete db row first
      const { error: delErr } = await supabase.from("costing_images").delete().eq("id", imageId);
      if (delErr) throw delErr;

      // delete storage object (ignore if fails)
      await supabase.storage.from(BUCKET).remove([row.storage_path]);

      // re-pack sort_order 0..n-1
      const { data: left, error: qErr } = await supabase
        .from("costing_images")
        .select("id, sort_order, is_primary")
        .eq("costing_id", id)
        .order("sort_order", { ascending: true });
      if (qErr) throw qErr;

      const rows = (left ?? []) as any[];
      for (let i = 0; i < rows.length; i++) {
        const rid = rows[i].id;
        const { error: uErr } = await supabase.from("costing_images").update({ sort_order: i }).eq("id", rid);
        if (uErr) throw uErr;
      }

      // ensure primary exists
      const anyPrimary = rows.some((r) => !!r.is_primary);
      if (!anyPrimary && rows.length) {
        const { error: spErr } = await supabase.from("costing_images").update({ is_primary: true }).eq("id", rows[0].id);
        if (spErr) throw spErr;
      }

      await refreshImages();
      alert("Deleted.");
    } catch (e: any) {
      setError(friendlyUploadError(e));
    } finally {
      setImgBusy(false);
    }
  }

  async function moveImage(imageId: string, dir: -1 | 1) {
    if (imgBusy) return;
    const idx = images.findIndex((x) => x.id === imageId);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= images.length) return;

    const a = images[idx];
    const b = images[j];

    setImgBusy(true);
    setError(null);
    try {
      const { error: aErr } = await supabase.from("costing_images").update({ sort_order: b.sort_order }).eq("id", a.id);
      if (aErr) throw aErr;
      const { error: bErr } = await supabase.from("costing_images").update({ sort_order: a.sort_order }).eq("id", b.id);
      if (bErr) throw bErr;

      await refreshImages();
    } catch (e: any) {
      setError(friendlyUploadError(e));
    } finally {
      setImgBusy(false);
    }
  }


  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-4 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <div className="text-2xl font-semibold">Costing</div>
            <div className="text-sm text-muted-foreground">ID: {id}</div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.back()}>
              Back
            </Button>
            <Button variant="outline" onClick={() => loadAll()} disabled={loading || saving}>
              Refresh
            </Button>
            <Button onClick={() => saveAll()} disabled={loading || saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>

        {error ? (
          <div className="border border-red-300 bg-red-50 text-red-700 rounded-md p-3 text-sm">{error}</div>
        ) : null}




<Card>
          <CardHeader>
            <CardTitle>Header</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <Label>Status</Label>
              <Input
                value={header.status ?? "DRAFT"}
                onChange={(e) => setHeader((h) => ({ ...h, status: e.target.value }))}
              />
            </div>

            <div className="space-y-1">
              <Label>Stage</Label>
              <Input
                value={header.stage ?? "SAMPLE"}
                onChange={(e) => setHeader((h) => ({ ...h, stage: e.target.value }))}
              />
            </div>

            <div className="space-y-1">
              <Label>Style No</Label>
              <Input
                value={header.style_no ?? ""}
                onChange={(e) => setHeader((h) => ({ ...h, style_no: e.target.value }))}
                placeholder="e.g. JK260001"
              />
            </div>

            <div className="space-y-1">
              <Label>Base Currency</Label>
              <Input value={header.currency ?? "CNY"} readOnly />
            </div>

            <div className="space-y-1 md:col-span-2">
              <Label>Buyer</Label>
              <Select value={header.buyer_id ?? ""} onValueChange={(v) => setBuyer(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select buyer..." />
                </SelectTrigger>
                <SelectContent>
                  {buyers.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.company_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 md:col-span-2">
              <Label>Brand</Label>
              <Select
                value={header.buyer_brand_name ?? ""}
                onValueChange={(v) => setHeader((h) => ({ ...h, buyer_brand_name: v }))}
                disabled={!header.buyer_id}
              >
                <SelectTrigger>
                  <SelectValue placeholder={header.buyer_id ? "Select brand..." : "Select buyer first..."} />
                </SelectTrigger>
                <SelectContent>
                  {buyerBrands.length ? (
                    buyerBrands.map((x) => (
                      <SelectItem key={x} value={x}>
                        {x}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="__none" disabled>
                      (No brands)
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>FX (CNY per USD)</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={header.fx_cny_per_usd ?? ""}
                onChange={(e) => setHeader((h) => ({ ...h, fx_cny_per_usd: e.target.value === "" ? null : Number(e.target.value) }))}
                placeholder="e.g. 7.20"
              />
            </div>

            <div className="space-y-1">
              <Label>Target Margin %</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={header.target_margin_pct ?? ""}
                onChange={(e) => {
                  setPriceDriver("MARGIN");
                  setHeader((h) => ({ ...h, target_margin_pct: e.target.value === "" ? null : Number(e.target.value) }));
                }}
                placeholder="e.g. 30"
              />
              <div className="text-xs text-muted-foreground">Implied from Offer: {fmtMoney(impliedMarginPct)}%</div>
            </div>

            <div className="space-y-1">
              <Label>Offer (USD)</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={header.offer_usd ?? ""}
                onChange={(e) => {
                  setPriceDriver("OFFER");
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  setHeader((h) => ({ ...h, offer_usd: v }));
                }}
                placeholder="Calculated from margin"
              />
              <div className="text-xs text-muted-foreground">Offer (CNY): {fmtMoney(offerCny)}</div>
            </div>

            <div className="space-y-1 md:col-span-4">
              <Label>Remarks</Label>
              <Textarea
                value={header.remarks ?? ""}
                onChange={(e) => setHeader((h) => ({ ...h, remarks: e.target.value }))}
                placeholder="Notes / assumptions, etc."
              />
            </div>
              </div>

            <div className="order-last xl:order-none xl:sticky xl:top-4 self-start">
              <div className="border rounded-lg">
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="font-medium">Images</div>
                    <div className="text-xs text-muted-foreground">{images.length ? `${images.length}/3` : "0/3"}</div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={imgBusy || images.length >= 3}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {imgBusy ? "Uploading..." : "Upload"}
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setImagesOpen((v) => !v)}
                    >
                      {imagesOpen ? (
                        <span className="inline-flex items-center gap-1">
                          <ChevronUp className="h-4 w-4" />
                          Hide
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <ChevronDown className="h-4 w-4" />
                          Show
                        </span>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Hidden file input (opened via ref click) */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={imgBusy || images.length >= 3}
                  onChange={(e) => {
                    onPickImages(e.target.files);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="hidden"
                />

                {imagesOpen ? (
                  <div className="px-3 pb-3">
                    <div className="text-xs text-muted-foreground mb-2">
                      Click an image to preview. Primary image will be used for Quotation/PDF.
                    </div>

                    {images.length ? (
                      <div className="grid grid-cols-2 gap-2">
                        {images
                          .slice()
                          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                          .map((img) => (
                            <div key={img.id} className="border rounded-md p-2">
                              <div className="w-full aspect-square bg-muted rounded-md overflow-hidden">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={img.image_url}
                                  alt="costing"
                                  className="w-full h-full object-cover cursor-zoom-in"
                                  onClick={() => setPreviewUrl(img.image_url)}
                                />
                              </div>

                              <div className="mt-2 flex items-center justify-between gap-1">
                                <Button
                                  size="sm"
                                  className="h-7 px-2 text-xs"
                                  variant={img.is_primary ? "default" : "outline"}
                                  onClick={() => setPrimary(img.id)}
                                  disabled={imgBusy}
                                >
                                  {img.is_primary ? "Primary" : "Set"}
                                </Button>

                                <div className="flex items-center gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 w-7 px-0"
                                    onClick={() => moveImage(img.id, -1)}
                                    disabled={imgBusy || (img.sort_order ?? 0) === 0}
                                    title="Move left"
                                  >
                                    ←
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 w-7 px-0"
                                    onClick={() => moveImage(img.id, 1)}
                                    disabled={imgBusy || (img.sort_order ?? 0) === images.length - 1}
                                    title="Move right"
                                  >
                                    →
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    className="h-7 w-7 px-0"
                                    onClick={() => deleteImage(img.id)}
                                    disabled={imgBusy}
                                    title="Delete"
                                  >
                                    ×
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground border rounded-md p-3">
                        No images yet. Click <b>Upload</b> to add (max 3).
                      </div>
                    )}

                    <Dialog open={!!previewUrl} onOpenChange={(o) => (!o ? setPreviewUrl(null) : null)}>
                      <DialogContent className="max-w-[85vw]">
                        <div className="w-full max-h-[80vh] overflow-auto">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={previewUrl || ""} alt="Preview" className="w-full h-auto rounded-md" />
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                ) : null}
              </div>
            </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Totals (CNY base → USD for quotation)</CardTitle>
              <div className="text-sm text-muted-foreground">USD conversion uses FX (CNY per USD)</div>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="rounded-md border p-3">
              <div className="text-sm text-muted-foreground">Material Total (CNY)</div>
              <div className="text-xl font-semibold">{fmtMoney(materialTotalCny)}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-sm text-muted-foreground">Labor/Other Total (CNY)</div>
              <div className="text-xl font-semibold">{fmtMoney(operationTotalCny)}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-sm text-muted-foreground">Total Cost (CNY)</div>
              <div className="text-xl font-semibold">{fmtMoney(totalCny)}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-sm text-muted-foreground">Total Cost (USD)</div>
              <div className="text-xl font-semibold">{fmtMoney(totalUsd)}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Material (CNY)</CardTitle>
              <Button variant="outline" onClick={addMaterial}>
                + Add
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">#</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead>Spec</TableHead>
                  <TableHead className="w-[90px] text-right">Qty</TableHead>
                  <TableHead className="w-[140px] text-right">Unit (CNY)</TableHead>
                  <TableHead className="w-[160px]">Supplier</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="w-[56px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {materials.map((r, idx) => (
                  <TableRow key={idx}>
                    <TableCell>{idx + 1}</TableCell>
                    <TableCell>
                      <Input
                        value={r.material_name}
                        onChange={(e) =>
                          setMaterials((rows) => {
                            const next = [...rows];
                            next[idx] = { ...next[idx], material_name: e.target.value };
                            return next;
                          })
                        }
                        placeholder="e.g. brass chain"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={r.spec ?? ""}
                        onChange={(e) =>
                          setMaterials((rows) => {
                            const next = [...rows];
                            next[idx] = { ...next[idx], spec: e.target.value };
                            return next;
                          })
                        }
                        placeholder="spec / plating / size"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={r.qty}
                        onChange={(e) =>
                          setMaterials((rows) => {
                            const next = [...rows];
                            const v = e.target.value;
                            next[idx] = { ...next[idx], qty: v === "" ? "" : Number(v) };
                            return next;
                          })
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={r.unit_cost_cny}
                        onChange={(e) =>
                          setMaterials((rows) => {
                            const next = [...rows];
                            const v = e.target.value;
                            next[idx] = { ...next[idx], unit_cost_cny: v === "" ? "" : Number(v) };
                            return next;
                          })
                        }
                      />
                      <div className="text-xs text-muted-foreground text-right">
                        Line: {fmtMoney(n(r.qty) * n(r.unit_cost_cny))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Input
                        value={r.supplier_name ?? ""}
                        onChange={(e) =>
                          setMaterials((rows) => {
                            const next = [...rows];
                            next[idx] = { ...next[idx], supplier_name: e.target.value };
                            return next;
                          })
                        }
                        placeholder="supplier"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={r.note ?? ""}
                        onChange={(e) =>
                          setMaterials((rows) => {
                            const next = [...rows];
                            next[idx] = { ...next[idx], note: e.target.value };
                            return next;
                          })
                        }
                        placeholder="note"
                      />
                    </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                        onClick={() => removeMaterial(idx)}
                      title="Remove"
                    >
                      Remove
                    </Button>
                  </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Labor / Processing / Packing / Other (CNY)</CardTitle>
              <Button variant="outline" onClick={addOperation}>
                + Add
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground mb-2">
              임가공/포장/기타비용도 여기서 “라인”으로 입력하세요. (qty=1로 고정하면 그냥 금액 항목처럼 쓸 수 있어요)
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">#</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Spec</TableHead>
                  <TableHead className="w-[90px] text-right">Qty</TableHead>
                  <TableHead className="w-[140px] text-right">Unit (CNY)</TableHead>
                  <TableHead className="w-[160px]">Vendor</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="w-[56px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {operations.map((r, idx) => (
                  <TableRow key={idx}>
                    <TableCell>{idx + 1}</TableCell>
                    <TableCell>
                      <Input
                        value={r.operation_name}
                        onChange={(e) =>
                          setOperations((rows) => {
                            const next = [...rows];
                            next[idx] = { ...next[idx], operation_name: e.target.value };
                            return next;
                          })
                        }
                        placeholder="e.g. plating / assembly / packing"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={r.spec ?? ""}
                        onChange={(e) =>
                          setOperations((rows) => {
                            const next = [...rows];
                            next[idx] = { ...next[idx], spec: e.target.value };
                            return next;
                          })
                        }
                        placeholder="spec"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={r.qty}
                        onChange={(e) =>
                          setOperations((rows) => {
                            const next = [...rows];
                            const v = e.target.value;
                            next[idx] = { ...next[idx], qty: v === "" ? "" : Number(v) };
                            return next;
                          })
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={r.unit_cost_cny}
                        onChange={(e) =>
                          setOperations((rows) => {
                            const next = [...rows];
                            const v = e.target.value;
                            next[idx] = { ...next[idx], unit_cost_cny: v === "" ? "" : Number(v) };
                            return next;
                          })
                        }
                      />
                      <div className="text-xs text-muted-foreground text-right">
                        Line: {fmtMoney(n(r.qty) * n(r.unit_cost_cny))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Input
                        value={r.supplier_name ?? ""}
                        onChange={(e) =>
                          setOperations((rows) => {
                            const next = [...rows];
                            next[idx] = { ...next[idx], supplier_name: e.target.value };
                            return next;
                          })
                        }
                        placeholder="vendor"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={r.note ?? ""}
                        onChange={(e) =>
                          setOperations((rows) => {
                            const next = [...rows];
                            next[idx] = { ...next[idx], note: e.target.value };
                            return next;
                          })
                        }
                        placeholder="note"
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeOperation(idx)}
                        title="Remove"
                      >
                        ×
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Process (정리)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm leading-6">
            <div>
              <b>Costing</b> = 바이어 견적(Quotation) 내기 위한 “계산기 + 근거 데이터”.
              <br />
              원가를 <b>CNY 기준</b>으로 입력하고, FX로 <b>USD 환산</b>하여 Offer(USD)와 Margin을 계산합니다.
            </div>
            <div>
              <b>Quotation</b> = 바이어에게 보내는 “스냅샷/버전”.
              <br />
              Costing이 바뀌어도 과거에 보낸 Quotation이 흔들리면 안 되니까, Quotation은 Costing의 특정 시점 값을 복사해 저장하는 구조가 맞습니다.
            </div>
            <div>
              <b>Product Registration (정본)</b> = 오더 확정된 제품의 확정 원가/스펙.
              <br />
              나중에 “Costing → Product Registration” 복사(승격) 기능을 넣어서, 확정된 것만 정본으로 남기고 PO/WS는 정본을 기준으로 진행.
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
