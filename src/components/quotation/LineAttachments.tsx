"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type UploadedItem = {
  id: string;
  file_name: string;
  signed_url?: string | null;
  mime_type?: string | null;
  created_at?: string | null;
};

const ALLOWED_EXT = ["pdf","png","jpg","jpeg","webp","xlsx","xls","csv","doc","docx","txt"];
const FILE_LIMIT = 10 * 1024 * 1024; // 10MB
const IMG_LIMIT_BEFORE = 8 * 1024 * 1024; // 8MB

function extOf(name: string) {
  const m = /(?:\.([a-zA-Z0-9]+))$/.exec(name || "");
  return (m?.[1] || "").toLowerCase();
}
function isImageFile(f: File) {
  return (f.type || "").startsWith("image/") || ["png","jpg","jpeg","webp"].includes(extOf(f.name));
}

async function maybeResizeImage(file: File): Promise<File> {
  if (!isImageFile(file)) return file;
  if (file.size > IMG_LIMIT_BEFORE) throw new Error("Image too large (limit 8MB before resize).");

  const img = new Image();
  const url = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to read image"));
      img.src = url;
    });

    const maxSide = 1600;
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return file;

    const scale = min(1, maxSide / max(w, h));
    if (scale >= 1) return file;

    const cw = round(w * scale);
    const ch = round(h * scale);

    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, cw, ch);

    const outType = extOf(file.name) === "png" ? "image/png" : "image/jpeg";
    const blob: Blob = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b || file), outType, outType === "image/jpeg" ? 0.85 : undefined)
    );

    const newName =
      outType === "image/jpeg"
        ? file.name.replace(/\.(png|jpg|jpeg|webp)$/i, ".jpg")
        : file.name.replace(/\.(png|jpg|jpeg|webp)$/i, ".png");

    return new File([blob], newName, { type: outType });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function downloadUrl(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function min(a:number,b:number){ return a<b?a:b }
function max(a:number,b:number){ return a>b?a:b }
function round(n:number){ return Math.round(n) }

export default function LineAttachments(props: {
  mode: "local" | "uploaded";
  // local mode
  localFiles?: File[];
  onChangeLocalFiles?: (files: File[]) => void;
  // uploaded mode
  uploadedItems?: UploadedItem[];
  onDeleteUploaded?: (id: string) => void;
  onRefreshUploaded?: () => void;
  uploading?: boolean;
  loading?: boolean;
  onUploadFile?: (f: File) => Promise<void> | void;
}) {
  const {
    mode,
    localFiles = [],
    onChangeLocalFiles,
    uploadedItems = [],
    onDeleteUploaded,
    onRefreshUploaded,
    uploading,
    loading,
    onUploadFile,
  } = props;

  // ✅ Fix: use ref instead of document.getElementById (prevents "first row attach doesn't open" issues)
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const [localUrls, setLocalUrls] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (mode !== "local") return;
    const map: Record<string, string> = {};
    for (const f of localFiles) {
      map[f.name + ":" + f.size + ":" + f.lastModified] = URL.createObjectURL(f);
    }
    setLocalUrls((prev) => {
      for (const k of Object.keys(prev)) {
        try { URL.revokeObjectURL(prev[k]); } catch {}
      }
      return map;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, localFiles.map((f) => `${f.name}:${f.size}:${f.lastModified}`).join("|")]);

  function addLocalFiles(files: File[]) {
    if (!onChangeLocalFiles) return;
    onChangeLocalFiles([...(localFiles || []), ...files]);
  }

  async function validateAndMaybeResize(files: File[]) {
    const out: File[] = [];
    for (const f of files) {
      const ext = extOf(f.name);
      if (!ALLOWED_EXT.includes(ext)) throw new Error(`Not allowed file: .${ext}`);
      if (f.size > FILE_LIMIT) throw new Error("File too large (limit 10MB).");
      const resized = await maybeResizeImage(f);
      if (resized.size > FILE_LIMIT) throw new Error("File too large after resize (limit 10MB).");
      out.push(resized);
    }
    return out;
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={async (e) => {
          const list = Array.from(e.target.files || []);
          e.currentTarget.value = "";
          if (!list.length) return;

          try {
            const prepared = await validateAndMaybeResize(list);
            if (mode === "local") {
              addLocalFiles(prepared);
            } else {
              for (const f of prepared) await onUploadFile?.(f);
            }
          } catch (err: any) {
            alert(err?.message || String(err));
          }
        }}
      />

      <div className="flex items-center gap-2">
        {/* ✅ Fix: type="button" so clicking won't submit a surrounding form */}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Uploading..." : "Attach"}
        </Button>

        {mode === "uploaded" ? (
          <Button type="button" size="sm" variant="ghost" onClick={onRefreshUploaded} disabled={loading}>
            {loading ? "..." : "Refresh"}
          </Button>
        ) : null}

        <Badge variant="secondary">
          {mode === "local" ? `${localFiles.length} files` : `${uploadedItems.length} files`}
        </Badge>
      </div>

      {mode === "local" ? (
        <div className="space-y-1">
          {localFiles.length ? (
            localFiles.map((f, i) => {
              const key = f.name + ":" + f.size + ":" + f.lastModified;
              const url = localUrls[key];
              return (
                <div key={key} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                  <div className="truncate" title={f.name}>{f.name}</div>
                  <div className="flex items-center gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={() => url && window.open(url, "_blank", "noreferrer")}>
                      Open
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => url && downloadUrl(url, f.name)}>
                      Download
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => onChangeLocalFiles?.(localFiles.filter((_, idx) => idx !== i))}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-xs text-muted-foreground">
              Allowed: {ALLOWED_EXT.join(", ")}. Limit: 10MB (files), 8MB (images before resize). Images auto-resize to max 1600px.
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          {uploadedItems.length ? (
            uploadedItems.map((it) => (
              <div key={it.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  {it.signed_url && (it.mime_type || "").startsWith("image/") ? (
                    <img src={it.signed_url} alt={it.file_name} className="h-10 w-10 rounded object-cover border" />
                  ) : null}
                  <a
                    className="truncate hover:underline"
                    href={it.signed_url || "#"}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => { if (!it.signed_url) e.preventDefault(); }}
                    title={it.file_name}
                  >
                    {it.file_name}
                  </a>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => it.signed_url && window.open(it.signed_url, "_blank", "noreferrer")}>
                    Open
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => it.signed_url && downloadUrl(it.signed_url, it.file_name)}>
                    Download
                  </Button>
                  <Button type="button" size="sm" variant="destructive" onClick={() => onDeleteUploaded?.(it.id)}>
                    Delete
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="text-xs text-muted-foreground">No files</div>
          )}
        </div>
      )}
    </div>
  );
}
