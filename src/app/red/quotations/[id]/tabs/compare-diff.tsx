"use client";
import * as React from "react";
import { sortedVersions } from "@/lib/redQuoteDocument";
import {
  buildIndex,
  keyOf,
  diffCell,
  type MatrixCell,
} from "@/lib/redQuotationDiff";
type Version = { id: string; version_no: number; status: string };
export default function CompareDiffTab({
  versions,
  onChanged,
  canCreate = true,
}: {
  quotationId: string;
  versions: Version[];
  onChanged: () => void | Promise<void>;
  canCreate?: boolean;
}) {
  const [base, setBase] = React.useState(""),
    [target, setTarget] = React.useState(""),
    [b, setB] = React.useState<MatrixCell[]>([]),
    [t, setT] = React.useState<MatrixCell[]>([]),
    [msg, setMsg] = React.useState(""),
    [busy, setBusy] = React.useState(false),
    [changed, setChanged] = React.useState(true),
    [pkg, setPkg] = React.useState("A"),
    [packages, setPackages] = React.useState<string[]>(["A"]),
    [loaded, setLoaded] = React.useState(false);
  React.useEffect(() => {
    const s = sortedVersions(versions);
    if (!s.length) return;
    setTarget((p) =>
      s.some((v) => v.id === p)
        ? p
        : s.find((v) => v.status === "DRAFT")?.id || s[0].id,
    );
    setBase((p) =>
      s.some((v) => v.id === p)
        ? p
        : s.find((v) => v.status === "SENT" || v.status === "CONFIRMED")?.id ||
          s[1]?.id ||
          s[0].id,
    );
  }, [versions]);
  const seq = React.useRef(0);
  async function load() {
    if (!base || !target) return;
    const token = ++seq.current;
    setBusy(true);
    setLoaded(false);
    setMsg("");
    try {
      const read = async (id: string) => {
        const r = await fetch(
            "/api/red/quotation-versions/" + id + "/document",
            { cache: "no-store" },
          ),
          j = await r.json();
        if (!r.ok) throw new Error(j.error);
        return j;
      };
      const [a, z] = await Promise.all([read(base), read(target)]);
      if (token !== seq.current) return;
      setB(
        Object.values(a.document.packages).flatMap(
          (p: any) => p.cells,
        ) as MatrixCell[],
      );
      setT(
        Object.values(z.document.packages).flatMap(
          (p: any) => p.cells,
        ) as MatrixCell[],
      );
      const codes = [
        ...new Set([
          ...Object.keys(a.document.packages),
          ...Object.keys(z.document.packages),
        ]),
      ];
      setPackages(codes);
      setPkg((p) => (codes.includes(p) ? p : codes[0]));
      setLoaded(true);
      if (a.legacy || z.legacy)
        setMsg(
          "기존 버전에는 환율·마진이 보존되지 않았습니다. 최종 USD 가격을 복원할 수 없는 항목은 확인 필요로 표시합니다.",
        );
    } catch (e: any) {
      if (token === seq.current) {
        setB([]);
        setT([]);
        setMsg(e.message);
      }
    } finally {
      if (token === seq.current) setBusy(false);
    }
  }
  React.useEffect(() => {
    void load();
    return () => {
      seq.current++;
    };
  }, [base, target]);
  const bi = buildIndex(b),
    ti = buildIndex(t),
    keys = [
      ...new Set(
        [...b, ...t]
          .filter((c) => c.package_code === pkg)
          .map((c) => keyOf(c.package_code, c.pcs_per_pkg, c.moq_packages)),
      ),
    ];
  const rows = keys
    .map((k) => {
      const a = bi.get(k),
        z = ti.get(k),
        c = z || a!;
      const d = diffCell(a, z);
      const costChanged =
        (a?.price_fob_per_pkg ?? null) !== (z?.price_fob_per_pkg ?? null) ||
        (a?.override_price_fob_per_pkg ?? null) !== (z?.override_price_fob_per_pkg ?? null);
      const missing =
        (!!a &&
          (a.override_price_fob_per_pkg ?? a.price_fob_per_pkg) != null &&
          a.offer_usd == null) ||
        (!!z &&
          (z.override_price_fob_per_pkg ?? z.price_fob_per_pkg) != null &&
          z.offer_usd == null);
      return { k, c, d, costChanged, missing };
    })
    .sort(
      (a, z) =>
        a.c.pcs_per_pkg - z.c.pcs_per_pkg ||
        a.c.moq_packages - z.c.moq_packages,
    );
  const visible = rows.filter(
    (r) => !changed || r.d.state !== "SAME" || r.costChanged || r.missing,
  );
  async function copy() {
    const reason = window.prompt("수정 이유 / 네고 내용 (선택)", "");
    if (reason === null) return;
    setBusy(true);
    try {
      const r = await fetch(
          "/api/red/quotation-versions/" + target + "/revision",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ change_summary: reason }),
          },
        ),
        j = await r.json();
      if (!r.ok) throw new Error(j.error);
      await onChanged();
      setTarget(j.data.id);
      setMsg(
        "수정본을 만들었습니다. Matrix 탭에서 새 버전을 선택해 편집할 수 있습니다.",
      );
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }
  const fmt = (n: number | null) => (n == null ? "—" : n.toFixed(2));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {[
          ["Base", base, setBase],
          ["Target", target, setTarget],
        ].map(([label, value, setter]) => (
          <label key={label as string} className="text-sm">
            {label as string}
            <select
              className="block rounded border bg-background px-2 py-2"
              value={value as string}
              disabled={busy}
              onChange={(e) => (setter as (v: string) => void)(e.target.value)}
            >
              {sortedVersions(versions).map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version_no} ({v.status})
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="text-sm">
          패키지
          <select
            className="block rounded border bg-background px-2 py-2"
            value={pkg}
            onChange={(e) => setPkg(e.target.value)}
          >
            {packages.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <input
            type="checkbox"
            checked={changed}
            onChange={(e) => setChanged(e.target.checked)}
          />{" "}
          변경/확인 필요 항목만
        </label>
        <button
          className="rounded border px-3 py-2 text-sm"
          disabled={busy}
          onClick={() => void load()}
        >
          Reload
        </button>
        <button
          className="rounded border px-3 py-2 text-sm"
          disabled={busy || !target || !canCreate}
          onClick={() => void copy()}
        >
          Target으로 수정 견적 만들기
        </button>
      </div>
      {msg && (
        <p role="status" className="rounded border p-3 text-sm">
          {msg}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        비교 기준: 저장된 최종 USD 오퍼 / pkg. 원가 보정만 바뀐 경우도
        표시합니다.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted">
              <th className="p-2 text-left">PCS/PKG</th>
              <th className="p-2 text-left">MOQ PKG</th>
              <th className="p-2 text-left">Base USD</th>
              <th className="p-2 text-left">Target USD</th>
              <th className="p-2 text-left">변경</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ k, c, d, costChanged, missing }) => (
              <tr key={k} className="border-t">
                <td className="p-2">{c.pcs_per_pkg}</td>
                <td className="p-2">{c.moq_packages.toLocaleString()}</td>
                <td className="p-2">{fmt(d.base)}</td>
                <td className="p-2">{fmt(d.target)}</td>
                <td className="p-2">
                  {missing
                    ? "환율·마진 / 최종 오퍼 확인 필요"
                    : d.state === "SAME"
                      ? costChanged
                        ? "원가/보정 변경 · 오퍼 동일"
                        : "동일"
                      : d.delta == null
                        ? d.state
                        : (d.delta > 0 ? "+" : "") + d.delta.toFixed(2)}
                  {costChanged && d.state !== "SAME" && !missing
                    ? " · 원가/보정 변경"
                    : ""}
                </td>
              </tr>
            ))}
            {!visible.length && (
              <tr>
                <td
                  colSpan={5}
                  className="p-6 text-center text-muted-foreground"
                >
                  {busy
                    ? "불러오는 중…"
                    : loaded
                      ? "비교할 변경 항목이 없습니다."
                      : "버전을 불러와 주세요."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
