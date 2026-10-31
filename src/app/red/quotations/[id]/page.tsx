"use client";
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import MatrixTab from "./tabs/matrix";
import CompareDiffTab from "./tabs/compare-diff";
export default function RedQuotationDetailPage() {
  const [matrixDirty, setMatrixDirty] = React.useState(false);
  const { id } = useParams<{ id: string }>(),
    router = useRouter();
  const [shipFrom, setShipFrom] = React.useState(""),
    [sites, setSites] = React.useState<{ code: string; name: string }[]>([]);
  const [q, setQ] = React.useState<any>(null),
    [versions, setVersions] = React.useState<any[]>([]),
    [err, setErr] = React.useState(""),
    [busy, setBusy] = React.useState(false),
    [style, setStyle] = React.useState(""),
    [title, setTitle] = React.useState(""),
    [tab, setTab] = React.useState<"matrix" | "compare">("matrix"),
    [canEdit, setCanEdit] = React.useState(false),
    [canCreate, setCanCreate] = React.useState(false);
  async function load() {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/red/quotations/" + id + "/versions", {
          cache: "no-store",
        }),
        j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setQ(j.data.quotation);
      setShipFrom(j.data.quotation.ship_from_code || "");
      setVersions(j.data.versions);
      setStyle(j.data.quotation.style_no || "");
      setTitle(j.data.quotation.title || "");
      setCanEdit(j.data.canEdit);
      setCanCreate(j.data.canCreate);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  React.useEffect(() => {
    void load();
    void fetch("/api/red/quotations/" + id + "/ship-from", {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((j) => setSites(j.data?.options || []))
      .catch(() => {});
  }, [id]);
  async function saveHeader() {
    setBusy(true);
    try {
      const r = await fetch("/api/red/quotations/" + id, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            style_no: style,
            title,
            ship_from_code: shipFrom,
          }),
        }),
        j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setQ(j.data);
      setErr("");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">RED Quotation</p>
          <h1 className="text-2xl font-semibold">
            {q?.red_quotation_no || "RED Quotation"}
            {q?.archived_at ? " · 보관됨" : ""}
          </h1>
          <p className="text-sm">
            Buyer: {q?.buyer_name || "—"} · Ship From:{" "}
            {q?.ship_from_code || "—"}
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              aria-label="Title"
              className="rounded border bg-background px-2 py-1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="견적 제목"
              disabled={!canEdit || !!q?.archived_at}
            />
            <input
              aria-label="Style No"
              className="rounded border bg-background px-2 py-1"
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              placeholder="Style No"
              disabled={!canEdit || !!q?.archived_at}
            />
            <select
              aria-label="Ship From"
              className="rounded border bg-background px-2 py-1"
              value={shipFrom}
              onChange={(e) => setShipFrom(e.target.value)}
              disabled={!canEdit || !!q?.archived_at}
            >
              <option value={q?.ship_from_code || ""}>
                {q?.ship_from_code || "Ship From"}
              </option>
              {sites
                .filter((s) => s.code !== q?.ship_from_code)
                .map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} — {s.name}
                  </option>
                ))}
            </select>
            <button
              className="rounded border px-3 py-1 text-sm"
              onClick={() => void saveHeader()}
              disabled={busy || !canEdit || !!q?.archived_at}
            >
              견적 정보 저장
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            발송본의 출력에는 해당 가격 저장 당시의 제목·스타일·조건이
            유지됩니다.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="rounded border px-3 py-2 text-sm"
            onClick={() => {
              if (
                !matrixDirty ||
                window.confirm("저장하지 않은 변경을 버리시겠습니까?")
              )
                router.push("/red/quotations");
            }}
          >
            Back
          </button>
          <button
            className="rounded border px-3 py-2 text-sm"
            disabled={busy}
            onClick={() => void load()}
          >
            Refresh
          </button>
        </div>
      </div>
      {err && (
        <div
          role="alert"
          className="rounded border border-red-200 p-3 text-sm text-red-700"
        >
          {err}
        </div>
      )}
      <div className="rounded-lg border">
        <div className="flex gap-2 border-b bg-muted/40 p-2">
          {(["matrix", "compare"] as const).map((t) => (
            <button
              key={t}
              className={
                "rounded px-3 py-2 text-sm " +
                (tab === t ? "border bg-background" : "")
              }
              onClick={() => {
                if (t === tab) return;
                if (
                  !matrixDirty ||
                  window.confirm("저장하지 않은 변경을 버리시겠습니까?")
                ) {
                  setMatrixDirty(false);
                  setTab(t);
                }
              }}
            >
              {t === "matrix" ? "Matrix / Offer" : "Compare / Diff"}
            </button>
          ))}
        </div>
        <div className="p-4">
          {tab === "matrix" ? (
            <MatrixTab
              quotationId={id}
              versions={versions}
              onChanged={load}
              onDirtyChange={setMatrixDirty}
              canEdit={canEdit}
              canCreate={canCreate}
            />
          ) : (
            <CompareDiffTab
              quotationId={id}
              versions={versions}
              onChanged={load}
              canCreate={canCreate && !q?.archived_at}
            />
          )}
        </div>
      </div>
    </div>
  );
}
