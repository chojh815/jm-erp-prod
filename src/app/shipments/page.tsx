// src/app/shipments/page.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";

type ShipmentRow = {
  id: string;
  shipment_no: string | null;
  po_no: string | null;
  buyer_name: string | null;
  destination: string | null;
  shipping_origin_code: string | null;
  total_cartons: number | null;
  total_gw: number | null;
  total_nw: number | null;
  created_at: string;
};

function safeTrim(v: any) {
  return (v ?? "").toString().trim();
}

export default function ShipmentsHomePage() {
  const role: AppRole = "staff";
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();

  // ---- 검색 필터 상태 ----
  const [poKeyword, setPoKeyword] = React.useState("");
  const [buyerKeyword, setBuyerKeyword] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");

  // ---- 데이터/로딩 ----
  const [rows, setRows] = React.useState<ShipmentRow[]>([]);
  const [loading, setLoading] = React.useState(false);

  // ---- 삭제 중 상태(중복 클릭 방지) ----
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const loadShipments = React.useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("shipments")
        .select(
          `
          id,
          shipment_no,
          po_no,
          buyer_name,
          destination,
          shipping_origin_code,
          total_cartons,
          total_gw,
          total_nw,
          created_at
        `
        )
        .eq("is_deleted", false)   // ✅ 이거 추가
        .order("created_at", { ascending: false });

      const po = safeTrim(poKeyword);
      const buyer = safeTrim(buyerKeyword);

      if (po) query = query.ilike("po_no", `%${po}%`);
      if (buyer) query = query.ilike("buyer_name", `%${buyer}%`);

      // 날짜는 created_at(UTC/타임존) 때문에 정확히 하루 경계가 틀어질 수 있어도
      // 현재 UX 목적(대략 필터)에는 이 방식이 가장 안전.
      if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00`);
      if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59`);

      const { data, error } = await query;

      if (error) {
        console.error("Failed to load shipments:", error);
        alert("Shipment 목록을 불러오는 중 오류가 발생했습니다.");
        return;
      }

      setRows((data ?? []) as ShipmentRow[]);
    } finally {
      setLoading(false);
    }
  }, [supabase, poKeyword, buyerKeyword, dateFrom, dateTo]);

  React.useEffect(() => {
    loadShipments();
  }, [loadShipments]);

  const handleResetFilters = () => {
    setPoKeyword("");
    setBuyerKeyword("");
    setDateFrom("");
    setDateTo("");
    // state set 이후 바로 loadShipments 호출하면 이전 값으로 필터가 걸릴 수 있어
    // 다음 tick에 호출
    setTimeout(() => loadShipments(), 0);
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(); // 날짜+시간까지 (삭제 확인할 때 유용)
    } catch {
      return "-";
    }
  };

  const handleRowClick = (id: string) => {
    router.push(`/shipments/${id}`);
  };

  // ✅ Confirm Dialog + 삭제 로직(즉시 리스트 반영)
  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // 행 클릭으로 상세 들어가는 것 막기
    if (deletingId) return; // 이미 삭제 중이면 무시

    const ok = window.confirm(
      [
        "정말 이 Shipment 를 삭제하시겠습니까?",
        "",
        "- 연결된 Invoice 가 있는 Shipment 는 삭제할 수 없습니다.",
        "- 삭제 후에는 되돌릴 수 없습니다.",
      ].join("\n")
    );
    if (!ok) return;

    // ✅ 1) UI에서 즉시 제거(optimistic)
    const snapshot = rows; // 실패 시 복원용
    setDeletingId(id);
    setRows((prev) => prev.filter((x) => x.id !== id));

    try {
      const res = await fetch(`/api/shipments/${id}`, {
        method: "DELETE",
        cache: "no-store",
      });

      let json: any = null;
      try {
        json = await res.json();
      } catch {
        // JSON 파싱 실패도 실패 처리
      }

      if (!res.ok || !json?.success) {
        // ✅ 실패하면 리스트 복원
        setRows(snapshot);
        alert(
          "삭제 중 오류가 발생했습니다:\n" +
            (json?.error ?? `HTTP ${res.status}`)
        );
        return;
      }

      // ✅ 2) 서버와 최종 동기화(혹시 다른 필터/정렬/상태 변화 반영)
      await loadShipments();
    } catch (err: any) {
      console.error("Delete shipment error:", err);
      // ✅ 실패하면 복원
      setRows(snapshot);
      alert("삭제 중 알 수 없는 오류가 발생했습니다.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <AppShell role={role}>
      <div className="p-6 space-y-6">
        <h1 className="text-xl font-semibold mb-2">Shipments</h1>
        <p className="text-sm text-gray-500 mb-4">
          여기서는 Shipment 생성 및 상세 조회, 인보이스/패킹리스트 연동을 관리합니다.
          아래 버튼으로 Shipment 생성 화면으로 이동하거나, 아래 Shipment 목록에서
          검색 후 특정 Shipment 상세 페이지(<code>/shipments/UUID</code>)로
          들어갈 수 있습니다.
        </p>

        {/* 1. Actions 카드 */}
        <Card>
          <CardHeader>
            <CardTitle>Shipment Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/shipments/create-from-po">Create Shipment from PO</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/shipments/create">Create Shipment (Manual)</Link>
            </Button>
          </CardContent>
        </Card>

        {/* 2. Shipments List 카드 */}
        <Card>
          <CardHeader>
            <CardTitle>Shipments List</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 🔍 필터 영역 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <div className="text-xs font-semibold mb-1">PO No</div>
                <Input
                  placeholder="예: 01025003000"
                  value={poKeyword}
                  onChange={(e) => setPoKeyword(e.target.value)}
                />
              </div>

              <div>
                <div className="text-xs font-semibold mb-1">Buyer</div>
                <Input
                  placeholder="예: LDC, Inc"
                  value={buyerKeyword}
                  onChange={(e) => setBuyerKeyword(e.target.value)}
                />
              </div>

              <div>
                <div className="text-xs font-semibold mb-1">From Date</div>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>

              <div>
                <div className="text-xs font-semibold mb-1">To Date</div>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleResetFilters}>
                Reset
              </Button>
              <Button onClick={loadShipments} disabled={loading}>
                {loading ? "Searching..." : "Search"}
              </Button>
            </div>

            {/* 리스트 테이블 */}
            <div className="border rounded-md overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left border-b">Shipment No</th>
                    <th className="px-3 py-2 text-left border-b">PO No</th>
                    <th className="px-3 py-2 text-left border-b">Buyer</th>
                    <th className="px-3 py-2 text-left border-b">Origin</th>
                    <th className="px-3 py-2 text-left border-b">Destination</th>
                    <th className="px-3 py-2 text-right border-b">Cartons</th>
                    <th className="px-3 py-2 text-right border-b">G.W (KGS)</th>
                    <th className="px-3 py-2 text-right border-b">N.W (KGS)</th>
                    <th className="px-3 py-2 text-left border-b">Created At</th>
                    <th className="px-3 py-2 text-right border-b">Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isDeleting = deletingId === row.id;
                    return (
                      <tr
                        key={row.id}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => handleRowClick(row.id)}
                      >
                        <td className="px-3 py-2 border-b">
                          {row.shipment_no ?? "-"}
                        </td>
                        <td className="px-3 py-2 border-b">{row.po_no ?? "-"}</td>
                        <td className="px-3 py-2 border-b">
                          {row.buyer_name ?? "-"}
                        </td>
                        <td className="px-3 py-2 border-b">
                          {row.shipping_origin_code ?? "-"}
                        </td>
                        <td className="px-3 py-2 border-b">
                          {row.destination ?? "-"}
                        </td>
                        <td className="px-3 py-2 border-b text-right">
                          {row.total_cartons ?? 0}
                        </td>
                        <td className="px-3 py-2 border-b text-right">
                          {row.total_gw ?? 0}
                        </td>
                        <td className="px-3 py-2 border-b text-right">
                          {row.total_nw ?? 0}
                        </td>
                        <td className="px-3 py-2 border-b">
                          {formatDate(row.created_at)}
                        </td>
                        <td className="px-3 py-2 border-b text-right">
                          <button
                            className="text-red-600 hover:text-red-800 text-xs disabled:opacity-50"
                            onClick={(e) => handleDelete(row.id, e)}
                            disabled={!!deletingId}
                            title={
                              isDeleting ? "Deleting..." : "Delete this shipment"
                            }
                          >
                            {isDeleting ? "Deleting..." : "Delete"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}

                  {rows.length === 0 && !loading && (
                    <tr>
                      <td
                        className="px-3 py-4 text-center text-gray-500"
                        colSpan={10}
                      >
                        검색 결과가 없습니다.
                      </td>
                    </tr>
                  )}

                  {loading && (
                    <tr>
                      <td
                        className="px-3 py-4 text-center text-gray-500"
                        colSpan={10}
                      >
                        Loading...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
