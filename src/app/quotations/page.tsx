'use client';

import * as React from "react";
import { useRouter } from "next/navigation";

type Row = {
  id: string;
  updated_at: string | null;
  status: string | null;
  quotation_no: string | null;
  buyer: string | null;
  brand: string | null;
  style_no: string | null;
  lines: number | null;
  sent: any;
};

function fmtDate(s: string | null) {
  if (!s) return "";
  try {
    const d = new Date(s);
    return d.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export default function QuotationsListPage() {
  const router = useRouter();

  const [q, setQ] = React.useState("");
  const [styleNo, setStyleNo] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<Row[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/quotations/list?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      const j = await safeJson(res);
      const ok = !!(j?.ok ?? j?.success);
      if (!res.ok || !ok) throw new Error(j?.error || j?.message || `Failed (${res.status})`);
      setRows(j.rows ?? []);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createFromCosting() {
    setCreating(true);
    setError(null);
    try {
      const input = styleNo.trim();
      if (!input) {
        setError("Enter Style No (recommended) or Costing ID.");
        return;
      }

      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input);

      const payload = isUuid ? { costing_id: input } : { style_no: input };

      const res = await fetch("/api/quotations/create-from-costing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await safeJson(res);
      const ok = !!(j?.ok ?? j?.success);
      if (!res.ok || !ok) throw new Error(j?.error || j?.message || `Failed (${res.status})`);
      const id = (j?.quotation_id || j?.id || j?.quotationId) as string;
      if (id) router.push(`/quotations/${id}`);
      else await load();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setCreating(false);
    }
  }

  async function deleteQuotation(id: string) {
    const confirmed = window.confirm("Delete this quotation? (soft delete)");
    if (!confirmed) return;

    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch("/api/quotations/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const j = await safeJson(res);
      const ok = !!(j?.ok ?? j?.success);
      if (!res.ok || !ok) throw new Error(j?.error || j?.message || `Failed (${res.status})`);

      setRows((prev) => (prev ?? []).filter((r) => r.id !== id));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.2 }}>Quotations</div>
          <div style={{ color: "#6b7280", fontSize: 13 }}>List</div>
        </div>
        <button
          onClick={() => load()}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            background: "#2563eb",
            color: "white",
            border: "none",
            fontWeight: 700,
            fontSize: 13,
          }}
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      <div
        style={{
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 14,
          padding: 14,
          marginBottom: 14,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>Search</div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search quotation / buyer / brand / subject / status..."
            style={{
              flex: 1,
              minWidth: 260,
              height: 36,
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              padding: "0 12px",
              fontSize: 13,
              outline: "none",
            }}
          />
          <button
            onClick={() => load()}
            style={{
              height: 36,
              padding: "0 14px",
              borderRadius: 10,
              background: "#2563eb",
              color: "white",
              border: "none",
              fontWeight: 800,
              fontSize: 13,
            }}
            disabled={loading}
          >
            Apply
          </button>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={styleNo}
            onChange={(e) => setStyleNo(e.target.value)}
            placeholder="Style No (recommended) or Costing ID"
            style={{
              flex: 1,
              minWidth: 260,
              height: 36,
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              padding: "0 12px",
              fontSize: 13,
              outline: "none",
            }}
          />
          <button
            onClick={() => createFromCosting()}
            style={{
              height: 36,
              padding: "0 14px",
              borderRadius: 10,
              background: "#2563eb",
              color: "white",
              border: "none",
              fontWeight: 800,
              minWidth: 170,
              fontSize: 13,
              opacity: creating ? 0.75 : 1,
            }}
            disabled={creating}
            title="Create & Open"
          >
            + New (from Costing)
          </button>
        </div>

        {error ? (
          <div
            style={{
              marginTop: 10,
              background: "#fee2e2",
              border: "1px solid #fecaca",
              color: "#b91c1c",
              padding: 10,
              borderRadius: 10,
              fontWeight: 700,
              fontSize: 13,
              whiteSpace: "pre-wrap",
            }}
          >
            {error}
          </div>
        ) : null}

        <div style={{ marginTop: 10, color: "#6b7280", fontSize: 12 }}>
          Tip: Quotations should be "snapshots". Costing can change, but a SENT quotation stays stable unless you explicitly update from a newer costing version.
        </div>
      </div>

      <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 14, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f9fafb", color: "#6b7280", fontSize: 12 }}>
              <th style={{ textAlign: "left", padding: 10, width: 110 }}>Updated</th>
              <th style={{ textAlign: "left", padding: 10, width: 90 }}>Status</th>
              <th style={{ textAlign: "left", padding: 10 }}>Quotation No</th>
              <th style={{ textAlign: "left", padding: 10 }}>Buyer</th>
              <th style={{ textAlign: "left", padding: 10 }}>Brand</th>
              <th style={{ textAlign: "center", padding: 10, width: 70 }}>Lines</th>
              <th style={{ textAlign: "center", padding: 10, width: 60 }}>Sent</th>
              <th style={{ textAlign: "right", padding: 10, width: 190 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => {
              const sent = r.sent === true || r.sent === "Y" || r.sent === "y" || r.sent === 1;
              return (
                <tr key={r.id} style={{ borderTop: "1px solid #eef2f7" }}>
                  <td style={{ padding: 10 }}>{fmtDate(r.updated_at)}</td>
                  <td style={{ padding: 10 }}>
                    <span
                      style={{
                        padding: "3px 9px",
                        borderRadius: 999,
                        background: "#eef2ff",
                        color: "#111827",
                        fontSize: 11,
                        fontWeight: 800,
                      }}
                    >
                      {r.status ?? "DRAFT"}
                    </span>
                  </td>
                  <td style={{ padding: 10, fontWeight: 800 }}>{r.quotation_no ?? "-"}</td>
                  <td style={{ padding: 10 }}>{r.buyer ?? "-"}</td>
                  <td style={{ padding: 10 }}>{r.brand ?? "-"}</td>
                  <td style={{ padding: 10, textAlign: "center" }}>{r.lines ?? 0}</td>
                  <td style={{ padding: 10, textAlign: "center" }}>{sent ? "Y" : ""}</td>
                  <td style={{ padding: 10, textAlign: "right" }}>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                      <button
                        onClick={() => router.push(`/quotations/${r.id}`)}
                        style={{
                          padding: "7px 12px",
                          borderRadius: 10,
                          background: "#2563eb",
                          color: "white",
                          border: "none",
                          fontWeight: 800,
                          fontSize: 13,
                        }}
                      >
                        Open
                      </button>
                      <button
                        onClick={() => deleteQuotation(r.id)}
                        style={{
                          padding: "7px 12px",
                          borderRadius: 10,
                          background: "#fee2e2",
                          color: "#b91c1c",
                          border: "1px solid #fecaca",
                          fontWeight: 900,
                          fontSize: 13,
                          opacity: deletingId === r.id ? 0.6 : 1,
                        }}
                        disabled={deletingId === r.id}
                        title="Soft delete"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && (!rows || rows.length === 0) ? (
              <tr>
                <td colSpan={8} style={{ padding: 14, color: "#6b7280", fontSize: 13 }}>
                  No quotations.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
