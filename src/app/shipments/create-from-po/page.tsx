// src/app/shipments/create-from-po/page.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

const supabase = createSupabaseBrowserClient();
const currentRole: AppRole = "staff";

type PoHeader = {
  id: string;
  po_no: string;

  buyer_id: string | null;
  buyer_name: string | null;

  order_date: string | null;
  requested_ship_date: string | null;
  currency: string | null;
  status: string | null;
  incoterm: string | null;
  payment_term: string | null;
  destination: string | null;
  shipping_origin_code: string | null;
};

type ShipmentLineDraft = {
  // line identity
  poLineId: string;
  poId: string;
  poNo: string;
  lineNo: number;

  styleNo: string | null;
  description: string | null;
  color: string | null;
  size: string | null;

  orderQty: number;
  shippedQty: number;
  unitPrice: number;
  amount: number;

  cartons: number;
  gwPerCtn: number;
  nwPerCtn: number;
};

function safeNumber(v: any, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) return fallback;
  return n;
}


function safeStr(v: any): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function fmt2(n: number) {
  return (Number(n) || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// PO incoterm이 null일 때 companies.buyer_default_incoterm로 보정
async function resolveIncotermFallback(buyerId: string | null): Promise<string | null> {
  if (!buyerId) return null;
  const { data, error } = await supabase
    .from("companies")
    .select("buyer_default_incoterm")
    .eq("id", buyerId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load buyer_default_incoterm:", error);
    return null;
  }
  return (data as any)?.buyer_default_incoterm ?? null;
}

function commonOrMixed(values: Array<string | null | undefined>) {
  const arr = values.map((v) => (v ?? "").trim()).filter(Boolean);
  if (arr.length === 0) return "-";
  const first = arr[0];
  const same = arr.every((x) => x === first);
  return same ? first : "MIXED";
}

function originCodeToCooText(code: string | null | undefined) {
  const v = safeStr(code).toUpperCase();
  if (!v) return "";
  if (v.startsWith("VN_")) return "MADE IN VIETNAM";
  if (v.startsWith("CN_")) return "MADE IN CHINA";
  if (v.startsWith("KR_")) return "MADE IN KOREA";
  return "";
}

export default function CreateShipmentFromPOPage() {
  const router = useRouter();

  // 1) PO 검색/선택
  const [searchText, setSearchText] = React.useState("");
  const [poList, setPoList] = React.useState<PoHeader[]>([]);
  const [poLoading, setPoLoading] = React.useState(false);

  // ✅ A안: 다중 선택
  const [selectedPoIds, setSelectedPoIds] = React.useState<string[]>([]);
  const [selectedPos, setSelectedPos] = React.useState<PoHeader[]>([]);

  // ✅ PO별 라인 캐시
  const [poLinesByPoId, setPoLinesByPoId] = React.useState<Record<string, ShipmentLineDraft[]>>(
    {}
  );

  // 2) 라인(합쳐진)
  const [saving, setSaving] = React.useState(false);

  const selectedBuyerId = React.useMemo(() => {
    return selectedPos[0]?.buyer_id ?? null;
  }, [selectedPos]);

  // ✅ 합쳐진 라인 (PO No → lineNo 순 정렬)
  const lines: ShipmentLineDraft[] = React.useMemo(() => {
    const all = Object.values(poLinesByPoId).flat();
    return all.sort((a, b) => {
      const poCmp = (a.poNo || "").localeCompare(b.poNo || "");
      if (poCmp !== 0) return poCmp;
      return (a.lineNo || 0) - (b.lineNo || 0);
    });
  }, [poLinesByPoId]);

  // =========================
  // Totals (자동 계산)
  // =========================
  const totals = React.useMemo(() => {
    const totalCartons = lines.reduce((sum, l) => sum + (l.cartons || 0), 0);
    const totalGw = lines.reduce((sum, l) => sum + (l.cartons || 0) * (l.gwPerCtn || 0), 0);
    const totalNw = lines.reduce((sum, l) => sum + (l.cartons || 0) * (l.nwPerCtn || 0), 0);
    return { totalCartons, totalGw, totalNw };
  }, [lines]);

  // =========================
  // 1. PO 검색
  // =========================
  const handleSearchPo = React.useCallback(
    async (q?: string) => {
      const keyword = q ?? searchText;
      const trimmed = keyword.trim();
      if (!trimmed) {
        setPoList([]);
        return;
      }

      setPoLoading(true);
      try {
        const like = `%${trimmed}%`;
        const { data, error } = await supabase
          .from("po_headers")
          .select(
            [
              "id",
              "po_no",
              "buyer_id",
              "buyer_name",
              "order_date",
              "requested_ship_date",
              "currency",
              "status",
              "incoterm",
              "payment_term",
              "destination",
              "shipping_origin_code",
            ].join(",")
          )
          .eq("status", "CONFIRMED")
          .or(
            [
              `po_no.ilike.${like}`,
              `buyer_name.ilike.${like}`,
              `destination.ilike.${like}`,
            ].join(",")
          )
          .order("order_date", { ascending: false })
          .limit(50);

        if (error) {
          console.error("Failed to search POs:", error);
          alert("PO 검색 중 오류가 발생했습니다.");
          return;
        }

        setPoList((data ?? []) as any);
      } catch (err) {
        console.error("Error searching POs:", err);
        alert("PO 검색 중 예기치 못한 오류가 발생했습니다.");
      } finally {
        setPoLoading(false);
      }
    },
    [searchText]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSearchPo();
  };

  // =========================
  // 2. PO별 라인 로딩
  // =========================
  const loadPoLines = React.useCallback(async (po: PoHeader) => {
    // incoterm fallback 보정
    let fixedPo = po;
    if (!po.incoterm) {
      const fallback = await resolveIncotermFallback(po.buyer_id ?? null);
      if (fallback) fixedPo = { ...po, incoterm: fallback };
    }

    const { data, error } = await supabase
      .from("po_lines")
      .select(
        [
          "id",
          "line_no",
          "buyer_style_no",
          "description",
          "color",
          "size",
          "qty",
          "unit_price",
          "amount",
        ].join(",")
      )
      .eq("po_header_id", po.id)
      .order("line_no", { ascending: true });

    if (error) {
      console.error("Failed to load PO lines:", error);
      throw new Error("PO 라인 로딩 중 오류가 발생했습니다.");
    }

    const newLines: ShipmentLineDraft[] =
      (data ?? []).map((pl: any, index: number) => {
        const orderQty = Number(pl.qty) || 0;
        const unitPrice = Number(pl.unit_price) || 0;
        const shippedQty = orderQty;

        return {
          poLineId: pl.id as string,
          poId: fixedPo.id,
          poNo: fixedPo.po_no,
          lineNo: (pl.line_no as number) || index + 1,
          styleNo: pl.buyer_style_no,
          description: pl.description,
          color: pl.color,
          size: pl.size,
          orderQty,
          shippedQty,
          unitPrice,
          amount: shippedQty * unitPrice,

          cartons: 0,
          gwPerCtn: 0,
          nwPerCtn: 0,
        };
      }) ?? [];

    return { fixedPo, newLines };
  }, []);

  // =========================
  // ✅ A안: PO 토글(체크박스)
  // - 같은 buyer만 선택 가능
  // =========================
  const handleTogglePo = React.useCallback(
    async (po: PoHeader) => {
      const already = selectedPoIds.includes(po.id);

      // unselect
      if (already) {
        setSelectedPoIds((prev) => prev.filter((x) => x !== po.id));
        setSelectedPos((prev) => prev.filter((x) => x.id !== po.id));
        setPoLinesByPoId((prev) => {
          const next = { ...prev };
          delete next[po.id];
          return next;
        });
        return;
      }

      // select: buyer constraint
      const baseBuyer = selectedBuyerId;
      if (baseBuyer && po.buyer_id && po.buyer_id !== baseBuyer) {
        alert("같은 Buyer의 PO만 한 Shipment로 묶을 수 있습니다.");
        return;
      }
      if (baseBuyer && !po.buyer_id) {
        alert("선택한 PO에 buyer_id가 없습니다. 먼저 PO에 buyer_id가 저장되어야 합니다.");
        return;
      }

      try {
        const { fixedPo, newLines } = await loadPoLines(po);

        // buyer_id 검증 (선택 첫 PO에서도 필수)
        if (!fixedPo.buyer_id) {
          alert("buyer_id 가 PO에 없습니다. PO에 buyer_id가 저장되어 있어야 합니다.");
          return;
        }
        if (selectedBuyerId && fixedPo.buyer_id !== selectedBuyerId) {
          alert("같은 Buyer의 PO만 한 Shipment로 묶을 수 있습니다.");
          return;
        }

        setSelectedPoIds((prev) => [...prev, fixedPo.id]);
        setSelectedPos((prev) => [...prev, fixedPo]);

        setPoLinesByPoId((prev) => ({
          ...prev,
          [fixedPo.id]: newLines,
        }));
      } catch (err: any) {
        console.error(err);
        alert(err?.message || "PO 라인 로딩 중 오류가 발생했습니다.");
      }
    },
    [selectedPoIds, selectedBuyerId, loadPoLines]
  );

  const clearSelection = React.useCallback(() => {
    setSelectedPoIds([]);
    setSelectedPos([]);
    setPoLinesByPoId({});
  }, []);

  // =========================
  // 라인 업데이트(합쳐진 라인에서 poLineId 기준으로 업데이트)
  // =========================
  const updateLine = React.useCallback(
    (poId: string, poLineId: string, patch: Partial<ShipmentLineDraft>) => {
      setPoLinesByPoId((prev) => {
        const cur = prev[poId] || [];
        const next = cur.map((l) => {
          if (l.poLineId !== poLineId) return l;

          const merged: ShipmentLineDraft = { ...l, ...patch };

          // amount 재계산( shippedQty 변경 시 )
          const shippedQty = safeNumber(merged.shippedQty, 0);
          const unitPrice = safeNumber(merged.unitPrice, 0);
          merged.amount = shippedQty * unitPrice;

          return merged;
        });

        return { ...prev, [poId]: next };
      });
    },
    []
  );

  // =========================
  // 3. Shipment 저장
  // =========================
  const handleCreateShipment = React.useCallback(async () => {
    if (!selectedPos.length) {
      alert("먼저 PO 를 선택해 주세요.");
      return;
    }
    if (!lines.length) {
      alert("Shipment Lines 가 없습니다.");
      return;
    }

    // buyer_id 필수
    const buyerId = selectedPos[0]?.buyer_id ?? null;
    if (!buyerId) {
      alert("buyer_id 가 PO에 없습니다. PO에 buyer_id가 저장되어 있어야 합니다.");
      return;
    }

    // created_by / created_by_email (있으면 보내고 없으면 null)
    let created_by: string | null = null;
    let created_by_email: string | null = null;
    try {
      const { data } = await supabase.auth.getUser();
      created_by = data?.user?.id ?? null;
      created_by_email = data?.user?.email ?? null;
    } catch {
      // ignore
    }

    // 대표 PO(첫번째) — 헤더 snapshot 용
    const base = selectedPos[0];

    setSaving(true);
    try {
      /**
       * ✅ 중요:
       * - 지금은 UI만 먼저 바꾸는 단계라,
       *   API가 아직 단일 po_header_id만 받으면 “PO 1개 선택”일 때만 성공함.
       * - 곧 API도 A안으로 바꿀 거라서, payload에 po_header_ids를 같이 넣어둠.
       */
      const payload: any = {
        mode: selectedPos.length > 1 ? "FROM_PO_MULTI" : "FROM_PO",
        // backward compat (단일 선택일 때 기존 API도 통과)
        po_header_id: selectedPos.length === 1 ? base.id : undefined,
        po_no: selectedPos.length === 1 ? base.po_no : undefined,

        // ✅ A안 키
        po_header_ids: selectedPos.map((p) => p.id),
        po_nos: selectedPos.map((p) => p.po_no),

        created_by,
        created_by_email,

        shipmentHeader: {
          // 단일 FK는 레거시로 유지 가능
          po_header_id: selectedPos.length === 1 ? base.id : null,
          po_no: selectedPos.length === 1 ? base.po_no : null,

          buyer_id: base.buyer_id,
          buyer_name: base.buyer_name,

          currency: commonOrMixed(selectedPos.map((p) => p.currency)),
          incoterm: commonOrMixed(selectedPos.map((p) => p.incoterm)),
          payment_term: commonOrMixed(selectedPos.map((p) => p.payment_term)),
          destination: commonOrMixed(selectedPos.map((p) => p.destination)),
          shipping_origin_code: commonOrMixed(selectedPos.map((p) => p.shipping_origin_code)),

          total_cartons: totals.totalCartons,
          total_gw: totals.totalGw,
          total_nw: totals.totalNw,
        },

        shipmentLines: lines.map((l) => ({
          po_header_id: l.poId,
          po_no: l.poNo,

          po_line_id: l.poLineId,
          line_no: l.lineNo,
          style_no: l.styleNo,
          description: l.description,
          color: l.color,
          size: l.size,

          order_qty: l.orderQty,
          shipped_qty: l.shippedQty,
          unit_price: l.unitPrice,
          amount: l.amount,

          cartons: l.cartons,

          // UI 입력은 카톤당 값
          gw_per_ctn: l.gwPerCtn,
          nw_per_ctn: l.nwPerCtn,
        })),
      };

      const res = await fetch("/api/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error("Create shipment failed:", res.status, text);
        alert(`Shipment 저장 중 오류가 발생했습니다.\n\nStatus: ${res.status}\n${text}`);
        return;
      }

      const json = await res.json();
      console.log("Create shipment success:", json);
      alert("Shipment 가 성공적으로 저장되었습니다.");
      router.push("/shipments");
    } catch (err) {
      console.error("Error creating shipment:", err);
      alert("Shipment 저장 중 예기치 못한 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }, [selectedPos, lines, totals, router]);

  // =========================
  // 렌더
  // =========================
  const baseBuyerName = selectedPos[0]?.buyer_name ?? "-";
  const commonCurrency = commonOrMixed(selectedPos.map((p) => p.currency));
  const commonIncoterm = commonOrMixed(selectedPos.map((p) => p.incoterm));
  const commonPay = commonOrMixed(selectedPos.map((p) => p.payment_term));
  const commonDest = commonOrMixed(selectedPos.map((p) => p.destination));
  const commonOrigin = commonOrMixed(selectedPos.map((p) => p.shipping_origin_code));
  const commonCoo = originCodeToCooText(commonOrigin) || "-";
  const commonShipDate = commonOrMixed(selectedPos.map((p) => p.requested_ship_date));

  return (
    <AppShell currentRole={currentRole}>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Create Shipment from PO</h1>
        <Button variant="outline" onClick={() => router.push("/shipments")}>
          Back to Shipments
        </Button>
      </div>

      {/* 1. Select PO */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>1. Select PO for Shipment</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 mb-4">
            <Input
              placeholder="Search by PO No / Buyer / Destination"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <Button onClick={() => handleSearchPo()} disabled={poLoading}>
              {poLoading ? "Searching..." : "Search"}
            </Button>

            <Button
              variant="outline"
              onClick={clearSelection}
              disabled={!selectedPoIds.length}
              title="Clear selected POs"
            >
              Clear
            </Button>
          </div>

          <div className="text-sm mb-3">
            <span className="font-semibold">Selected:</span>{" "}
            {selectedPos.length ? (
              <>
                {selectedPos.length} PO(s) — Buyer: <span className="font-semibold">{baseBuyerName}</span>{" "}
                <span className="text-muted-foreground">
                  ({selectedPos.map((p) => p.po_no).join(", ")})
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">none</span>
            )}
            <div className="text-xs text-muted-foreground mt-1">
              * 한 Shipment에는 <span className="font-semibold">같은 Buyer</span>의 PO만 선택 가능합니다.
            </div>
          </div>

          <div className="border rounded-md overflow-auto max-h-80">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-2 py-1 border text-center w-16">Select</th>
                  <th className="px-2 py-1 border text-left">PO No</th>
                  <th className="px-2 py-1 border text-left">Buyer</th>
                  <th className="px-2 py-1 border text-center">Order Date</th>
                  <th className="px-2 py-1 border text-center">Ship Date</th>
                  <th className="px-2 py-1 border text-center">Currency</th>
                  <th className="px-2 py-1 border text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {poList.map((po) => {
                  const checked = selectedPoIds.includes(po.id);

                  // 같은 buyer만 선택 가능(첫 선택 이후)
                  const disabled =
                    !checked &&
                    selectedBuyerId &&
                    po.buyer_id &&
                    po.buyer_id !== selectedBuyerId;

                  return (
                    <tr
                      key={po.id}
                      className={checked ? "bg-blue-50" : disabled ? "opacity-60" : "hover:bg-gray-50"}
                    >
                      <td className="px-2 py-1 border text-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!!disabled}
                          onChange={() => handleTogglePo(po)}
                        />
                      </td>
                      <td className="px-2 py-1 border text-left">{po.po_no}</td>
                      <td className="px-2 py-1 border text-left">{po.buyer_name ?? "-"}</td>
                      <td className="px-2 py-1 border text-center">{po.order_date ?? "-"}</td>
                      <td className="px-2 py-1 border text-center">{po.requested_ship_date ?? "-"}</td>
                      <td className="px-2 py-1 border text-center">{po.currency ?? "-"}</td>
                      <td className="px-2 py-1 border text-center">{po.status ?? "-"}</td>
                    </tr>
                  );
                })}

                {!poList.length && (
                  <tr>
                    <td className="px-2 py-4 border text-center text-gray-500" colSpan={7}>
                      검색 결과가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 2. Shipment Header Preview */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>2. Shipment Details from Selected PO(s)</CardTitle>
        </CardHeader>
        <CardContent>
          {selectedPos.length ? (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-y-2 gap-x-6 text-sm">
              <div>
                <div className="font-semibold">PO(s)</div>
                <div>
                  {selectedPos.length} —{" "}
                  <span className="text-muted-foreground">{selectedPos.map((p) => p.po_no).join(", ")}</span>
                </div>
              </div>

              <div>
                <div className="font-semibold">Buyer</div>
                <div>{baseBuyerName}</div>
              </div>

              <div>
                <div className="font-semibold">Currency</div>
                <div>{commonCurrency}</div>
              </div>

              <div>
                <div className="font-semibold">Ship Date</div>
                <div>{commonShipDate}</div>
              </div>

              <div>
                <div className="font-semibold">Incoterm</div>
                <div>{commonIncoterm}</div>
              </div>

              <div>
                <div className="font-semibold">Payment Term</div>
                <div>{commonPay}</div>
              </div>

              <div>
                <div className="font-semibold">Destination</div>
                <div>{commonDest}</div>
              </div>

              <div>
                <div className="font-semibold">Shipping Origin</div>
                <div>{commonOrigin}</div>
              </div>
              <div>
                <div className="font-semibold">COO</div>
                <div>{commonCoo}</div>
              </div>
            </div>
          ) : (
            <div className="text-gray-500 text-sm">
              상단에서 PO 를 선택하면 자동으로 정보가 표시됩니다.
            </div>
          )}
        </CardContent>
      </Card>

      {/* 3. Shipment Lines + Totals */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>3. Shipment Lines & Totals</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <Label>Total Cartons</Label>
              <div className="h-10 px-3 rounded-md border flex items-center">
                {totals.totalCartons.toLocaleString()}
              </div>
            </div>
            <div>
              <Label>Total G.W. (KGS)</Label>
              <div className="h-10 px-3 rounded-md border flex items-center">
                {fmt2(totals.totalGw)}
              </div>
            </div>
            <div>
              <Label>Total N.W. (KGS)</Label>
              <div className="h-10 px-3 rounded-md border flex items-center">
                {fmt2(totals.totalNw)}
              </div>
            </div>
          </div>

          <div className="border rounded-md overflow-auto max-h-[480px]">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-2 py-1 border w-20 text-center">PO No</th>
                  <th className="px-2 py-1 border w-10 text-center">Line</th>
                  <th className="px-2 py-1 border w-24 text-center">Style No</th>
                  <th className="px-2 py-1 border w-[260px] text-left">Description</th>
                  <th className="px-2 py-1 border w-20 text-center">Color</th>
                  <th className="px-2 py-1 border w-16 text-center">Size</th>
                  <th className="px-2 py-1 border w-20 text-right">Order Qty</th>
                  <th className="px-2 py-1 border w-24 text-right">Shipped Qty</th>
                  <th className="px-2 py-1 border w-24 text-right">Unit Price</th>
                  <th className="px-2 py-1 border w-24 text-right">Amount</th>
                  <th className="px-2 py-1 border w-20 text-right">Cartons</th>
                  <th className="px-2 py-1 border w-24 text-right">GW/CTN</th>
                  <th className="px-2 py-1 border w-24 text-right">NW/CTN</th>
                  <th className="px-2 py-1 border w-24 text-right">GW Total</th>
                  <th className="px-2 py-1 border w-24 text-right">NW Total</th>
                </tr>
              </thead>

              <tbody>
                {lines.map((line) => {
                  const gwTotal = (line.cartons || 0) * (line.gwPerCtn || 0);
                  const nwTotal = (line.cartons || 0) * (line.nwPerCtn || 0);

                  return (
                    <tr key={line.poLineId}>
                      <td className="px-2 py-1 text-center border">{line.poNo}</td>
                      <td className="px-2 py-1 text-center border">{line.lineNo}</td>
                      <td className="px-2 py-1 text-center border">{line.styleNo ?? "-"}</td>
                      <td className="px-2 py-1 text-left border">{line.description ?? "-"}</td>
                      <td className="px-2 py-1 text-center border">{line.color ?? "-"}</td>
                      <td className="px-2 py-1 text-center border">{line.size ?? "-"}</td>
                      <td className="px-2 py-1 text-right border">{line.orderQty.toLocaleString()}</td>

                      <td className="px-2 py-1 text-right border">
                        <Input
                          className="h-7 text-right"
                          type="number"
                          value={line.shippedQty}
                          onChange={(e) => {
                            const v = safeNumber(e.target.value, 0);
                            updateLine(line.poId, line.poLineId, { shippedQty: v });
                          }}
                        />
                      </td>

                      <td className="px-2 py-1 text-right border">
                        {line.unitPrice.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>

                      <td className="px-2 py-1 text-right border">
                        {(line.amount || 0).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>

                      <td className="px-2 py-1 text-right border">
                        <Input
                          className="h-7 text-right"
                          type="number"
                          value={line.cartons}
                          onChange={(e) => {
                            const v = safeNumber(e.target.value, 0);
                            updateLine(line.poId, line.poLineId, { cartons: v });
                          }}
                        />
                      </td>

                      <td className="px-2 py-1 text-right border">
                        <Input
                          className="h-7 text-right"
                          type="number"
                          value={line.gwPerCtn}
                          onChange={(e) => {
                            const v = safeNumber(e.target.value, 0);
                            updateLine(line.poId, line.poLineId, { gwPerCtn: v });
                          }}
                        />
                      </td>

                      <td className="px-2 py-1 text-right border">
                        <Input
                          className="h-7 text-right"
                          type="number"
                          value={line.nwPerCtn}
                          onChange={(e) => {
                            const v = safeNumber(e.target.value, 0);
                            updateLine(line.poId, line.poLineId, { nwPerCtn: v });
                          }}
                        />
                      </td>

                      <td className="px-2 py-1 text-right border">{fmt2(gwTotal)}</td>
                      <td className="px-2 py-1 text-right border">{fmt2(nwTotal)}</td>
                    </tr>
                  );
                })}

                {!lines.length && (
                  <tr>
                    <td className="px-2 py-4 border text-center text-gray-500" colSpan={15}>
                      상단에서 PO 를 선택하면 라인이 자동으로 로딩됩니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end mb-8">
        <Button onClick={handleCreateShipment} disabled={saving || selectedPos.length === 0}>
          {saving ? "Saving..." : "Save Shipment"}
        </Button>
      </div>
    </AppShell>
  );
}