'use client';

import * as React from "react";
import { RED_MOQS, RED_PCS_PRESET, buildIndex, diffCell, isChanged, unionPCS, keyOf, type MatrixCell } from "@/lib/redQuotationDiff";

type VersionRow = {
  id: string;
  version_no: number;
  status: string;
};

type Props = {
  quotationId: string;
  versions: VersionRow[];
  onChanged: () => void;
};

export default function CompareDiffTab({ versions, onChanged }: Props) {
  const [baseId, setBaseId] = React.useState("");
  const [targetId, setTargetId] = React.useState("");
  const [baseCells, setBaseCells] = React.useState<MatrixCell[]>([]);
  const [targetCells, setTargetCells] = React.useState<MatrixCell[]>([]);
  const [fobBase, setFobBase] = React.useState<Record<number, number | null>>({});
  const [fobTarget, setFobTarget] = React.useState<Record<number, number | null>>({});
  const [loading, setLoading] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  const [changedOnly, setChangedOnly] = React.useState(true);
  const [showPct, setShowPct] = React.useState(false);
  const [customPcs, setCustomPcs] = React.useState("");

  const [pcsFilter, setPcsFilter] = React.useState<number[] | null>(null); // null => all
  const preset = (RED_PCS_PRESET as unknown as number[]);

  // default selection: base=latest SENT/CONFIRMED else latest, target=latest DRAFT else latest
  React.useEffect(() => {
    if (versions.length === 0) return;

    const latest = versions[versions.length - 1];
    const target = [...versions].reverse().find((v) => v.status === "DRAFT") || latest;
    const base =
      [...versions].reverse().find((v) => v.status === "SENT" || v.status === "CONFIRMED") ||
      (versions.length >= 2 ? versions[versions.length - 2] : latest);

    setBaseId(base.id);
    setTargetId(target.id);
  }, [versions]);

  async function loadMatrix(versionId: string) {
    const r = await fetch(`/api/red/quotation-versions/${versionId}/matrix?package=A`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || "Failed");
    return (j.data || []) as MatrixCell[];
  }

  async function loadBoth() {
    if (!baseId || !targetId) return;
    setLoading(true);
    setMsg(null);
    try {
      const [b, t] = await Promise.all([loadMatrix(baseId), loadMatrix(targetId)]);
      setBaseCells(b);
      setTargetCells(t);
    } catch (e: any) {
      setMsg(e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { loadBoth(); /* eslint-disable-next-line */ }, [baseId, targetId]);

  const baseIdx = React.useMemo(() => buildIndex(baseCells), [baseCells]);
  const targetIdx = React.useMemo(() => buildIndex(targetCells), [targetCells]);

  const allPCS = React.useMemo(() => {
    const u = unionPCS(baseCells, targetCells);
    // ensure preset always visible even if empty
    const set = new Set<number>(u);
    for (const p of preset) set.add(p);
    const list = Array.from(set).sort((a, b) => a - b);
    return list;
  }, [baseCells, targetCells]);

  const rowsPCS = React.useMemo(() => {
    const list = pcsFilter && pcsFilter.length > 0 ? allPCS.filter((p) => pcsFilter.includes(p)) : allPCS;
    return list;
  }, [allPCS, pcsFilter]);

  const changedList = React.useMemo(() => {
    const items: { pcs: number; moq: number; base: number | null; target: number | null; state: string; delta: number | null; pct: number | null }[] = [];
    for (const pcs of allPCS) {
      for (const moq of RED_MOQS) {
        const k = keyOf("A", pcs, moq);
        const d = diffCell(baseIdx.get(k), targetIdx.get(k));
        if (!isChanged(d)) continue;

        const pct =
          d.state === "UP" || d.state === "DOWN"
            ? d.base !== 0
              ? ((d.target - d.base) / d.base) * 100
              : null
            : null;

        items.push({ pcs, moq, base: (d as any).base ?? null, target: (d as any).target ?? null, state: d.state, delta: (d as any).delta ?? null, pct });
      }
    }
    return items.sort((a, b) => a.pcs - b.pcs || a.moq - b.moq);
  }, [allPCS, baseIdx, targetIdx]);

  const hasRemoved = changedList.some((x) => x.state === "REMOVED");

  async function createRevisionFromTarget() {
    if (!targetId) return;
    setLoading(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/red/quotation-versions/${targetId}/revision`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed");
      // refresh versions on parent and auto-select new target
      await onChanged();
      // we cannot know new list yet; optimistic set after reload by fetching versions again is handled by parent refresh.
      setMsg(`Created v${j.data.version_no}. Select it as Target.`);
    } catch (e: any) {
      setMsg(e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }

  function togglePreset(p: number) {
    setPcsFilter((prev) => {
      const cur = prev ? [...prev] : [];
      if (cur.includes(p)) return cur.filter((x) => x !== p);
      cur.push(p);
      return cur;
    });
  }

  function addCustomFilter() {
    const n = Number(customPcs);
    if (!Number.isFinite(n)) return;
    const pcs = Math.max(1, Math.min(20, Math.trunc(n)));
    setPcsFilter((prev) => {
      const cur = prev ? [...prev] : [];
      if (!cur.includes(pcs)) cur.push(pcs);
      return cur.sort((a, b) => a - b);
    });
    setCustomPcs("");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Base</div>
          <select className="border rounded px-2 py-1 text-sm" value={baseId} onChange={(e) => setBaseId(e.target.value)}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>v{v.version_no} ({v.status})</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Target</div>
          <select className="border rounded px-2 py-1 text-sm" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>v{v.version_no} ({v.status})</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">PCS filter</div>
          <div className="flex gap-1 flex-wrap">
            {preset.map((p) => {
              const active = pcsFilter ? pcsFilter.includes(p) : false;
              return (
                <button key={p} className={`border rounded px-2 py-1 text-xs ${active ? "bg-muted" : "hover:bg-muted/50"}`} onClick={() => togglePreset(p)}>
                  {p}
                </button>
              );
            })}
            <div className="flex gap-1 items-center ml-2">
              <input className="border rounded px-2 py-1 text-xs w-16" value={customPcs} onChange={(e) => setCustomPcs(e.target.value)} placeholder="5" />
              <button className="border rounded px-2 py-1 text-xs hover:bg-muted/50" onClick={addCustomFilter}>
                Add
              </button>
              <button className="border rounded px-2 py-1 text-xs hover:bg-muted/50" onClick={() => setPcsFilter(null)}>
                All
              </button>
            </div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} />
            Changed only
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showPct} onChange={(e) => setShowPct(e.target.checked)} />
            % change
          </label>

          <button className="border rounded px-3 py-1.5 text-sm hover:bg-muted" onClick={loadBoth} disabled={loading}>
            Reload
          </button>
          <button className="border rounded px-3 py-1.5 text-sm hover:bg-muted" onClick={createRevisionFromTarget} disabled={loading}>
            Create Revision from Target
          </button>
        </div>
      </div>

      {hasRemoved ? (
        <div className="text-sm text-amber-700 border border-amber-300 bg-amber-50 rounded p-3">
          REMOVED cells exist in Target. Buyer confusion risk. (Prefer creating a new revision instead of removing.)
        </div>
      ) : null}

      {msg ? <div className="text-sm">{msg}</div> : null}

      {/* Diff grid */}
      {!changedOnly ? (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-2 w-24">PCS</th>
                {RED_MOQS.map((m) => (
                  <th key={m} className="text-left p-2">{m.toLocaleString()} pkg</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowsPCS.map((pcs) => (
                <tr key={pcs} className="border-t">
                  <td className="p-2 font-medium">{pcs} pcs</td>
                  {RED_MOQS.map((moq) => {
                    const k = keyOf("A", pcs, moq);
                    const d = diffCell(baseIdx.get(k), targetIdx.get(k));

                    const base = (d as any).base ?? null;
                    const target = (d as any).target ?? null;

                    let note = "(–)";
                    if (d.state === "UP") note = `▲ ${(d as any).delta.toFixed(2)}`;
                    if (d.state === "DOWN") note = `▼ ${Math.abs((d as any).delta).toFixed(2)}`;
                    if (d.state === "NEW") note = "NEW";
                    if (d.state === "REMOVED") note = "REMOVED";

                    const pct =
                      showPct && (d.state === "UP" || d.state === "DOWN") && base
                        ? ` (${(((target - base) / base) * 100).toFixed(1)}%)`
                        : "";

                    return (
                      <td key={moq} className="p-2">
                        <div className="flex flex-col leading-tight">
                          <div>
                            <span className="tabular-nums">{base === null ? "–" : base.toFixed(2)}</span>
                            {" "}→{" "}
                            <span className="tabular-nums">{target === null ? "–" : target.toFixed(2)}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">{note}{pct}</div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Changed-only list (always includes NEW/REMOVED) */}
      <div className="border rounded-lg overflow-hidden">
        
        <div className="mt-4 border rounded-lg p-4">
          <div className="text-sm font-medium">FOB per pkg changes (MOQ only)</div>
          <div className="text-xs text-muted-foreground">
            PCS와 무관한 MOQ별 기본 패키지 FOB(/pkg) 변경만 따로 표시합니다.
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm border">
              <thead>
                <tr className="bg-muted/40">
                  <th className="text-left p-2 border">MOQ</th>
                  <th className="text-left p-2 border">Base</th>
                  <th className="text-left p-2 border">Target</th>
                  <th className="text-left p-2 border">Δ</th>
                </tr>
              </thead>
              <tbody>
                {[1000, 3000, 5000].map((moq) => {
                  const b = fobBase?.[moq] ?? null;
                  const t = fobTarget?.[moq] ?? null;
                  const changed = (b ?? "") !== (t ?? "");
                  if (changedOnly && !changed) return null;
                  const delta = b == null || t == null ? null : t - b;
                  return (
                    <tr key={moq}>
                      <td className="p-2 border">{moq.toLocaleString()} pkg</td>
                      <td className="p-2 border">{b == null ? "" : b.toFixed(4)}</td>
                      <td className="p-2 border">{t == null ? "" : t.toFixed(4)}</td>
                      <td className="p-2 border">{delta == null ? "" : delta.toFixed(4)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

<div className="p-2 bg-muted text-sm font-medium">Changed Cells</div>
        <table className="w-full text-sm">
          <thead className="bg-muted/60">
            <tr>
              <th className="text-left p-2 w-20">PCS</th>
              <th className="text-left p-2 w-24">MOQ</th>
              <th className="text-left p-2">Base</th>
              <th className="text-left p-2">Target</th>
              <th className="text-left p-2 w-28">Δ</th>
            </tr>
          </thead>
          <tbody>
            {changedList
              .filter((x) => (pcsFilter && pcsFilter.length > 0 ? pcsFilter.includes(x.pcs) : true))
              .map((x, idx) => (
                <tr key={`${x.pcs}-${x.moq}-${idx}`} className="border-t">
                  <td className="p-2 font-medium">{x.pcs}</td>
                  <td className="p-2">{x.moq.toLocaleString()}</td>
                  <td className="p-2 tabular-nums">{x.base === null ? "–" : x.base.toFixed(2)}</td>
                  <td className="p-2 tabular-nums">{x.target === null ? "–" : x.target.toFixed(2)}</td>
                  <td className="p-2">
                    {x.state === "NEW" ? (
                      <span className="text-emerald-700 font-medium">NEW</span>
                    ) : x.state === "REMOVED" ? (
                      <span className="text-amber-700 font-medium">REMOVED</span>
                    ) : x.delta !== null ? (
                      <span className={`font-medium ${x.delta < 0 ? "text-amber-700" : "text-emerald-700"}`}>
                        {x.delta < 0 ? "▼" : "▲"} {Math.abs(x.delta).toFixed(2)}
                        {showPct && x.pct !== null ? <span className="text-xs text-muted-foreground"> ({x.pct.toFixed(1)}%)</span> : null}
                      </span>
                    ) : (
                      "–"
                    )}
                  </td>
                </tr>
              ))}
            {changedList.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No changes.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
