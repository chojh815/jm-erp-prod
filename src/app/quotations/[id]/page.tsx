"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";

type AnyRow = Record<string, any>;

function safeText(v: any) {
  if (v === null || v === undefined) return "";
  return String(v);
}

function fmtDate(v: any) {
  const s = safeText(v);
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toISOString().slice(0, 10);
}

function fmtMoney(v: any, decimals = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export default function QuotationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id as string;

  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [header, setHeader] = React.useState<AnyRow | null>(null);
  const [lines, setLines] = React.useState<AnyRow[]>([]);
  const [variants, setVariants] = React.useState<AnyRow[]>([]);
  const [variantLines, setVariantLines] = React.useState<AnyRow[]>([]);

  async function load() {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [hRes, lRes, vRes, vlRes] = await Promise.all([
        fetch(`/api/quotations/${id}`, { cache: "no-store" }),
        fetch(`/api/quotations/${id}/lines`, { cache: "no-store" }),
        fetch(`/api/quotations/${id}/variants`, { cache: "no-store" }),
        fetch(`/api/quotations/${id}/variant-lines`, { cache: "no-store" }),
      ]);

      const [hJson, lJson, vJson, vlJson] = await Promise.all([
        safeJson(hRes),
        safeJson(lRes),
        safeJson(vRes),
        safeJson(vlRes),
      ]);

      if (!hRes.ok) throw new Error(hJson?.error || hJson?.message || `Header load failed (${hRes.status})`);
      if (!lRes.ok) throw new Error(lJson?.error || lJson?.message || `Lines load failed (${lRes.status})`);
      if (!vRes.ok) throw new Error(vJson?.error || vJson?.message || `Variants load failed (${vRes.status})`);
      if (!vlRes.ok) throw new Error(vlJson?.error || vlJson?.message || `Variant lines load failed (${vlRes.status})`);

      setHeader(hJson?.data || hJson?.row || hJson?.header || hJson || null);
      setLines(lJson?.rows || lJson?.data || []);
      setVariants(vJson?.rows || vJson?.data || []);
      setVariantLines(vlJson?.rows || vlJson?.data || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load quotation");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function saveHeader() {
    if (!id || !header) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/quotations/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(header),
      });
      const j = await safeJson(res);
      if (!res.ok) throw new Error(j?.error || j?.message || `Save failed (${res.status})`);
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to save quotation");
    } finally {
      setSaving(false);
    }
  }

  const lineById = React.useMemo(() => {
    const map = new Map<string, AnyRow>();
    for (const ln of lines) {
      if (ln?.id) map.set(String(ln.id), ln);
    }
    return map;
  }, [lines]);

  const groupedVariants = React.useMemo(() => {
    return (variants || []).map((v) => {
      const rows = (variantLines || []).filter(
        (x) => String(x?.quotation_variant_id || "") === String(v?.id || "")
      );
      const total = rows.reduce((sum, r) => {
        const qty = Number(r?.qty || 0);
        const offer = Number(r?.offer_price || 0);
        return sum + (Number.isFinite(qty) ? qty : 0) * (Number.isFinite(offer) ? offer : 0);
      }, 0);
      return { variant: v, rows, total };
    });
  }, [variants, variantLines]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs text-muted-foreground">Quotation</div>
          <div className="text-3xl font-semibold">
            {safeText(
              header?.quotation_no ||
              header?.quote_no ||
              header?.subject ||
              "Quotation"
            )}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            ID: {id}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="px-3 py-2 rounded-md border text-sm"
            onClick={() => router.push("/quotations")}
          >
            Back
          </button>

          <button
            className="px-3 py-2 rounded-md border text-sm"
            onClick={() => load()}
            disabled={loading || saving}
          >
            Refresh
          </button>

          <button
            className="px-3 py-2 rounded-md border text-sm"
            onClick={() => router.push(`/quotations/${id}/pdf`)}
          >
            PDF
          </button>

          <button
            className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold disabled:opacity-60"
            onClick={() => saveHeader()}
            disabled={loading || saving}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm">
          {error}
        </div>
      ) : null}

      <div className="rounded-xl border bg-white p-4">
        <div className="text-lg font-semibold mb-3">Header</div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Status</div>
            <input
              className="w-full h-10 rounded-md border px-3"
              value={safeText(header?.status || "DRAFT")}
              onChange={(e) => setHeader((h) => ({ ...(h || {}), status: e.target.value }))}
            />
          </div>

          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Quotation No</div>
            <input
              className="w-full h-10 rounded-md border px-3"
              value={safeText(header?.quotation_no || header?.quote_no)}
              onChange={(e) => setHeader((h) => ({ ...(h || {}), quotation_no: e.target.value }))}
            />
          </div>

          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Buyer</div>
            <input
              className="w-full h-10 rounded-md border px-3"
              value={safeText(header?.buyer_name || header?.buyer)}
              onChange={(e) => setHeader((h) => ({ ...(h || {}), buyer_name: e.target.value }))}
            />
          </div>

          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Brand</div>
            <input
              className="w-full h-10 rounded-md border px-3"
              value={safeText(header?.brand_name || header?.brand || header?.buyer_brand_name)}
              onChange={(e) => setHeader((h) => ({ ...(h || {}), brand_name: e.target.value }))}
            />
          </div>

          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Style No</div>
            <input
              className="w-full h-10 rounded-md border px-3"
              value={safeText(header?.style_no)}
              onChange={(e) => setHeader((h) => ({ ...(h || {}), style_no: e.target.value }))}
            />
          </div>

          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Currency</div>
            <input
              className="w-full h-10 rounded-md border px-3"
              value={safeText(header?.currency || "USD")}
              onChange={(e) => setHeader((h) => ({ ...(h || {}), currency: e.target.value }))}
            />
          </div>

          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Incoterm</div>
            <input
              className="w-full h-10 rounded-md border px-3"
              value={safeText(header?.incoterm)}
              onChange={(e) => setHeader((h) => ({ ...(h || {}), incoterm: e.target.value }))}
            />
          </div>

          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Updated</div>
            <input
              className="w-full h-10 rounded-md border px-3 bg-slate-50"
              value={fmtDate(header?.updated_at)}
              readOnly
            />
          </div>

          <div className="space-y-1 md:col-span-2 xl:col-span-4">
            <div className="text-sm text-muted-foreground">Remarks</div>
            <textarea
              className="w-full min-h-[88px] rounded-md border px-3 py-2"
              value={safeText(header?.remarks || header?.notes)}
              onChange={(e) => setHeader((h) => ({ ...(h || {}), remarks: e.target.value }))}
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <div className="text-lg font-semibold">Lines</div>
          <div className="text-sm text-muted-foreground">{lines.length} rows</div>
        </div>

        <div className="overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-600">
                <th className="text-left p-2 border-b">#</th>
                <th className="text-left p-2 border-b">Style</th>
                <th className="text-left p-2 border-b">Description</th>
                <th className="text-right p-2 border-b">Qty</th>
                <th className="text-right p-2 border-b">Target</th>
                <th className="text-right p-2 border-b">Offer</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((ln, idx) => (
                <tr key={String(ln?.id || idx)} className="border-b">
                  <td className="p-2">{idx + 1}</td>
                  <td className="p-2">
                    {safeText(ln?.style_no || ln?.buyer_style_no || ln?.jm_style_no) || "-"}
                  </td>
                  <td className="p-2">
                    {safeText(ln?.description || ln?.item_description || ln?.name) || "-"}
                  </td>
                  <td className="p-2 text-right">{safeText(ln?.qty) || "-"}</td>
                  <td className="p-2 text-right">{fmtMoney(ln?.target_price)}</td>
                  <td className="p-2 text-right">{fmtMoney(ln?.offer_price)}</td>
                </tr>
              ))}
              {!loading && lines.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-3 text-slate-500">
                    No lines.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <div className="text-lg font-semibold">Variants</div>
          <div className="text-sm text-muted-foreground">{variants.length} variants</div>
        </div>

        <div className="space-y-4">
          {groupedVariants.map(({ variant, rows, total }, idx) => (
            <div key={String(variant?.id || idx)} className="rounded-lg border overflow-hidden">
              <div className="bg-slate-50 px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
                <div className="font-semibold">
                  {safeText(variant?.label || variant?.name || `Variant ${idx + 1}`)}
                </div>
                <div className="text-sm text-slate-600">
                  {[
                    safeText(variant?.incoterm || header?.incoterm),
                    safeText(variant?.currency || header?.currency || "USD"),
                    safeText(variant?.ship_from_display || variant?.ship_from),
                  ]
                    .filter(Boolean)
                    .join(" / ")}
                </div>
              </div>

              <div className="overflow-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-slate-600">
                      <th className="text-left p-2 border-b">Style</th>
                      <th className="text-right p-2 border-b">MOQ</th>
                      <th className="text-right p-2 border-b">Qty</th>
                      <th className="text-right p-2 border-b">Target</th>
                      <th className="text-right p-2 border-b">Offer</th>
                      <th className="text-left p-2 border-b">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, rIdx) => {
                      const ln = r?.quotation_line_id ? lineById.get(String(r.quotation_line_id)) : null;
                      return (
                        <tr key={String(r?.id || rIdx)} className="border-b">
                          <td className="p-2">
                            {safeText(
                              ln?.style_no ||
                              ln?.buyer_style_no ||
                              ln?.jm_style_no ||
                              r?.style_no
                            ) || "-"}
                          </td>
                          <td className="p-2 text-right">{safeText(r?.moq) || "-"}</td>
                          <td className="p-2 text-right">{safeText(r?.qty) || "-"}</td>
                          <td className="p-2 text-right">{fmtMoney(r?.target_price)}</td>
                          <td className="p-2 text-right">{fmtMoney(r?.offer_price)}</td>
                          <td className="p-2">{safeText(r?.notes) || "-"}</td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-3 text-slate-500">
                          No variant rows.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50">
                      <td colSpan={4} className="p-2 text-right font-semibold">
                        Total
                      </td>
                      <td className="p-2 text-right font-semibold">{fmtMoney(total)}</td>
                      <td className="p-2"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ))}

          {!loading && groupedVariants.length === 0 ? (
            <div className="text-sm text-slate-500">No variants.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
