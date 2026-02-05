'use client';

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import CompareDiffTab from "./tabs/compare-diff";
import MatrixTab from "./tabs/matrix";

type VersionRow = {
  id: string;
  version_no: number;
  status: string;
  revision_of_version_id: string | null;
  change_summary: string | null;
  updated_at: string;
};

type Quotation = {
  id: string;
  red_quotation_no: string | null;
  title: string | null;
  buyer_name: string | null;
  style_no: string | null;
  ship_from_code: string | null;
  thumbnail_url?: string | null;
  thumbnail_path?: string | null;
  currency: string;
  incoterm: string | null;
  status: string;
};

export default function RedQuotationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [q, setQ] = React.useState<Quotation | null>(null);
  const [versions, setVersions] = React.useState<VersionRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  // A안: Costing 없이 RED Quotation 화면에서 Style No를 즉시 입력/저장
  const [styleNo, setStyleNo] = React.useState<string>("");
  const [savingStyle, setSavingStyle] = React.useState(false);

  const [tab, setTab] = React.useState<"matrix" | "compare">("compare");

  // Costs inputs (used by Matrix/Costs APIs)
  const [unitPrice, setUnitPrice] = React.useState<string>("");
  const [unitCurrency, setUnitCurrency] = React.useState<string>("USD");
  const [packagingCostsByMoq, setPackagingCostsByMoq] = React.useState<Record<number, string>>({});
  const [fobByMoq, setFobByMoq] = React.useState<Record<number, string>>({});
  const [fobCurrency, setFobCurrency] = React.useState<string>("CNY");


  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/red/quotations/${id}/versions`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed");
      setQ(j.data.quotation);
      setVersions(j.data.versions || []);
    } catch (e: any) {
      setErr(e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { load(); }, [id]);

  // 서버에서 헤더 로딩되면 현재 style_no를 편집 UI에 반영
  React.useEffect(() => {
    setStyleNo(q?.style_no || "");
  }, [q?.style_no]);

  const title = q?.red_quotation_no ? `${q.red_quotation_no}` : "RED Quotation";

  async function saveStyleNo() {
    if (!id) return;
    setSavingStyle(true);
    setErr(null);
    try {
      const r = await fetch(`/api/red/quotations/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ style_no: styleNo || null }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Save failed");
      // 헤더 최신화
      setQ((prev) => (prev ? { ...prev, style_no: j?.data?.style_no ?? styleNo } : prev));
    } catch (e: any) {
      setErr(e?.message || "Save failed");
    } finally {
      setSavingStyle(false);
    }
  }

  
  async function loadCosts(versionId: string) {
    try {
      const r = await fetch(`/api/red/quotation-versions/${versionId}/costs?package=A`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed to load costs");

      const ci = j?.data?.cost_inputs || null;
      if (ci) {
        setUnitPrice(ci.unit_price_per_piece ?? "");
        setUnitCurrency(ci.unit_price_currency || "USD");
      }
      const map: Record<number, string> = {};
      for (const row of (j?.data?.packaging_costs || [])) {
        map[Number(row.moq_packages)] = row.packaging_cost_per_pkg == null ? "" : String(row.packaging_cost_per_pkg);
      }
      setPackagingCostsByMoq(map);

      const fmap: Record<number, string> = {};
      for (const row of (j?.data?.fob_prices || [])) {
        fmap[Number(row.moq_packages)] = row.fob_per_pkg == null ? "" : String(row.fob_per_pkg);
        if (row.currency) setFobCurrency(String(row.currency).toUpperCase());
      }
      setFobByMoq(fmap);
    } catch (e: any) {
      // non-fatal
      console.warn(e?.message || e);
    }
  }

  async function saveCosts(versionId: string) {
    const payload = {
      package_code: "A",
      cost_inputs: {
        unit_price_per_piece: unitPrice === "" ? null : Number(unitPrice),
        unit_price_currency: unitCurrency,
      },
      fob_prices: [1000, 3000, 5000].map((moq) => ({
        moq_packages: moq,
        fob_per_pkg: fobByMoq?.[moq] === "" ? null : Number(fobByMoq?.[moq]),
        currency: fobCurrency,
      })),
      packaging_costs: [1000, 3000, 5000].map((moq) => ({
        moq_packages: moq,
        packaging_cost_per_pkg: packagingCostsByMoq?.[moq] === "" ? null : Number(packagingCostsByMoq?.[moq]),
      })),
    };

    const r = await fetch(`/api/red/quotation-versions/${versionId}/costs`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || "Failed to save costs");
  }

return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">RED Quotation</div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <div className="text-sm text-muted-foreground">
            <span>Buyer: <span className="text-foreground">{q?.buyer_name || "-"}</span></span>
            <span className="mx-2">·</span>
            <span className="inline-flex items-center gap-2">
              <span>Style:</span>
              <input
                className="h-8 w-[180px] rounded border bg-background px-2 text-foreground"
                value={styleNo}
                onChange={(e) => setStyleNo(e.target.value)}
                placeholder="Style No"
              />
              <button
                className="h-8 rounded border px-2 text-xs hover:bg-muted disabled:opacity-50"
                onClick={saveStyleNo}
                disabled={savingStyle}
                title="Save Style No"
              >
                {savingStyle ? "Saving..." : "Save"}
              </button>
            </span>
            <span className="mx-2">·</span>
            <span>Ship From: <span className="text-foreground">{q?.ship_from_code || "-"}</span></span>
          </div>
        </div>

        <div className="flex gap-2">
          <button className="border rounded px-3 py-1.5 text-sm hover:bg-muted" onClick={() => router.push("/red/quotations")}>
            Back
          </button>
          <button className="border rounded px-3 py-1.5 text-sm hover:bg-muted" onClick={load} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      {err ? <div className="text-sm text-red-600">{err}</div> : null}

      <div className="border rounded-lg overflow-hidden">
        <div className="flex gap-2 border-b p-2 bg-muted/40">
          <button
            className={`px-3 py-1.5 text-sm rounded ${tab === "matrix" ? "bg-background border" : "hover:bg-muted"}`}
            onClick={() => setTab("matrix")}
          >
            Matrix
          </button>
          <button
            className={`px-3 py-1.5 text-sm rounded ${tab === "compare" ? "bg-background border" : "hover:bg-muted"}`}
            onClick={() => setTab("compare")}
          >
            Compare / Diff
          </button>
        </div>

        <div className="p-4">
          {tab === "matrix" ? (
            <MatrixTab quotationId={id} versions={versions} onChanged={load} />
          ) : (
            <CompareDiffTab quotationId={id} versions={versions} onChanged={load} />
          )}
        </div>
      </div>
    </div>
  );
}
async function resizeImageFile(file: File, maxDim = 800, quality = 0.82): Promise<File> {
  const img = document.createElement("img");
  const url = URL.createObjectURL(file);
  img.src = url;
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("image load failed"));
  });

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const nw = Math.max(1, Math.round(w * scale));
  const nh = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = nw;
  canvas.height = nh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas not supported");
  ctx.drawImage(img, 0, 0, nw, nh);

  const blob: Blob = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b as Blob), "image/jpeg", quality)
  );

  URL.revokeObjectURL(url);
  return new File([blob], "thumbnail.jpg", { type: "image/jpeg" });
}

