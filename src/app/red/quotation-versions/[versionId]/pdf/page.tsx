import React from "react";
import { headers } from "next/headers";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

function getBaseUrl() {
  // Server Components: fetch() needs an absolute URL when called in Node runtime.
  // Prefer explicit env, otherwise derive from request headers (works on Vercel + local).
  const envBase =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (envBase) return envBase.replace(/\/$/, "");

  const h = headers();
  const proto = h.get("x-forwarded-proto") || "http";
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

async function getJson(url: string) {
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as any)?.error || `Failed (${r.status})`);
  return j;
}

export default async function RedQuotationVersionPdfPage({
  params,
  searchParams,
}: any) {
  const versionId = params.versionId as string;
  const pkg = String(searchParams?.package || "A").toUpperCase();

  const base = getBaseUrl();

  // Matrix
  const url = `${base}/api/red/quotation-versions/${versionId}/matrix?package=${encodeURIComponent(
    pkg
  )}`;
  const m = await getJson(url);
  const rows = (m?.data || []) as any[];

  return (
    <div
      style={{
        padding: 24,
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 18 }}>RED Quotation Matrix</h1>
        <div style={{ fontSize: 12, color: "#555" }}>
          Version: {versionId} · Package: {pkg}
        </div>
      </div>

      <div style={{ marginTop: 12, marginBottom: 12 }}>
        <PrintButton />
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ border: "1px solid #ddd", padding: 6, textAlign: "left" }}>
              PCS/PKG
            </th>
            <th style={{ border: "1px solid #ddd", padding: 6, textAlign: "left" }}>
              MOQ PKG
            </th>
            <th style={{ border: "1px solid #ddd", padding: 6, textAlign: "right" }}>
              Price
            </th>
            <th style={{ border: "1px solid #ddd", padding: 6, textAlign: "right" }}>
              Override
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ border: "1px solid #eee", padding: 6 }}>
                {r.pcs_per_pkg}
              </td>
              <td style={{ border: "1px solid #eee", padding: 6 }}>
                {r.moq_packages}
              </td>
              <td style={{ border: "1px solid #eee", padding: 6, textAlign: "right" }}>
                {r.price_fob_per_pkg ?? ""}
              </td>
              <td style={{ border: "1px solid #eee", padding: 6, textAlign: "right" }}>
                {r.override_price_fob_per_pkg ?? ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 10, fontSize: 11, color: "#666" }}>
        * This page is a simple print-PDF export. If you want a formatted commercial PDF,
        we can switch to your React-PDF template.
      </div>
    </div>
  );
}
