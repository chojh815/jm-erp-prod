"use client";

import React from "react";
import { useParams } from "next/navigation";

/**
 * src/app/packing-lists/[id]/pdf/page.tsx
 *
 * Packing List PDF/Print page (HTML).
 * - Fetches /api/packing-lists/[id] (same data used by detail page)
 * - Renders a print-friendly layout
 * - Auto-triggers window.print()
 *
 * Change in this version:
 * - Removed table columns: Total NW / Total GW / Total CBM (they're already summarized below)
 * - Added column: Qty/CTN (computed = Qty(Total) / Cartons)
 */
type AnyObj = Record<string, any>;

function safeNum(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function fmt0(v: any) {
  const n = safeNum(v, 0);
  // show 0 decimals unless it has decimals
  const isInt = Math.abs(n - Math.round(n)) < 1e-9;
  return isInt ? Math.round(n).toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}
function fmtCbm(v: any) {
  const n = safeNum(v, 0);
  // up to 4 decimals, strip trailing zeros
  const s = n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return s === "" ? "0" : s;
}
function fmtDate(v: any) {
  const s = (v ?? "").toString().trim();
  if (!s) return "-";
  // accept YYYY-MM-DD or already formatted
  return s;
}

export default function PackingListPdfPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ? String(params.id) : "";

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<AnyObj | null>(null);

  React.useEffect(() => {
    if (!id) return;
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`/api/packing-lists/${encodeURIComponent(id)}`, {
          method: "GET",
          headers: { "content-type": "application/json" },
          cache: "no-store",
        });

        const json = await res.json().catch(() => null);
        if (!alive) return;

        if (!res.ok || !json?.success) {
          throw new Error(json?.error || `Failed to load packing list (${res.status})`);
        }

        setData(json);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || "Failed to load packing list.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [id]);

  React.useEffect(() => {
    if (loading) return;
    if (error) return;
    if (!data) return;

    // allow layout to paint
    const t = setTimeout(() => window.print(), 250);
    return () => clearTimeout(t);
  }, [loading, error, data]);

  if (loading) {
    return <div style={{ padding: 24, fontFamily: "Arial, sans-serif" }}>Loading...</div>;
  }
  if (error) {
    return (
      <div style={{ padding: 24, fontFamily: "Arial, sans-serif" }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Failed to render PDF</div>
        <div style={{ color: "#b91c1c" }}>{error}</div>
      </div>
    );
  }

  const header = data?.header || {};
  const lines: AnyObj[] = Array.isArray(data?.lines) ? data.lines : [];
  const totals = data?.totals || {};

  return (
    <div style={{ padding: "24px", fontFamily: "Arial, sans-serif", color: "#111" }}>
      <style>{`
        @page { size: A4; margin: 14mm; }
        @media print {
          .no-print { display: none !important; }
        }
        .title {
          text-align: center;
          font-size: 40px;
          font-weight: 800;
          letter-spacing: 1px;
          margin: 10px 0 18px;
        }
        .buyer {
          font-size: 22px;
          margin: 0 0 14px;
        }
        .box {
          border: 2px solid #333;
          border-collapse: collapse;
          width: 100%;
          margin-bottom: 16px;
          table-layout: fixed;
        }
        .box td {
          border: 2px solid #333;
          vertical-align: top;
          padding: 10px 12px;
          height: 90px;
          font-size: 16px;
          white-space: pre-wrap;
        }
        .box .label {
          font-weight: 800;
          margin-bottom: 6px;
        }
        .lines {
          border-collapse: collapse;
          width: 100%;
          table-layout: fixed;
          font-size: 15px;
        }
        .lines th, .lines td {
          border: 1px solid #c9c9c9;
          padding: 10px 10px;
        }
        .lines th {
          background: #f2f2f2;
          text-align: center;
          font-weight: 800;
        }
        .lines td {
          vertical-align: middle;
        }
        .right { text-align: right; }
        .center { text-align: center; }
        .group {
          font-weight: 800;
          background: #fff;
        }
        .totalsWrap {
          margin-top: 36px;
          font-size: 28px;
        }
        .totalsGrid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px 80px;
          margin-top: 14px;
          font-size: 26px;
        }
        .signWrap {
          margin-top: 40px;
          display: flex;
          justify-content: flex-end;
          gap: 22px;
          align-items: flex-end;
        }
      `}</style>

      <div className="no-print" style={{ marginBottom: 12, fontSize: 12, color: "#555" }}>
        Printing… If print dialog doesn&apos;t open, press Ctrl+P.
      </div>

      <div className="title">PACKING LIST</div>
      <div className="buyer">
        <b>Buyer:</b> {(header?.buyer_name ?? header?.buyer ?? "").toString() || "-"}
      </div>

      <table className="box">
        <tbody>
          <tr>
            <td style={{ width: "50%" }}>
              <div className="label">Shipper / Exporter</div>
              <div>{(header?.shipper_name ?? "").toString() || "-"}</div>
              <div style={{ marginTop: 8 }}>{(header?.shipper_address ?? "").toString() || ""}</div>
            </td>
            <td style={{ width: "50%" }}>
              <div className="label">Packing List Info</div>
              <div> Packing List No: {(header?.packing_list_no ?? "").toString() || "-"}</div>
              <div> Packing Date: {fmtDate(header?.packing_date)}</div>
              <div> Invoice No: {(header?.invoice_no ?? "").toString() || "-"}</div>
              <div> Invoice Date: {fmtDate(header?.invoice_date)}</div>
            </td>
          </tr>
          <tr>
            <td>
              <div className="label">Consignee</div>
              <div>{(header?.consignee_text ?? "").toString() || "-"}</div>
            </td>
            <td>
              <div className="label">Notify Party</div>
              <div>{(header?.notify_party_text ?? "").toString() || "-"}</div>
            </td>
          </tr>
          <tr>
            <td colSpan={2}>
              <div className="label">COO / Certification</div>
              <div>{(header?.coo_text ?? header?.coo ?? "").toString() || "-"}</div>
            </td>
          </tr>
        </tbody>
      </table>

      <table className="lines">
        <thead>
          <tr>
            <th style={{ width: "8%" }}>C/T No</th>
            <th style={{ width: "14%" }}>PO #</th>
            <th style={{ width: "11%" }}>Style #</th>
            <th style={{ width: "24%" }}>Description</th>
            <th style={{ width: "8%" }}>Cartons</th>
            <th style={{ width: "12%" }}>Qty/CTN</th>
            <th style={{ width: "8%" }}>NW/CTN</th>
            <th style={{ width: "8%" }}>GW/CTN</th>
            <th style={{ width: "10%" }}>CBM/CTN</th>
          </tr>
        </thead>
        <tbody>
          {/* group by PO no if present */}
          {(() => {
            const groups = new Map<string, AnyObj[]>();
            for (const r of lines) {
              const key = (r?.po_no ?? r?.po ?? "").toString() || "-";
              if (!groups.has(key)) groups.set(key, []);
              groups.get(key)!.push(r);
            }
            const poKeys = Array.from(groups.keys());
            return poKeys.map((poNo) => {
              const rows = groups.get(poNo)!;
              return (
                <React.Fragment key={poNo}>
                  <tr className="group">
                    <td colSpan={9} style={{ padding: "12px 10px" }}>
                      PO# {poNo}
                    </td>
                  </tr>
                  {rows.map((r, idx) => {
                    const cartons = safeNum(r?.cartons, 0);
                    const qty = safeNum(r?.qty, safeNum(r?.qty_total, 0));
                    const qtyPerCtn = cartons > 0 ? qty / cartons : qty;
                    return (
                      <tr key={`${poNo}-${idx}`}>
                        <td className="center">{(r?.ct_range ?? r?.ct_no ?? r?.ct_from_to ?? "").toString() || "-"}</td>
                        <td className="center">{(r?.po_no ?? "").toString() || "-"}</td>
                        <td className="center">{(r?.style_no ?? r?.style ?? "").toString() || "-"}</td>
                        <td>{(r?.description ?? "").toString() || ""}</td>
                        <td className="right">{fmt0(cartons)}</td>
                        <td className="right">{fmt0(qtyPerCtn)}</td>
                        <td className="right">{fmt0(r?.nw_per_ctn ?? r?.nw_per_carton)}</td>
                        <td className="right">{fmt0(r?.gw_per_ctn ?? r?.gw_per_carton)}</td>
                        <td className="right">{fmtCbm(r?.cbm_per_ctn ?? r?.cbm_per_carton)}</td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              );
            });
          })()}
        </tbody>
      </table>

      <div className="totalsWrap">
        <div style={{ fontWeight: 800, fontSize: 34, marginBottom: 10 }}>Totals</div>
        <div className="totalsGrid">
          <div>
  Total Cartons: <b>{fmt0(totals?.total_cartons ?? totals?.cartons)} ctns</b>
</div>

<div>
  Total Qty: <b>{fmt0(totals?.total_qty ?? totals?.qty)} pcs</b>
</div>

<div>
  Total N.W.: <b>{fmt0(totals?.total_nw ?? totals?.nw)} kg</b>
</div>

<div>
  Total G.W.: <b>{fmt0(totals?.total_gw ?? totals?.gw)} kg</b>
</div>

<div>
  Total CBM: <b>{fmtCbm(totals?.total_cbm ?? totals?.cbm)} CBM</b>
</div>

        </div>
      </div>

      <div className="signWrap">
        <div style={{ textAlign: "right", fontSize: 24, marginRight: 10 }}>Signed by</div>
        {header?.stamp_url ? (
          <img
            alt="stamp"
            src={String(header.stamp_url)}
            style={{ width: 220, height: 220, objectFit: "contain" }}
          />
        ) : null}
        <div style={{ textAlign: "right", fontSize: 26, fontWeight: 700 }}>
          {(header?.shipper_name ?? "JM International Co.Ltd").toString()}
        </div>
      </div>
    </div>
  );
}
