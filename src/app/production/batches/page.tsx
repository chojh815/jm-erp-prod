"use client";

import * as React from "react";
import RedBatchPoPicker from "@/components/production/RedBatchPoPicker";
import { redBatchDetails } from "@/lib/redBatchCode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type BatchRow = {
  id: string;
  buyer_code: string;
  mfg_date: string;
  sku_code?: string;
  vendor_initial?: string;
  run_no?: number;
  label_type: string;
  version: number;
  batch_code: string;
  po_no: string | null;
  guideline_version: string;
  created_at: string;
};
function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json();
  if (!response.ok || !data.success)
    throw new Error(data.message || "처리하지 못했습니다.");
  return data;
}
const control =
  "h-10 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-60";

export default function ProductionBatchesPage() {
  const [sku, setSku] = React.useState("");
  const [date, setDate] = React.useState(today);
  const [vendor, setVendor] = React.useState("J");
  const [run, setRun] = React.useState(1);
  const [type, setType] = React.useState("");
  const [po, setPo] = React.useState("");
  const [manual, setManual] = React.useState(false);
  const [poId, setPoId] = React.useState<string | null>(null);
  const [lineId, setLineId] = React.useState<string | null>(null);
  const [source, setSource] = React.useState<BatchRow | null>(null);
  const [rows, setRows] = React.useState<BatchRow[]>([]);
  const [setupRequired, setSetupRequired] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [listError, setListError] = React.useState("");
  const [saved, setSaved] = React.useState<BatchRow | null>(null);
  const [copied, setCopied] = React.useState("");
  const [editing, setEditing] = React.useState<BatchRow | null>(null);
  const [editPo, setEditPo] = React.useState("");
  const [editManual, setEditManual] = React.useState(false);
  const [editPoId, setEditPoId] = React.useState<string | null>(null);
  const [filterSku, setFilterSku] = React.useState("");
  const [filterPo, setFilterPo] = React.useState("");
  const [filters, setFilters] = React.useState({ sku: "", po: "" });
  const [showLegacy, setShowLegacy] = React.useState(true);
  const submitting = React.useRef(false),
    loadSequence = React.useRef(0);
  const version = source ? source.version + 1 : 0;
  let preview: ReturnType<typeof redBatchDetails> | null = null,
    previewError = "";
  try {
    preview = redBatchDetails({
      mfgDate: date,
      vendorInitial: vendor,
      labelType: type,
      runNo: run,
      version,
    });
  } catch (e: any) {
    previewError = e.message;
  }

  const load = React.useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.sku) params.set("sku_code", filters.sku);
      if (filters.po) params.set("po_no", filters.po);
      const data = await request("/api/production-batches?" + params);
      if (sequence !== loadSequence.current) return;
      setRows(data.rows || []);
      setSetupRequired(data.setupRequired);
      setListError("");
    } catch (e: any) {
      if (sequence === loadSequence.current) setListError(e.message);
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [filters]);
  React.useEffect(() => {
    void load();
  }, [load]);

  function revise(row: BatchRow) {
    setSource(row);
    setPoId(null);
    setLineId(null);
    setSku(row.sku_code || "");
    setDate(row.mfg_date);
    setVendor(row.vendor_initial || "J");
    setRun(row.run_no || 1);
    setType(row.label_type);
    setPo(row.po_no || "");
    setSaved(null);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (
      submitting.current ||
      !preview ||
      !sku.trim() ||
      (!source && !manual && (!poId || !lineId))
    )
      return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setSaved(null);
    try {
      const data = await request("/api/production-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku_code: sku,
          mfg_date: date,
          vendor_initial: vendor,
          run_no: run,
          label_type: type,
          version,
          po_no: po,
          po_id: !source && !manual ? poId : undefined,
          po_line_id: !source && !manual ? lineId : undefined,
          source_id: source?.id || null,
        }),
      });
      setSaved(data.row);
      // Advance the revision form to the newly saved version.
      if (source) setSource(data.row);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function copy(row: BatchRow) {
    try {
      await navigator.clipboard.writeText(row.batch_code);
      setCopied(row.id);
    } catch {
      setListError(
        "번호 복사를 완료하지 못했습니다. 표시된 번호를 선택해 복사해 주세요.",
      );
    }
  }
  async function updatePo(event: React.FormEvent) {
    event.preventDefault();
    if (!editing || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setListError("");
    try {
      await request("/api/production-batches", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing.id,
          guideline_version:
            editing.guideline_version === "4.0" ? "4.0" : undefined,
          po_no: editPo,
          po_id: !editManual ? editPoId : undefined,
        }),
      });
      setEditing(null);
      await load();
    } catch (e: any) {
      setListError(e.message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function remove(row: BatchRow) {
    if (
      submitting.current ||
      !window.confirm(
        `${row.batch_code} 배치 기록을 삭제하시겠습니까? 인쇄·사용 여부를 확인해 주세요.`,
      )
    )
      return;
    submitting.current = true;
    setBusy(true);
    setListError("");
    try {
      const params = new URLSearchParams({ id: row.id });
      if (row.guideline_version === "4.0")
        params.set("guideline_version", "4.0");
      await request("/api/production-batches?" + params, { method: "DELETE" });
      if (source?.id === row.id) setSource(null);
      if (saved?.id === row.id) setSaved(null);
      if (editing?.id === row.id) setEditing(null);
      await load();
    } catch (e: any) {
      setListError(e.message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <div>
        <h1 className="text-2xl font-semibold">Batches (RED)</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          KISS Batch Management 4.0 · SKU별 생산 시작일 기준
        </p>
      </div>
      {setupRequired && (
        <div
          role="alert"
          className="rounded border border-amber-300 bg-amber-50 p-3 text-sm"
        >
          BATCH 4.0 DB 설정을 적용해야 새 배치를 저장할 수 있습니다.
        </div>
      )}
      <form onSubmit={save} className="space-y-4 rounded-xl border p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">
            {source ? "라벨 수정 버전 생성" : "새 생산 배치 등록"}
          </h2>
          {source && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setSource(null);
                setPoId(null);
                setLineId(null);
                if (!manual) {
                  setSku("");
                  setPo("");
                }
                setSaved(null);
                setError("");
              }}
            >
              새 배치 등록으로 전환
            </Button>
          )}
        </div>
        {source && (
          <p className="text-sm">
            원본 {source.batch_code} · 다음 라벨 버전 {version}{" "}
            {version > 9 && "(최대 버전 9에 도달했습니다)"}
          </p>
        )}
        {!source && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input
                id="manual-entry"
                type="checkbox"
                checked={manual}
                disabled={busy}
                onChange={(e) => {
                  setManual(e.target.checked);
                  setPoId(null);
                  setLineId(null);
                  if (!e.target.checked) {
                    setSku("");
                    setPo("");
                  }
                }}
              />
              SKU·PO 직접 입력
            </label>
            {!manual && (
              <RedBatchPoPicker
                disabled={busy}
                onChange={(selectedPo, line) => {
                  setPo(selectedPo?.po_no || "");
                  setPoId(selectedPo?.id || null);
                  setSku(line?.sku_code || "");
                  setLineId(line?.id || null);
                  setSaved(null);
                }}
              />
            )}
          </>
        )}
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label htmlFor="sku" className="mb-1 block text-sm">
              SKU / 바이어 스타일 번호
            </label>
            <Input
              id="sku"
              value={sku}
              maxLength={120}
              readOnly={!manual || !!source}
              required
              disabled={busy || !!source}
              onChange={(e) => setSku(e.target.value)}
              placeholder={
                manual
                  ? "ASSORT는 디스플레이 품목 번호"
                  : "PO 품목 선택 시 자동 입력"
              }
            />
          </div>
          <div>
            <label htmlFor="start-date" className="mb-1 block text-sm">
              생산 시작일
            </label>
            <Input
              id="start-date"
              type="date"
              value={date}
              required
              disabled={busy || !!source}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="vendor" className="mb-1 block text-sm">
              KISS 지정 업체코드
            </label>
            <Input
              id="vendor"
              value={vendor}
              maxLength={1}
              required
              disabled={busy || !!source}
              onChange={(e) => setVendor(e.target.value.toUpperCase())}
            />
          </div>
          <div>
            <label htmlFor="run" className="mb-1 block text-sm">
              동일 SKU · 같은 시작일의 생산 차수
            </label>
            <select
              id="run"
              className={control}
              value={run}
              disabled={busy || !!source}
              onChange={(e) => setRun(Number(e.target.value))}
            >
              <option value={1}>1차 생산</option>
              <option value={2}>2차 생산</option>
              <option value={3}>3차 생산</option>
            </select>
          </div>
          <div>
            <label htmlFor="label-type" className="mb-1 block text-sm">
              제품 유형
            </label>
            <select
              id="label-type"
              className={control}
              value={type}
              required
              disabled={busy || !!source}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="">V / M 선택</option>
              <option value="V">V · 단일 품목</option>
              <option value="M">M · 키트 / 복수 품목·로트</option>
            </select>
          </div>
          <div>
            <label htmlFor="po" className="mb-1 block text-sm">
              PO 번호
            </label>
            <Input
              id="po"
              value={po}
              readOnly={!manual || !!source}
              maxLength={200}
              disabled={busy}
              onChange={(e) => setPo(e.target.value)}
            />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          한 생산 배치가 며칠 이어져도 시작일과 번호를 계속 사용합니다. 같은 날
          별도의 생산 배치를 시작할 때 2·3차를 선택합니다.
        </p>
        <div className="rounded-lg bg-muted/40 p-4" aria-live="polite">
          <div className="text-sm text-muted-foreground">
            번호 미리보기 · 미저장
          </div>
          {preview ? (
            <>
              <div className="my-2 font-mono text-3xl font-semibold">
                {preview.batchCode}
              </div>
              <div className="text-sm">
                업체 {preview.vendor} · ISO {preview.isoYear}년{" "}
                {preview.isoWeek}주 · {preview.weekday}요일 {run}차 (
                {preview.dayCode}) · {type} · 라벨 버전 {version}
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm">{previewError}</p>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <Button
          type="submit"
          disabled={
            busy ||
            setupRequired ||
            !sku.trim() ||
            !preview ||
            (!source && !manual && (!poId || !lineId))
          }
        >
          {busy
            ? "처리 중…"
            : source
              ? `라벨 버전 ${version} 저장`
              : "생산 배치 저장 (라벨 버전 0)"}
        </Button>
        {saved && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-3 rounded border border-green-300 p-3 text-sm"
          >
            <span>
              저장 완료 · {saved.sku_code} ·{" "}
              <strong className="font-mono">{saved.batch_code}</strong>
            </span>
            <Button
              type="button"
              variant="outline"
              onClick={() => void copy(saved)}
            >
              {copied === saved.id ? "복사됨" : "저장 번호 복사"}
            </Button>
          </div>
        )}
      </form>

      <section className="space-y-4 rounded-xl border p-5">
        <h2 className="text-lg font-semibold">배치 이력</h2>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setFilters({
              sku: filterSku.trim().toUpperCase(),
              po: filterPo.trim(),
            });
          }}
        >
          <div>
            <label htmlFor="filter-sku" className="mb-1 block text-sm">
              SKU / 스타일 검색
            </label>
            <Input
              id="filter-sku"
              value={filterSku}
              onChange={(e) => setFilterSku(e.target.value)}
              maxLength={120}
            />
          </div>
          <div>
            <label htmlFor="filter-po" className="mb-1 block text-sm">
              PO 검색
            </label>
            <Input
              id="filter-po"
              value={filterPo}
              onChange={(e) => setFilterPo(e.target.value)}
              maxLength={200}
            />
          </div>
          <Button type="submit" variant="outline" disabled={loading}>
            검색
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => void load()}
          >
            새로고침
          </Button>
          <label className="flex h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showLegacy}
              onChange={(e) => setShowLegacy(e.target.checked)}
            />
            기존 규칙 자료 표시
          </label>
        </form>
        {listError && (
          <p role="alert" className="text-sm text-red-700">
            {listError}
          </p>
        )}
        {editing && (
          <form
            onSubmit={updatePo}
            className="flex flex-wrap items-end gap-3 rounded border p-3"
          >
            <div>
              <label htmlFor="edit-po" className="mb-1 block text-sm">
                {editing.batch_code} · PO 수정
              </label>
              <Input
                id="edit-po"
                value={editPo}
                readOnly={!editManual}
                maxLength={200}
                disabled={busy}
                onChange={(e) => setEditPo(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editManual}
                disabled={busy}
                onChange={(e) => {
                  setEditManual(e.target.checked);
                  setEditPoId(null);
                }}
              />
              직접 입력
            </label>
            {!editManual && (
              <div className="w-full">
                <RedBatchPoPicker
                  key={editing.id}
                  selectItem={false}
                  disabled={busy}
                  onChange={(selected) => {
                    setEditPo(selected?.po_no || "");
                    setEditPoId(selected?.id || null);
                  }}
                />
              </div>
            )}
            <Button type="submit" disabled={busy}>
              PO 저장
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              취소
            </Button>
          </form>
        )}
        <p className="text-xs text-muted-foreground">
          규칙별 최근 200건을 표시합니다. SKU·PO 검색으로 이전 배치를 찾을 수
          있습니다.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-sm">
            <thead className="border-b bg-muted/40 text-left">
              <tr>
                {[
                  "규칙",
                  "SKU / 스타일",
                  "생산 시작일",
                  "생산 차수",
                  "유형",
                  "라벨 버전",
                  "BATCH 번호",
                  "PO 번호",
                  "작업",
                ].map((title) => (
                  <th key={title} className="p-2">
                    {title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows
                .filter((row) => showLegacy || row.guideline_version === "4.0")
                .map((row) => (
                  <tr key={row.guideline_version + row.id} className="border-b">
                    <td className="p-2">
                      {row.guideline_version === "4.0" ? "4.0" : "기존"}
                    </td>
                    <td className="p-2">{row.sku_code || "—"}</td>
                    <td className="p-2">{row.mfg_date}</td>
                    <td className="p-2">
                      {row.run_no ? `${row.run_no}차` : "—"}
                    </td>
                    <td className="p-2">{row.label_type}</td>
                    <td className="p-2">{row.version}</td>
                    <td className="p-2 font-mono font-semibold">
                      {row.batch_code}
                    </td>
                    <td className="p-2">{row.po_no || "—"}</td>
                    <td className="flex gap-2 p-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void copy(row)}
                      >
                        {copied === row.id ? "복사됨" : "복사"}
                      </Button>
                      {row.guideline_version === "4.0" && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy || row.version >= 9}
                          onClick={() => revise(row)}
                        >
                          라벨 수정
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setEditing(row);
                          setEditManual(false);
                          setEditPoId(null);
                          setEditPo(row.po_no || "");
                        }}
                      >
                        PO 수정
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => void remove(row)}
                      >
                        삭제
                      </Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!loading &&
          !rows.filter((row) => showLegacy || row.guideline_version === "4.0")
            .length && (
            <p className="py-5 text-center text-sm text-muted-foreground">
              등록된 배치가 없습니다.
            </p>
          )}
      </section>
    </div>
  );
}
