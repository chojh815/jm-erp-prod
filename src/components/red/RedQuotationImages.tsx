'use client';

import * as React from "react";

type ImageRow = {
  id: string;
  quotation_id: string;
  path: string;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
  signed_url: string | null;
};

function fmtDate(s: string) {
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

async function safeJson(r: Response) {
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { error: t || "Invalid JSON" }; }
}

/**
 * RED Quotation Images (A안)
 * - 최대 3장 업로드 (제품 확인용)
 * - Supabase Storage + DB(red_quotation_images) 메타 저장
 * - GET: 리스트 + signed_url
 * - POST: multipart 업로드
 * - DELETE: 파일+DB 삭제
 */
export function RedQuotationImages({ quotationId, maxImages = 3 }: { quotationId: string; maxImages?: number }) {
  const [rows, setRows] = React.useState<ImageRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [files, setFiles] = React.useState<FileList | null>(null);

  const canUpload = rows.length < maxImages;

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/red/quotations/${quotationId}/images`, { cache: "no-store" });
      const j = await safeJson(r);
      if (!r.ok) throw new Error(j?.error || "Failed to load images");
      setRows((j?.data || []) as ImageRow[]);
    } catch (e: any) {
      setErr(e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { load(); }, [quotationId]);

  async function uploadSelected() {
    if (!files || files.length === 0) return;
    setUploading(true);
    setErr(null);
    try {
      const remain = Math.max(0, maxImages - rows.length);
      const list = Array.from(files).slice(0, remain);
      if (list.length === 0) {
        throw new Error(`Max ${maxImages} images allowed`);
      }

      const fd = new FormData();
      for (const f of list) fd.append("files", f);

      const r = await fetch(`/api/red/quotations/${quotationId}/images`, { method: "POST", body: fd });
      const j = await safeJson(r);
      if (!r.ok) throw new Error(j?.error || "Upload failed");
      setFiles(null);
      await load();
    } catch (e: any) {
      setErr(e?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this image?")) return;
    setErr(null);
    try {
      const r = await fetch(`/api/red/quotations/${quotationId}/images/${id}`, { method: "DELETE" });
      const j = await safeJson(r);
      if (!r.ok) throw new Error(j?.error || "Delete failed");
      await load();
    } catch (e: any) {
      setErr(e?.message || "Delete failed");
    }
  }

  return (
    <div className="rounded-lg border bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-medium">Product Images</div>
        <button
          type="button"
          onClick={load}
          className="text-sm border rounded-md px-3 py-1 hover:bg-gray-50"
          disabled={loading}
        >
          {loading ? "Loading..." : "Reload"}
        </button>
      </div>

      {err ? <div className="text-sm text-red-600">{err}</div> : null}

      <div className="flex items-center gap-3">
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={!canUpload || uploading}
          onChange={(e) => setFiles(e.target.files)}
        />
        <button
          type="button"
          onClick={uploadSelected}
          disabled={!canUpload || uploading || !files || files.length === 0}
          className="border rounded-md px-3 py-1 hover:bg-gray-50 disabled:opacity-50"
        >
          {uploading ? "Uploading..." : `Upload (max ${maxImages})`}
        </button>
        {!canUpload ? (
          <span className="text-sm text-gray-500">Max {maxImages} images reached</span>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {rows.map((r) => (
          <div key={r.id} className="border rounded-md overflow-hidden">
            <div className="aspect-square bg-gray-50 flex items-center justify-center">
              {r.signed_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.signed_url} alt={r.filename || "image"} className="w-full h-full object-cover" />
              ) : (
                <div className="text-xs text-gray-500">No preview</div>
              )}
            </div>
            <div className="p-2 space-y-1">
              <div className="text-xs text-gray-700 truncate">{r.filename || "image"}</div>
              <div className="text-[11px] text-gray-500">{fmtDate(r.created_at)}</div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => remove(r.id)}
                  className="text-xs text-red-600 hover:underline"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
        {rows.length === 0 ? (
          <div className="col-span-3 text-sm text-gray-500">No images.</div>
        ) : null}
      </div>
    </div>
  );
}

export default RedQuotationImages;
