"use client";
import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
type Props = {
  id: string;
  quotationNo: string;
  disabled?: boolean;
  onDeleted: () => void | Promise<void>;
  apiBase?: string;
};
export default function QuotationPurgeDialog({
  id,
  quotationNo,
  disabled,
  onDeleted,
  apiBase = "/api/quotations",
}: Props) {
  const [open, setOpen] = React.useState(false),
    [preview, setPreview] = React.useState<any>(null),
    [typed, setTyped] = React.useState(""),
    [checked, setChecked] = React.useState(false),
    [busy, setBusy] = React.useState(false),
    [error, setError] = React.useState(""),
    [result, setResult] = React.useState<any>(null);
  const submitting = React.useRef(false),
    previewSequence = React.useRef(0),
    field = React.useId();
  async function request(url: string, init?: RequestInit) {
    const r = await fetch(url, { cache: "no-store", ...init }),
      j = await r.json();
    if (!r.ok) throw new Error(j.error || "처리하지 못했습니다.");
    return j;
  }
  async function inspect() {
    if (submitting.current) return;
    const sequence = ++previewSequence.current;
    setBusy(true);
    setPreview(null);
    setTyped("");
    setChecked(false);
    setError("");
    try {
      const p = await request(apiBase + "/" + id + "/purge");
      if (sequence !== previewSequence.current) return;
      setPreview(p);
    } catch (e: any) {
      if (sequence === previewSequence.current) setError(e.message);
    } finally {
      if (sequence === previewSequence.current) setBusy(false);
    }
  }
  async function remove() {
    if (
      submitting.current ||
      !preview?.eligible ||
      typed.trim() !== preview.quotation_no ||
      !checked
    )
      return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await request(apiBase + "/" + id + "/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmation_no: typed.trim(),
          confirmation_token: preview.confirmation_token,
          confirmed: checked,
        }),
      });
      setResult(r);
      if (r.cleanup?.pending > 0) {
        try {
          const c = await request(apiBase + "/" + id + "/purge-cleanup", {
            method: "POST",
          });
          setResult({ ...r, cleanup: c.cleanup });
        } catch {
          setError(
            "견적 삭제는 완료됐습니다. 첨부파일 정리는 아래 버튼이나 목록에서 다시 시도해 주세요.",
          );
        }
      }
    } catch (e: any) {
      setError(e.message);
      setPreview(null);
      setTyped("");
      setChecked(false);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function retryFiles() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      const r = await request(apiBase + "/" + id + "/purge-cleanup", {
        method: "POST",
      });
      setResult((previous: any) => ({ ...previous, cleanup: r.cleanup }));
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function close() {
    if (submitting.current) return;
    previewSequence.current++;
    setBusy(false);
    setOpen(false);
    if (result?.deleted) await onDeleted();
  }
  const counts = preview?.counts || {},
    rows =
      Number(counts.quotation_lines || 0) +
      Number(counts.quotation_items || 0) +
      Number(counts.quotation_variant_lines || 0) +
      Number(counts.document_lines || 0);
  return (
    <>
      <button
        type="button"
        className="rounded border border-red-300 px-3 py-2 text-sm text-red-700 disabled:opacity-50"
        disabled={disabled}
        onClick={() => {
          setResult(null);
          setOpen(true);
          void inspect();
        }}
      >
        테스트 견적 완전 삭제
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) void close();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {result?.deleted
                ? "견적 삭제 완료"
                : "테스트 견적을 완전히 삭제하시겠습니까?"}
            </DialogTitle>
          </DialogHeader>
          {result?.deleted ? (
            <div className="space-y-3 text-sm">
              <p>
                <strong>{result.quotation_no || quotationNo}</strong>의 견적
                데이터가 삭제됐습니다. 복원할 수 없습니다.
              </p>
              {result.cleanup?.pending > 0 ? (
                <div className="rounded border border-amber-300 bg-amber-50 p-3">
                  <p>
                    첨부파일 원본 {result.cleanup.pending}개가 정리 대기
                    중입니다. 견적 삭제는 완료됐습니다.
                  </p>
                  <button
                    type="button"
                    className="mt-2 rounded border bg-white px-3 py-2"
                    disabled={busy}
                    onClick={() => void retryFiles()}
                  >
                    첨부파일 정리 다시 시도
                  </button>
                </div>
              ) : (
                <p>
                  첨부파일 정리를 마쳤습니다.
                  {result.cleanup?.retained > 0
                    ? " 다른 견적에서 참조하는 공유 파일은 보존했습니다."
                    : ""}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="rounded border border-red-300 bg-red-50 p-3 text-red-800">
                <p className="font-semibold">이 작업은 되돌릴 수 없습니다.</p>
                <p className="mt-2">
                  해당 견적의 모든 버전·스타일 행·수량별 가격·첨부 기록을 완전히
                  삭제합니다. 보관함에서도 복원할 수 없습니다.
                </p>
                <p className="mt-2">
                  발송·확정 이력이 있거나 다른 업무 자료와 연결된 견적은 삭제할
                  수 없습니다. 원가표와 다른 견적에서 사용하는 공유 파일은
                  삭제하지 않습니다.
                </p>
              </div>
              <p>
                삭제 대상:{" "}
                <strong>{preview?.quotation_no || quotationNo}</strong>
              </p>
              {preview && (
                <p>
                  Buyer: {preview.buyer_name || "—"} · 제목:{" "}
                  {preview.subject || "—"}
                </p>
              )}
              {preview && (
                <p>
                  버전 {counts.quotation_versions || 0}개 · 견적 행 기록 {rows}
                  개 · 첨부 기록 {counts.quotation_line_attachments || 0}개
                </p>
              )}
              {preview?.eligible === false && (
                <div role="alert" className="rounded border p-3">
                  {preview.reasons?.map((s: string, i: number) => (
                    <p key={i}>{s}</p>
                  ))}
                </div>
              )}
              {preview?.eligible && (
                <>
                  <label htmlFor={field} className="block">
                    확인을 위해 견적번호 <strong>{preview.quotation_no}</strong>
                    를 입력해 주세요.
                  </label>
                  <input
                    id={field}
                    className="w-full rounded border bg-background p-2"
                    autoComplete="off"
                    value={typed}
                    disabled={busy}
                    onChange={(e) => setTyped(e.target.value)}
                  />
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={checked}
                      disabled={busy}
                      onChange={(e) => setChecked(e.target.checked)}
                    />
                    <span>
                      테스트용 견적이며, 삭제 후 복구할 수 없음을 확인했습니다.
                    </span>
                  </label>
                </>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            {result?.deleted ? (
              <button
                type="button"
                className="rounded border px-3 py-2 text-sm"
                disabled={busy}
                onClick={() => void close()}
              >
                확인
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="rounded border px-3 py-2 text-sm"
                  disabled={submitting.current}
                  onClick={() => void close()}
                >
                  취소
                </button>
                {!preview && !busy && (
                  <button
                    type="button"
                    className="rounded border px-3 py-2 text-sm"
                    onClick={() => void inspect()}
                  >
                    다시 확인
                  </button>
                )}
                <button
                  type="button"
                  className="rounded bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-40"
                  disabled={
                    busy ||
                    !preview?.eligible ||
                    !checked ||
                    typed.trim() !== preview?.quotation_no
                  }
                  onClick={() => void remove()}
                >
                  {busy ? "처리 중…" : "복구 불가 · 완전 삭제"}
                </button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
