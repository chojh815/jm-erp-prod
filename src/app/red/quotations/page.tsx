"use client";

import React from "react";
import { useRouter } from "next/navigation";

type Row = {
  id: string;
  red_quotation_no: string | null;
  title: string | null;
  buyer_name: string | null;
  style_no: string | null;
  status: string;
  updated_at: string;
  archived_at?: string | null;
};

function fmtDate(s: string) {
  const d = new Date(s);
  return d.toLocaleString();
}

export default function RedQuotationsListPage() {
  const router = useRouter();

  const [archived, setArchived] = React.useState(false);
  const [canCreate, setCanCreate] = React.useState(false);
  const [canArchive, setCanArchive] = React.useState(false);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const [buyerName, setBuyerName] = React.useState("");
  const [styleNo, setStyleNo] = React.useState("");
  const [shipFrom, setShipFrom] = React.useState("CN_QINGDAO");

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(
        "/api/red/quotations?archived=" + (archived ? "1" : "0"),
        { cache: "no-store" },
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as any)?.error || "Failed");
      setRows((j as any).data || []);
      setCanCreate(j.canCreate === true);
      setCanArchive(j.canArchive === true);
    } catch (e: any) {
      setErr(e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archived]);

  async function create() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/red/quotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buyer_name: buyerName || null,
          style_no: styleNo || null,
          ship_from_code: shipFrom,
          title: buyerName && styleNo ? `${buyerName} - ${styleNo}` : null,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as any)?.error || "Failed");
      router.push(`/red/quotations/${(j as any).data.id}`);
    } catch (e: any) {
      setErr(e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function deleteOne(id: string) {
    if (
      !confirm(
        archived
          ? "이 견적을 복원하시겠습니까?"
          : "이 견적을 보관하시겠습니까? 자료와 이력은 유지됩니다.",
      )
    )
      return;
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/red/quotations/${id}`, {
        method: archived ? "PATCH" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: archived ? JSON.stringify({ action: "restore" }) : undefined,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as any)?.error || "보관/복원 처리 실패");
      await load();
    } catch (e: any) {
      setErr(e?.message || "보관/복원 처리 실패");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">RED Quotations</h1>
          <p className="text-sm text-muted-foreground">
            버전별 오퍼 · 네고 이력 · 최종 USD 가격
          </p>
        </div>

        <div className="flex gap-2 flex-wrap items-end">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />{" "}
            보관함
          </label>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Buyer</div>
            <input
              className="border rounded px-2 py-1 text-sm w-40"
              value={buyerName}
              onChange={(e) => setBuyerName(e.target.value)}
              placeholder="RED buyer"
            />
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Style No</div>
            <input
              className="border rounded px-2 py-1 text-sm w-40"
              value={styleNo}
              onChange={(e) => setStyleNo(e.target.value)}
              placeholder="JK260001"
            />
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Ship From</div>
            <select
              className="border rounded px-2 py-1 text-sm"
              value={shipFrom}
              onChange={(e) => setShipFrom(e.target.value)}
            >
              <option value="CN_QINGDAO">CN_QINGDAO</option>
              <option value="VN_BACNINH">VN_BACNINH</option>
              <option value="KR_SEOUL">KR_SEOUL</option>
            </select>
          </div>

          <button
            onClick={create}
            disabled={loading || !canCreate || archived}
            className="border rounded px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            + New RED Quotation
          </button>
        </div>
      </div>

      {err ? <div className="text-sm text-red-600">{err}</div> : null}

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-2">No</th>
              <th className="text-left p-2">Buyer</th>
              <th className="text-left p-2">Style</th>
              <th className="text-left p-2">Title</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Updated</th>
              <th className="text-right p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-t hover:bg-muted/50 cursor-pointer"
                onClick={() => router.push(`/red/quotations/${r.id}`)}
              >
                <td className="p-2 font-medium">
                  {r.red_quotation_no || r.id.slice(0, 8)}
                </td>
                <td className="p-2">{r.buyer_name || "-"}</td>
                <td className="p-2">{r.style_no || "-"}</td>
                <td className="p-2">{r.title || "-"}</td>
                <td className="p-2">{r.status}</td>
                <td className="p-2">{fmtDate(r.updated_at)}</td>
                <td className="p-2 text-right">
                  <button
                    className="px-2 py-1 text-xs border rounded hover:bg-gray-50 disabled:opacity-50"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      deleteOne(r.id);
                    }}
                    title={archived ? "견적 복원" : "견적과 이력 보관"}
                    disabled={!canArchive || loading}
                  >
                    {archived ? "Restore" : "Archive"}
                  </button>
                </td>
              </tr>
            ))}

            {rows.length === 0 && !loading ? (
              <tr>
                <td
                  colSpan={7}
                  className="p-6 text-center text-muted-foreground"
                >
                  No RED quotations yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
