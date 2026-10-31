"use client";
import * as React from "react";
import {
  defaultRedVersion,
  sortedVersions,
  normalizeRedDocument,
  offerUsd,
  type RedDocument,
} from "@/lib/redQuoteDocument";
type Version = { id: string; version_no: number; status: string };
type Props = {
  quotationId: string;
  versions: Version[];
  onChanged: () => void | Promise<void>;
  canEdit?: boolean;
  canCreate?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
};
async function json(url: string, init?: RequestInit) {
  const r = await fetch(url, { cache: "no-store", ...init });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "처리하지 못했습니다.");
  return j;
}
const inputClass =
  "h-9 w-full rounded border bg-background px-2 text-sm disabled:bg-muted";
export default function MatrixTab({
  quotationId,
  versions,
  onChanged,
  canEdit = true,
  canCreate = true,
  onDirtyChange,
}: Props) {
  const [target, setTarget] = React.useState(""),
    [doc, setDoc] = React.useState<RedDocument | null>(null),
    [revision, setRevision] = React.useState(0),
    [pkg, setPkg] = React.useState("A"),
    [busy, setBusy] = React.useState(false),
    [dirty, setDirty] = React.useState(false),
    [message, setMessage] = React.useState(""),
    [archived, setArchived] = React.useState(false),
    [custom, setCustom] = React.useState("");
  const version = versions.find((v) => v.id === target),
    editable = canEdit && version?.status === "DRAFT" && !archived;
  const loadSeq = React.useRef(0);
  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  React.useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  React.useEffect(() => {
    setTarget((prev) =>
      versions.some((v) => v.id === prev)
        ? prev
        : defaultRedVersion(versions)?.id || "",
    );
  }, [versions]);
  async function reload(id = target) {
    const seq = ++loadSeq.current;
    setBusy(true);
    setDoc(null);
    setMessage("");
    try {
      const s = await json("/api/red/quotation-versions/" + id + "/document");
      if (seq !== loadSeq.current) return;
      setDoc(s.document);
      setRevision(s.revision);
      setArchived(!!s.quotation.archived_at);
      setDirty(false);
      setPkg((p) =>
        s.document.packages[p] ? p : Object.keys(s.document.packages)[0] || "A",
      );
      if (s.legacy)
        setMessage(
          "기존 자료입니다. 환율·매출총이익률을 확인하고 저장하면 최종 USD 오퍼가 보존됩니다.",
        );
    } catch (e: any) {
      if (seq === loadSeq.current) setMessage(e.message);
    } finally {
      if (seq === loadSeq.current) setBusy(false);
    }
  }
  React.useEffect(() => {
    if (target) void reload(target);
    return () => {
      loadSeq.current++;
    };
  }, [target]);
  function change(fn: (d: RedDocument) => void) {
    if (!editable || !doc || busy) return;
    const d = structuredClone(doc);
    fn(d);
    setDoc(d);
    setDirty(true);
  }
  function input(k: string, v: string) {
    change((d) => {
      (d.inputs as any)[k] =
        k === "unit_price_currency" ? v : v === "" ? null : Number(v);
    });
  }
  function pcsList() {
    const cells = doc?.packages[pkg]?.cells || [];
    return [
      ...new Set([3, 4, 6, 10, 12, 14, ...cells.map((c) => c.pcs_per_pkg)]),
    ].sort((a, b) => a - b);
  }
  const moqs = [
    ...new Set([
      1000,
      3000,
      5000,
      ...(doc?.packages[pkg]?.cells || []).map((c) => c.moq_packages),
    ]),
  ].sort((a, b) => a - b);
  function cell(pcs: number, moq: number) {
    return doc?.packages[pkg]?.cells.find(
      (c) => c.pcs_per_pkg === pcs && c.moq_packages === moq,
    );
  }
  function editCell(pcs: number, moq: number, k: string, value: string) {
    change((d) => {
      const p = d.packages[pkg];
      let c = p.cells.find(
        (c) => c.pcs_per_pkg === pcs && c.moq_packages === moq,
      );
      if (!c) {
        c = {
          package_code: pkg,
          pcs_per_pkg: pcs,
          moq_packages: moq,
          price_fob_per_pkg: null,
          override_price_fob_per_pkg: null,
          offer_usd: null,
        };
        p.cells.push(c);
      }
      (c as any)[k] = value === "" ? null : Number(value);
    });
  }
  function calculate() {
    if (!doc) return;
    try {
      const checked = normalizeRedDocument(doc);
      if (checked.inputs.unit_price_per_piece === null)
        throw new Error("개당 원가를 입력해 주세요.");
      change((d) => {
        for (const pcs of pcsList())
          for (const moq of moqs) {
            const cost = d.packages[pkg].packaging_costs.find(
              (r) => r.moq === moq,
            )?.packaging_cost_per_pkg;
            if (cost == null) continue;
            let c = d.packages[pkg].cells.find(
              (c) => c.pcs_per_pkg === pcs && c.moq_packages === moq,
            );
            if (!c) {
              c = {
                package_code: pkg,
                pcs_per_pkg: pcs,
                moq_packages: moq,
                price_fob_per_pkg: null,
                override_price_fob_per_pkg: null,
                offer_usd: null,
              };
              d.packages[pkg].cells.push(c);
            }
            c.price_fob_per_pkg =
              Math.round(
                (pcs * checked.inputs.unit_price_per_piece! + cost) * 100,
              ) / 100;
          }
      });
      setMessage(
        "원가를 계산했습니다. 저장하면 환율·마진·가격이 함께 보존됩니다.",
      );
    } catch (e: any) {
      setMessage(e.message);
    }
  }
  async function save() {
    if (!doc || !editable) return;
    setBusy(true);
    setMessage("");
    try {
      const normalized = normalizeRedDocument(doc);
      const s = await json(
        "/api/red/quotation-versions/" + target + "/document",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ document: normalized, revision }),
        },
      );
      setDoc(s.document);
      setRevision(s.revision);
      setDirty(false);
      setMessage("원가·환율·매출총이익률·최종 오퍼를 함께 저장했습니다.");
      await onChanged();
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (dirty) {
      setMessage("수정 중인 내용을 먼저 저장해 주세요.");
      return;
    }
    const reason = window.prompt("수정 이유 / 네고 내용 (선택)", "");
    if (reason === null) return;
    setBusy(true);
    try {
      const j = await json("/api/red/quotations/" + quotationId + "/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_version_id: target,
          change_summary: reason,
        }),
      });
      await onChanged();
      setTarget(j.data.id);
      setMessage("수정 견적을 만들었습니다.");
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function sent() {
    if (
      !window.confirm(
        "이 버전을 발송본으로 기록하고 잠그시겠습니까? 실제 메일 전송은 수행하지 않습니다.",
      )
    )
      return;
    setBusy(true);
    try {
      await json("/api/red/quotation-versions/" + target + "/sent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision }),
      });
      await onChanged();
      setMessage(
        "발송본으로 기록했습니다. 변경은 수정 견적에서 진행해 주세요.",
      );
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  function exportFile(kind: "excel" | "pdf") {
    if (dirty) {
      setMessage("저장 후 출력해 주세요.");
      return;
    }
    window.open(
      (kind === "excel"
        ? "/api/red/quotation-versions/"
        : "/red/quotation-versions/") +
        target +
        "/" +
        kind +
        "?package=" +
        encodeURIComponent(pkg),
      "_blank",
      "noopener,noreferrer",
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          견적 버전
          <select
            className={inputClass}
            value={target}
            disabled={busy}
            onChange={(e) => {
              if (
                dirty &&
                !window.confirm("저장하지 않은 변경을 버리시겠습니까?")
              )
                return;
              setTarget(e.target.value);
            }}
          >
            {sortedVersions(versions).map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version_no} ({v.status})
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          패키지
          <select
            className={inputClass}
            value={pkg}
            onChange={(e) => setPkg(e.target.value)}
          >
            {Object.keys(doc?.packages || { A: {} }).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <button
          className="rounded border px-3 py-2 text-sm"
          disabled={busy || !target}
          onClick={() => {
            if (
              !dirty ||
              window.confirm("변경을 버리고 다시 불러오시겠습니까?")
            )
              void reload();
          }}
        >
          Reload
        </button>
        <button
          className="rounded border px-3 py-2 text-sm"
          disabled={busy || !target || !doc || archived || !canCreate}
          onClick={() => void copy()}
        >
          이 버전으로 수정 견적 만들기
        </button>
        <button
          className="rounded border px-3 py-2 text-sm"
          disabled={busy || dirty || !doc}
          onClick={() => exportFile("excel")}
        >
          Excel (XLSX)
        </button>
        <button
          className="rounded border px-3 py-2 text-sm"
          disabled={busy || dirty || !doc}
          onClick={() => exportFile("pdf")}
        >
          PDF / Print
        </button>
      </div>
      {message && (
        <div role="status" className="rounded border bg-muted/30 p-3 text-sm">
          {message}
        </div>
      )}
      {archived && (
        <p className="text-sm">
          보관된 견적입니다. 목록에서 복원할 수 있습니다.
        </p>
      )}
      {doc && (
        <>
          <fieldset
            disabled={!editable || busy}
            className="min-w-0 space-y-4 rounded border p-4"
          >
            <legend className="px-1 text-sm font-medium">
              원가 및 오퍼 계산 기준
            </legend>
            <div className="grid gap-3 sm:grid-cols-4">
              <label className="text-sm">
                원가 통화
                <select
                  className={inputClass}
                  value={doc.inputs.unit_price_currency}
                  onChange={(e) => input("unit_price_currency", e.target.value)}
                >
                  <option>CNY</option>
                  <option>USD</option>
                </select>
              </label>
              <label className="text-sm">
                개당 원가
                <input
                  type="number"
                  min="0"
                  step="any"
                  className={inputClass}
                  value={doc.inputs.unit_price_per_piece ?? ""}
                  onChange={(e) =>
                    input("unit_price_per_piece", e.target.value)
                  }
                />
              </label>
              <label className="text-sm">
                환율 (CNY / USD)
                <input
                  type="number"
                  min="0"
                  step="any"
                  className={inputClass}
                  value={doc.inputs.fx_cny_per_usd ?? ""}
                  onChange={(e) => input("fx_cny_per_usd", e.target.value)}
                />
              </label>
              <label className="text-sm">
                매출총이익률 (%)
                <input
                  type="number"
                  min="0"
                  max="99.99"
                  step="any"
                  className={inputClass}
                  value={doc.inputs.margin_pct ?? ""}
                  onChange={(e) => input("margin_pct", e.target.value)}
                />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              최종 USD 오퍼 = 보정 원가(없으면 기본 원가) ÷ 환율 ÷ (1 −
              매출총이익률). USD 원가는 환율 1을 적용합니다. 보정란은 원가 보정
              값입니다.
            </p>
            <div className="flex flex-wrap gap-3">
              {moqs.map((m) => (
                <label key={m} className="text-sm">
                  {m.toLocaleString()} pkg 포장비
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className={inputClass}
                    value={
                      doc.packages[pkg]?.packaging_costs.find(
                        (r) => r.moq === m,
                      )?.packaging_cost_per_pkg ?? ""
                    }
                    onChange={(e) =>
                      change((d) => {
                        const p = d.packages[pkg];
                        let r = p.packaging_costs.find((r) => r.moq === m);
                        if (!r) {
                          r = { moq: m, packaging_cost_per_pkg: null };
                          p.packaging_costs.push(r);
                        }
                        r.packaging_cost_per_pkg =
                          e.target.value === "" ? null : Number(e.target.value);
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded border px-3 py-2 text-sm"
                onClick={calculate}
              >
                원가 계산 (PCS × 개당 원가 + 포장비)
              </button>
              <input
                type="number"
                min="1"
                max="1000"
                className="w-24 rounded border px-2"
                placeholder="PCS"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
              <button
                className="rounded border px-3 py-2 text-sm"
                onClick={() => {
                  const n = Number(custom);
                  if (!Number.isInteger(n) || n < 1 || n > 1000) return;
                  change((d) => {
                    for (const m of moqs)
                      if (
                        !d.packages[pkg].cells.some(
                          (c) => c.pcs_per_pkg === n && c.moq_packages === m,
                        )
                      )
                        d.packages[pkg].cells.push({
                          package_code: pkg,
                          pcs_per_pkg: n,
                          moq_packages: m,
                          price_fob_per_pkg: null,
                          override_price_fob_per_pkg: null,
                          offer_usd: null,
                        });
                  });
                  setCustom("");
                }}
              >
                PCS 추가
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="p-2 text-left">PCS/PKG</th>
                    {moqs.map((m) => (
                      <th key={m} className="p-2 text-left">
                        MOQ {m.toLocaleString()} pkg
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pcsList().map((pcs) => (
                    <tr key={pcs} className="border-t">
                      <td className="p-2">{pcs}</td>
                      {moqs.map((m) => {
                        const c = cell(pcs, m),
                          offer = offerUsd(
                            c?.override_price_fob_per_pkg ??
                              c?.price_fob_per_pkg ??
                              null,
                            doc.inputs,
                          );
                        return (
                          <td key={m} className="min-w-[170px] space-y-1 p-2">
                            <label className="block text-xs">
                              기본 원가 ({doc.inputs.unit_price_currency})
                              <input
                                type="number"
                                min="0"
                                step="any"
                                className={inputClass}
                                value={c?.price_fob_per_pkg ?? ""}
                                onChange={(e) =>
                                  editCell(
                                    pcs,
                                    m,
                                    "price_fob_per_pkg",
                                    e.target.value,
                                  )
                                }
                              />
                            </label>
                            <label className="block text-xs">
                              보정 원가 (Override)
                              <input
                                type="number"
                                min="0"
                                step="any"
                                className={inputClass}
                                value={c?.override_price_fob_per_pkg ?? ""}
                                onChange={(e) =>
                                  editCell(
                                    pcs,
                                    m,
                                    "override_price_fob_per_pkg",
                                    e.target.value,
                                  )
                                }
                              />
                            </label>
                            <div className="font-medium">
                              Offer USD / pkg:{" "}
                              {offer == null ? "—" : offer.toFixed(2)}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
              disabled={busy || !editable}
              onClick={() => void save()}
            >
              {busy ? "처리 중…" : "원가·환율·오퍼 함께 저장"}
            </button>
            <span className="text-sm text-muted-foreground">
              {dirty
                ? "저장하지 않은 변경이 있습니다."
                : version?.status === "DRAFT"
                  ? "저장한 가격으로 출력합니다."
                  : "발송/확정본은 조회 전용입니다."}
            </span>
            <button
              className="rounded border px-3 py-2 text-sm disabled:opacity-50"
              disabled={busy || dirty || !editable || revision === 0}
              onClick={() => void sent()}
            >
              발송본 기록 · 잠금
            </button>
          </div>
        </>
      )}
    </div>
  );
}
