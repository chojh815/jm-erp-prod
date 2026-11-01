"use client";
import React from "react";
import { useRouter } from "next/navigation";
export default function Quotations() {
  const router = useRouter(),
    [rows, setRows] = React.useState<any[]>([]),
    [q, setQ] = React.useState(""),
    [archive, setArchive] = React.useState(false),
    [busy, setBusy] = React.useState(false),
    [error, setError] = React.useState(""),
    [rights, setRights] = React.useState<any>({});
  async function load() {
    setBusy(true);
    try {
      const r = await fetch(
          "/api/quotations/list?" +
            new URLSearchParams({ q, archived: archive ? "1" : "0" }),
          { cache: "no-store" },
        ),
        j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setRows(j.rows);
      setRights(j);
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  React.useEffect(() => {
    void load();
  }, [archive]);
  async function toggle(id: string) {
    if (
      !window.confirm(
        archive
          ? "이 견적을 복원하시겠습니까?"
          : "이 견적과 이력을 보관하시겠습니까?",
      )
    )
      return;
    setBusy(true);
    try {
      const r = await fetch("/api/quotations/" + id, {
          method: archive ? "PATCH" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: archive ? JSON.stringify({ action: "restore" }) : undefined,
        }),
        j = await r.json();
      if (!r.ok) throw new Error(j.error);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="space-y-4 p-6">
      <div className="flex justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Quotations</h1>
          <p className="text-sm text-muted-foreground">
            바이어별 오퍼 · 수정본 · 발송 이력
          </p>
        </div>
        {rights.canCreate && (
          <button
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white"
            disabled={archive}
            onClick={() => router.push("/quotations/new")}
          >
            New Quotation
          </button>
        )}
      </div>
      <div className="flex gap-3">
        <input
          className="rounded border bg-background px-3 py-2 text-sm"
          placeholder="견적번호 · 바이어 · 제목 · 스타일"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void load();
          }}
        />
        <button
          className="rounded border px-3 py-2 text-sm"
          disabled={busy}
          onClick={() => void load()}
        >
          Search / Refresh
        </button>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={archive}
            onChange={(e) => setArchive(e.target.checked)}
          />{" "}
          보관함
        </label>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded border border-red-200 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted">
              {[
                "No",
                "Buyer",
                "Subject",
                "Style",
                "Status",
                "Updated",
                "Action",
              ].map((h) => (
                <th className="p-3 text-left" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3">
                  <button
                    className="text-blue-700 underline"
                    onClick={() => router.push("/quotations/" + r.id)}
                  >
                    {r.quotation_no}
                  </button>
                </td>
                <td className="p-3">{r.buyer_name || "—"}</td>
                <td className="p-3">{r.subject || "—"}</td>
                <td className="p-3">{r.style_no || "—"}</td>
                <td className="p-3">{r.status}</td>
                <td className="p-3">
                  {r.updated_at
                    ? new Date(r.updated_at).toLocaleString("ko-KR", {
                        timeZone: "Asia/Seoul",
                      })
                    : "—"}
                </td>
                <td className="p-3">
                  {rights.canArchive && (
                    <button
                      className="rounded border px-2 py-1"
                      disabled={busy}
                      onClick={() => void toggle(r.id)}
                    >
                      {archive ? "Restore" : "Archive"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td
                  colSpan={7}
                  className="p-6 text-center text-muted-foreground"
                >
                  {busy ? "불러오는 중…" : "견적이 없습니다."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
