'use client';

import * as React from "react";
import { RED_MOQS, RED_PCS_PRESET } from "@/lib/redQuotationDiff";

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

type CostsPayload = {
  cost_inputs: {
    unit_price_per_piece: number | null;
    unit_price_currency: string | null;
  } | null;
  packaging_costs: { moq: number; packaging_cost_per_pkg: number | null }[];
};

type MatrixPayload = {
  package: string;
  moqs: number[];
  pcs: number[];
  cells: Record<string, number | null>;
};

/**
 * Simple Matrix editor:
 * - Select a Target version
 * - If Target is DRAFT, you can edit prices and Save
 * - Add custom PCS (1..20) which will create empty rows (upsert)
 */
export default function MatrixTab({ quotationId, versions, onChanged }: Props) {
  const [targetId, setTargetId] = React.useState<string>("");
  const [targetStatus, setTargetStatus] = React.useState<string>("");

// Ship From (선적지) - RED Quotation header의 ship_from_code에 저장
const [shipFromCode, setShipFromCode] = React.useState<string>("");
const [shipFromOptions, setShipFromOptions] = React.useState<{ code: string; name: string }[]>([]);
const [shipFromLoading, setShipFromLoading] = React.useState(false);

async function loadShipFrom() {
  if (!quotationId) return;
  setShipFromLoading(true);
  try {
    const r = await fetch(`/api/red/quotations/${quotationId}/ship-from`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || "Failed to load Ship From");
    setShipFromCode(j?.data?.ship_from_code || "");
    setShipFromOptions(j?.data?.options || []);
  } catch (e: any) {
    // non-fatal
    setMsg(e?.message || "Failed to load Ship From");
  } finally {
    setShipFromLoading(false);
  }
}

async function saveShipFrom(next: string) {
  if (!quotationId) return;
  setShipFromCode(next);
  try {
    const r = await fetch(`/api/red/quotations/${quotationId}/ship-from`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ship_from_code: next }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || "Failed to save Ship From");
    onChanged();
  } catch (e: any) {
    setMsg(e?.message || "Failed to save Ship From");
  }
}


  // Auto-calc inputs (unit price + packaging cost by MOQ)
  const [unitPrice, setUnitPrice] = React.useState<string>("");
  const [unitCurrency, setUnitCurrency] = React.useState<string>("CNY");
  const [packCosts, setPackCosts] = React.useState<Record<number, string>>({});

  
  // FX + Margin for Offer USD preview (shown only when Currency=CNY)
  const [fxCnyPerUsd, setFxCnyPerUsd] = React.useState<string>("");
  const [marginPct, setMarginPct] = React.useState<string>("");

  // Override cells (final price override in CNY). Empty means use base CNY.
  const [overrides, setOverrides] = React.useState<Record<string, string>>({});
// helper: update packaging cost by MOQ
  // (v65 runtime error fix) setPackCost was referenced in JSX but not defined.
  function setPackCost(moq: number, val: string) {
    setPackCosts((prev) => ({ ...prev, [moq]: val }));
  }

  const [pcsRows, setPcsRows] = React.useState<number[]>([]);
  const [cells, setCells] = React.useState<Record<string, string>>({});
  const [autoFill, setAutoFill] = React.useState<boolean>(true);
  const [loading, setLoading] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [customPcs, setCustomPcs] = React.useState("");

  function key(pcs: number, moq: number) {
    return `${pcs}::${moq}`;
  }

  function fmt2(n: number) {
    // UI rule: show 2 decimals
    if (!Number.isFinite(n)) return "";
    return n.toFixed(2);
  }

  

  function toNum(v: any): number | null {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : null;
  }

  // A안: margin = (Price - Cost) / Price  =>  Price = Cost / (1 - margin)
  function calcOfferUsdFromFinalCny(finalRaw: any): number | null {
    if (unitCurrency !== "CNY") return null; // 요청: CNY일 때만 표시
    const cny = toNum(finalRaw);
    const fx = toNum(fxCnyPerUsd);
    const mPct = toNum(marginPct);
    if (cny == null || fx == null || fx <= 0 || mPct == null) return null;
    const m = mPct / 100;
    if (m >= 0.999999) return null;
    const costUsd = cny / fx;
    const offerUsd = costUsd / (1 - m);
    return Number.isFinite(offerUsd) ? offerUsd : null;
  }
// pick default target: latest DRAFT, else latest
  React.useEffect(() => {
    if (versions.length === 0) return;
    const draft = [...versions].reverse().find((v) => v.status === "DRAFT");
    const v = draft || versions[versions.length - 1];
    setTargetId(v.id);
    setTargetStatus(v.status);
  }, [versions]);

  async function loadMatrix(versionId: string) {
    setLoading(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/red/quotation-versions/${versionId}/matrix?package=A`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed");
      const list = j.data || [];
      const pcsSet = new Set<number>(RED_PCS_PRESET as unknown as number[]);
      for (const c of list) pcsSet.add(c.pcs_per_pkg);

      const rows = Array.from(pcsSet).sort((a, b) => a - b);
      setPcsRows(rows);

      const next: Record<string, string> = {};
      for (const c of list) {
        next[key(c.pcs_per_pkg, c.moq_packages)] =
          c.price_fob_per_pkg === null ? "" : fmt2(Number(c.price_fob_per_pkg));
      }
      setCells(next);

      const ovr: Record<string, string> = {};
      for (const c of list) {
        const v = (c as any).override_price_fob_per_pkg;
        if (v !== null && v !== undefined) {
          const k = key(c.pcs_per_pkg, c.moq_packages);
          ovr[k] = v === null ? "" : fmt2(Number(v));
        }
      }
      setOverrides(ovr);
} catch (e: any) {
      setMsg(e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }

    React.useEffect(() => { loadShipFrom(); }, [quotationId]);

React.useEffect(() => {
    if (!targetId) return;
    const v = versions.find((x) => x.id === targetId);
    setTargetStatus(v?.status || "");
    loadCosts(targetId);
    loadMatrix(targetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  async function loadCosts(versionId: string) {
    try {
      const r = await fetch(`/api/red/quotation-versions/${versionId}/costs?package=A`);
      const j: any = await r.json();
      if (!r.ok) {
        // Keep UI usable even if costs table is missing
        setMsg(j?.error || "Failed to load inputs");
        return;
      }
      const data = j as CostsPayload;
      const up = data?.cost_inputs?.unit_price_per_piece;
      setUnitPrice(up == null ? "" : String(up));
      setUnitCurrency(data?.cost_inputs?.unit_price_currency || "CNY");
      const nextPack: Record<number, string> = {};
      for (const moq of RED_MOQS) {
        const row = data?.packaging_costs?.find((x) => Number(x.moq) === Number(moq));
        const v = row?.packaging_cost_per_pkg;
        nextPack[Number(moq)] = v == null ? "" : String(v);
      }
      setPackCosts(nextPack);
    } catch (e: any) {
      setMsg(e?.message || "Failed to load inputs");
    }
  }

  async function saveCosts() {
    const payload: any = {
      package_code: "A",
      cost_inputs: {
        unit_price_per_piece: unitPrice === "" ? null : Number(unitPrice),
        unit_price_currency: unitCurrency,
      },
      packaging_costs: RED_MOQS.map((moq) => ({
        moq_packages: moq,
        packaging_cost_per_pkg: (packCosts[Number(moq)] ?? "") === "" ? null : Number(packCosts[Number(moq)]),
      })),
    };
    const r = await fetch(`/api/red/quotation-versions/${targetId}/costs?package=A`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || "Failed to save inputs");
  }

  async function saveMatrixFrom(map: Record<string, string>) {
    if (!targetId) return;

    const payloadCells: {
  pcs_per_pkg: number;
  moq_packages: number;
  price_fob_per_pkg: number | null;
  override_price_fob_per_pkg?: number | null;
}[] = [];
    for (const pcs of pcsRows) {
      for (const moq of RED_MOQS) {
        const raw = map[key(pcs, moq)] ?? "";
        const num = raw === "" ? NaN : Number(raw);
        payloadCells.push({
          pcs_per_pkg: pcs,
          moq_packages: moq,
          price_fob_per_pkg: Number.isFinite(num) ? Math.round(num * 100) / 100 : null,
          override_price_fob_per_pkg:
            (overrides[key(pcs, moq)] ?? "") === ""
              ? null
              : (Number.isFinite(Number(overrides[key(pcs, moq)])) ? Math.round(Number(overrides[key(pcs, moq)]) * 100) / 100 : null),
        });
}
    }

    const r = await fetch(`/api/red/quotation-versions/${targetId}/matrix`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ package_code: "A", cells: payloadCells }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || "Failed");
  }

  async function autoFillMatrix() {
    // 계산: FOB/pkg = PCS * UnitPrice + PackagingCost(MOQ)
    const up = unitPrice === "" ? null : Number(unitPrice);
    if (up == null || !Number.isFinite(up)) {
      setMsg("Unit Price (per 1pc) 먼저 입력하세요.");
      return;
    }
    const next: Record<string, string> = { ...cells };
    for (const pcs of pcsRows) {
      for (const moq of RED_MOQS) {
        const pc = (packCosts[Number(moq)] ?? "") === "" ? null : Number(packCosts[Number(moq)]);
        if (pc == null || !Number.isFinite(pc)) continue;
        const v = pcs * up + pc;
        next[key(pcs, moq)] = Number.isFinite(v) ? fmt2(v) : "";
      }
    }
    setCells(next);
    try {
      setLoading(true);
      setMsg(null);
      await saveCosts();
      await saveMatrixFrom(next);
      await loadMatrix(targetId);
      setMsg("Auto-filled and saved.");
    } catch (e: any) {
      setMsg(e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }

  function setCell(pcs: number, moq: number, v: string) {
    setCells((prev) => ({ ...prev, [key(pcs, moq)]: v }));
  }

  

  function setOverride(pcs: number, moq: number, v: string) {
    setOverrides((prev) => ({ ...prev, [key(pcs, moq)]: v }));
  }
async function save() {
    setLoading(true);
    setMsg(null);
    try {
      // Save inputs first (unit price + packaging by MOQ)
      await saveCosts();

      // Save matrix values
      await saveMatrixFrom(cells);

      setMsg("Saved.");
      onChanged();
      await loadMatrix(targetId);
    } catch (e: any) {
      setMsg(e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }

  function addCustom() {
    const n = Number(customPcs);
    if (!Number.isFinite(n)) return;
    const pcs = Math.max(1, Math.min(20, Math.trunc(n)));
    if (pcsRows.includes(pcs)) return;
    setPcsRows((prev) => [...prev, pcs].sort((a, b) => a - b));
    setCustomPcs("");
  }

  const editable = targetStatus === "DRAFT";

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Target Version</div>
          <select className="border rounded px-2 py-1 text-sm" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>v{v.version_no} ({v.status})</option>
            ))}
          </select>
        
<div className="space-y-1">
  <div className="text-xs text-muted-foreground">Ship From</div>
  <select
    className="border rounded px-2 py-1 text-sm min-w-[220px]"
    value={shipFromCode}
    onChange={(e) => saveShipFrom(e.target.value)}
    disabled={shipFromLoading}
  >
    <option value="">{shipFromLoading ? "Loading..." : "Select ship from"}</option>
    {shipFromOptions.map((o) => (
      <option key={o.code} value={o.code}>
        {o.code} — {o.name}
      </option>
    ))}
  </select>
</div>

</div>

        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Add custom PCS (1..20)</div>
          <div className="flex gap-2">
            <input className="border rounded px-2 py-1 text-sm w-28" value={customPcs} onChange={(e) => setCustomPcs(e.target.value)} placeholder="5" />
            <button className="border rounded px-3 py-1.5 text-sm hover:bg-muted" onClick={addCustom} disabled={!editable}>
              Add
            </button>
          </div>
        </div>

        <div className="ml-auto flex gap-2">
          <button className="border rounded px-3 py-1.5 text-sm hover:bg-muted" onClick={() => loadMatrix(targetId)} disabled={loading}>
            Reload
          </button>

<button
  className="border rounded px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
  onClick={async () => {
    if (!targetId) return;
    setLoading(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/red/quotations/${quotationId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from_version_id: targetId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed to create new version");
      const newId = j?.data?.id;
      if (newId) {
        setTargetId(newId);
        setMsg(`Created v${j?.data?.version_no || ""}.`);
        onChanged();
      } else {
        setMsg("Created new version.");
        onChanged();
      }
    } catch (e: any) {
      setMsg(e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }}
  disabled={loading || !quotationId || !targetId}
  title="v2/v3... 새 버전 생성 (이전 버전 복사)"
>
  Create New Version
</button>

<button
  className="border rounded px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
  onClick={() => {
    if (!targetId) return;
    window.open(`/red/quotation-versions/${targetId}/pdf?package=A`, "_blank", "noopener,noreferrer");
  }}
  disabled={!targetId}
>
  PDF
</button>

<button
  className="border rounded px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
  onClick={() => {
    if (!targetId) return;
    window.open(`/api/red/quotation-versions/${targetId}/excel?package=A`, "_blank", "noopener,noreferrer");
  }}
  disabled={!targetId}
>
  Excel
</button>

          <button className="border rounded px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50" onClick={save} disabled={!editable || loading}>
            Save (DRAFT only)
          </button>
        </div>
      </div>

      {!editable ? (
        <div className="text-sm text-amber-700 border border-amber-300 bg-amber-50 rounded p-3">
          Target version is locked (not DRAFT). Create a new revision to edit.
        </div>
      ) : null}

      {msg ? <div className="text-sm">{msg}</div> : null}

      
    <div className="border rounded-lg p-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm font-medium">Auto-calc Inputs</div>
          <div className="text-xs text-muted-foreground">
            1개당 단가(Unit Price) + MOQ별 Packaging(/pkg) 입력 → 아래 Matrix는 자동 계산으로 채웁니다.
            <span className="ml-2">Formula: FOB/pkg = PCS × UnitPrice + PackagingCost(MOQ)</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-xs text-muted-foreground">Currency</div>
          <select className="border rounded px-2 py-1 text-sm" value={unitCurrency} onChange={(e) => setUnitCurrency(e.target.value)}>
            {["USD", "CNY"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-xs text-muted-foreground">FX (CNY per 1 USD)</div>
          <input
            className="border rounded px-2 py-1 text-sm w-32"
            value={fxCnyPerUsd}
            onChange={(e) => setFxCnyPerUsd(e.target.value)}
            inputMode="decimal"
            placeholder="e.g. 7.20"
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="text-xs text-muted-foreground">Margin %</div>
          <input
            className="border rounded px-2 py-1 text-sm w-24"
            value={marginPct}
            onChange={(e) => setMarginPct(e.target.value)}
            inputMode="decimal"
            placeholder="e.g. 35"
          />
        </div>

      </div>

      <div className="mt-3 flex flex-col gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-sm font-medium">Unit Price (per 1pc)</div>
          <input
            className="border rounded px-2 py-1 text-sm w-40"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            inputMode="decimal"
            placeholder="e.g. 0.20"
          />
          <button
            className="border rounded px-3 py-1 text-sm"
            onClick={async () => {
              await saveCosts();
              await autoFillMatrix();
            }}
            disabled={loading}
          >
            Auto-fill Matrix
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border">
            <thead>
              <tr className="bg-muted/40">
                <th className="text-left p-2 border">MOQ</th>
                <th className="text-left p-2 border">Packaging cost / pkg (MOQ only)</th>
              </tr>
            </thead>
            <tbody>
              {RED_MOQS.map((moq) => (
                <tr key={moq}>
                  <td className="p-2 border">{moq.toLocaleString()} pkg</td>
                  <td className="p-2 border">
                    <input
                      className="border rounded px-2 py-1 text-sm w-40"
                      value={packCosts?.[moq] ?? ""}
                      onChange={(e) => setPackCost(moq, e.target.value)}
                      inputMode="decimal"
                      placeholder="e.g. 1.68"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>

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
            {pcsRows.map((pcs) => (
              <tr key={pcs} className="border-t">
                <td className="p-2 font-medium">{pcs} pcs</td>
                {RED_MOQS.map((m) => (
                  <td key={m} className="p-2">
                    <div className="flex items-start gap-3">
                      <div className="flex flex-col gap-1">
                        <input
                          className="border rounded px-2 py-1 text-sm w-32 disabled:bg-muted"
                          value={cells[key(pcs, m)] ?? ""}
                          onChange={(e) => setCell(pcs, m, e.target.value)}
                          disabled={!editable}
                          inputMode="decimal"
                          placeholder="Base"
                          title="Base (CNY)"
                        />
                        <input
                          className="border rounded px-2 py-1 text-sm w-32 disabled:bg-muted"
                          value={overrides[key(pcs, m)] ?? ""}
                          onChange={(e) => setOverride(pcs, m, e.target.value)}
                          disabled={!editable}
                          inputMode="decimal"
                          placeholder="Override"
                          title="Override (CNY)"
                        />
                      </div>
                      {(() => {
                        const baseRaw = cells[key(pcs, m)] ?? "";
                        const ovrRaw = overrides[key(pcs, m)] ?? "";
                        const finalRaw = ovrRaw !== "" ? ovrRaw : baseRaw;
                        const offerUsd = calcOfferUsdFromFinalCny(finalRaw);
                        return (
                          <div className="min-w-[78px] pt-0.5">
                            <div className="text-[11px] text-muted-foreground leading-tight">Offer USD</div>
                            <div className="text-sm tabular-nums text-muted-foreground">
                              {offerUsd == null ? "-" : offerUsd.toFixed(2)}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
            {pcsRows.length === 0 ? (
              <tr><td colSpan={1 + RED_MOQS.length} className="p-6 text-center text-muted-foreground">No rows.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
