// src/app/shipments/create/page.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

type DevRole = AppRole;

// 숫자 안전 변환
const safeNumber = (v: any, fallback = 0): number => {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) return fallback;
  return n;
};

interface PoListItem {
  id: string;
  po_no: string | null;
  buyer_name: string | null;
  currency: string | null;
  order_date: string | null;
  status: string | null;
}

interface ShipmentHeaderForm {
  id?: string | null;
  shipment_no?: string | null;
  po_header_id: string | null;
  po_no: string | null;
  buyer_id: string | null;
  buyer_name: string | null;
  currency: string | null;
  incoterm: string | null;
  payment_term: string | null;
  shipping_origin_code: string | null;
  destination: string | null;
  etd: string | null;
  eta: string | null;
  status: string | null;
  // 합계(자동/수동 겸용)
  total_cartons?: number | null;
  total_gw?: number | null;
  total_nw?: number | null;
}

interface ShipmentLineForm {
  po_line_id: string | null;
  line_no: number;
  style_no: string | null;
  description: string | null;
  color: string | null;
  size: string | null;
  // 이번 선적에 사용 가능한 남은 수량
  order_qty: number;
  // 실제 선적 수량 (0이면 이번 선적에서 제외)
  shipped_qty: number;
  unit_price: number;
  amount: number;
  cartons: number;
  gw: number;
  nw: number;
  // 참고용
  ordered_total_qty?: number;
  shipped_so_far?: number;
}

export default function ShipmentCreatePage() {
  const router = useRouter();
  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);

  const [role] = React.useState<DevRole>("admin");

  // STEP 1: PO 선택
  const [poLoading, setPoLoading] = React.useState(true);
  const [poError, setPoError] = React.useState<string | null>(null);
  const [poItems, setPoItems] = React.useState<PoListItem[]>([]);
  const [poKeyword, setPoKeyword] = React.useState("");
  const [selectedPoId, setSelectedPoId] = React.useState<string | null>(null);

  // STEP 2: Shipment 데이터
  const [header, setHeader] = React.useState<ShipmentHeaderForm | null>(null);
  const [lines, setLines] = React.useState<ShipmentLineForm[]>([]);
  const [shipmentError, setShipmentError] = React.useState<string | null>(null);
  const [shipmentLoading, setShipmentLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  // 합계 모드: true = 라인 합계 자동계산, false = 수동입력
  const [autoTotals, setAutoTotals] = React.useState(true);

  // =========================
  // 1) PO 리스트 로드
  // =========================
  React.useEffect(() => {
    const run = async () => {
      try {
        setPoLoading(true);
        setPoError(null);

        const { data, error } = await supabase
          .from("po_headers")
          .select("id, po_no, buyer_name, currency, order_date, status")
          .order("created_at", { ascending: false })
          .limit(200);

        if (error) throw error;
        setPoItems((data || []) as PoListItem[]);
      } catch (err: any) {
        console.error("[ShipmentCreate] PO load error:", err);
        setPoError(
          err.message || "PO 리스트를 불러오는 중 오류가 발생했습니다."
        );
      } finally {
        setPoLoading(false);
      }
    };
    run();
  }, [supabase]);

  const filteredPoItems = React.useMemo(() => {
    if (!poKeyword.trim()) return poItems;
    const lower = poKeyword.trim().toLowerCase();
    return poItems.filter((po) => {
      const poNo = po.po_no?.toLowerCase() ?? "";
      const buyer = po.buyer_name?.toLowerCase() ?? "";
      const status = po.status?.toLowerCase() ?? "";
      return (
        poNo.includes(lower) || buyer.includes(lower) || status.includes(lower)
      );
    });
  }, [poItems, poKeyword]);

  // =========================
  // 2) 선택한 PO 기준 Shipment 초안 호출
  // =========================
  const loadShipmentFromPo = async (poId: string) => {
    try {
      setSelectedPoId(poId);
      setShipmentLoading(true);
      setShipmentError(null);

      const res = await fetch("/api/shipments/from-po", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poHeaderId: poId }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Shipment용 PO 로딩 중 오류");
      }

      const fromApiHeader = json.shipmentHeader;
      const fromApiLines = json.shipmentLines || [];

      const headerForm: ShipmentHeaderForm = {
        id: null,
        shipment_no: null,
        po_header_id: fromApiHeader.po_header_id ?? null,
        po_no: fromApiHeader.po_no ?? null,
        buyer_id: fromApiHeader.buyer_id ?? null,
        buyer_name: fromApiHeader.buyer_name ?? null,
        currency: fromApiHeader.currency ?? null,
        incoterm: fromApiHeader.incoterm ?? null,
        payment_term: fromApiHeader.payment_term ?? null,
        shipping_origin_code: fromApiHeader.shipping_origin_code ?? null,
        destination: fromApiHeader.destination ?? null,
        etd: null,
        eta: null,
        status: "DRAFT",
        total_cartons: 0,
        total_gw: 0,
        total_nw: 0,
      };

      const lineForms: ShipmentLineForm[] = fromApiLines.map(
        (line: any, idx: number) => {
          const remaining = safeNumber(line.order_qty);
          const unitPrice = safeNumber(line.unit_price);

          return {
            po_line_id: line.po_line_id ?? line.id ?? null,
            line_no: line.line_no ?? idx + 1,
            style_no: line.style_no ?? null,
            description: line.description ?? null,
            color: line.color ?? null,
            size: line.size ?? null,
            order_qty: remaining, // 이번 선적 가능 수량
            shipped_qty: remaining, // 기본값: 전량
            unit_price: unitPrice,
            amount: remaining * unitPrice,
            cartons: 0,
            gw: 0,
            nw: 0,
            ordered_total_qty: safeNumber(line.ordered_total_qty),
            shipped_so_far: safeNumber(line.shipped_so_far),
          };
        }
      );

      setHeader(headerForm);
      setLines(lineForms);
    } catch (err: any) {
      console.error("[ShipmentCreate] loadShipmentFromPo error:", err);
      setShipmentError(
        err.message || "Shipment 초안 생성 중 오류가 발생했습니다."
      );
      setHeader(null);
      setLines([]);
    } finally {
      setShipmentLoading(false);
    }
  };

  // =========================
  // 공통 핸들러
  // =========================
  const handleHeaderChange = (
    field: keyof ShipmentHeaderForm,
    value: string
  ) => {
    setHeader((prev) => {
      if (!prev) return prev;

      if (
        field === "total_cartons" ||
        field === "total_gw" ||
        field === "total_nw"
      ) {
        const num = safeNumber(value, 0);
        return { ...prev, [field]: num };
      }

      return {
        ...prev,
        [field]: value === "" ? null : value,
      };
    });
  };

  const handleLineChange = (
    index: number,
    field: keyof ShipmentLineForm,
    value: string
  ) => {
    setLines((prev) => {
      const next = [...prev];
      const target = { ...next[index] };

      if (
        field === "order_qty" ||
        field === "shipped_qty" ||
        field === "unit_price" ||
        field === "cartons" ||
        field === "gw" ||
        field === "nw"
      ) {
        const numValue = safeNumber(value, 0);
        (target as any)[field] = numValue;

        if (field === "shipped_qty" || field === "unit_price") {
          const qty =
            field === "shipped_qty" ? numValue : safeNumber(target.shipped_qty);
          const price =
            field === "unit_price" ? numValue : safeNumber(target.unit_price);
          target.amount = qty * price;
        }
      } else {
        (target as any)[field] = value === "" ? null : value;
      }

      next[index] = target;
      return next;
    });
  };

  // shipped_qty > 0 인 라인만 이번 선적에 포함
  const effectiveLines = React.useMemo(
    () => lines.filter((l) => l.shipped_qty > 0),
    [lines]
  );

  // 라인 기준 자동 합계
  const autoTotalsValue = React.useMemo(() => {
    let cartons = 0;
    let gw = 0;
    let nw = 0;
    effectiveLines.forEach((l) => {
      cartons += l.cartons || 0;
      gw += l.gw || 0;
      nw += l.nw || 0;
    });
    return { cartons, gw, nw };
  }, [effectiveLines]);

  // Auto 모드일 때만 header.total_* 을 자동합계로 동기화
  // header 를 dependency에 넣지 않고, prev 값 비교해서 필요할 때만 업데이트
  React.useEffect(() => {
    if (!autoTotals) return;

    setHeader((prev) => {
      if (!prev) return prev;

      const same =
        (prev.total_cartons ?? 0) === autoTotalsValue.cartons &&
        (prev.total_gw ?? 0) === autoTotalsValue.gw &&
        (prev.total_nw ?? 0) === autoTotalsValue.nw;

      if (same) return prev;

      return {
        ...prev,
        total_cartons: autoTotalsValue.cartons,
        total_gw: autoTotalsValue.gw,
        total_nw: autoTotalsValue.nw,
      };
    });
  }, [autoTotals, autoTotalsValue]);

  const handleSave = async () => {
    if (!header) return;
    if (effectiveLines.length === 0) {
      alert("선적 수량이 0인 스타일만 있어서 저장할 수 없습니다.");
      return;
    }

    try {
      setSaving(true);
      setShipmentError(null);

      const payload = {
        shipmentHeader: header,
        shipmentLines: effectiveLines,
      };

      const res = await fetch("/api/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Shipment 저장 중 오류 발생");
      }

      alert(`Shipment 저장 완료\nNo: ${json.shipmentNo}`);
      router.push("/shipments");
    } catch (err: any) {
      console.error("[ShipmentCreate] save error:", err);
      setShipmentError(err.message || "Shipment 저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  // =========================
  // 렌더
  // =========================
  return (
    <AppShell currentRole={role}>
      <div className="p-6 space-y-6">
        {/* STEP 1: PO 선택 */}
        <Card>
          <CardHeader>
            <CardTitle>1. Select PO for Shipment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col md:flex-row gap-3 items-end">
              <div className="flex-1">
                <Label className="block mb-1">Search PO</Label>
                <Input
                  placeholder="PO No / Buyer / Status"
                  value={poKeyword}
                  onChange={(e) => setPoKeyword(e.target.value)}
                />
              </div>
            </div>

            {poLoading ? (
              <div className="py-4">Loading PO...</div>
            ) : poError ? (
              <div className="py-3 text-sm text-red-600 border border-red-300 bg-red-50 rounded-md px-3">
                {poError}
              </div>
            ) : (
              <div className="overflow-x-auto max-h-80 border rounded-md">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="border px-2 py-1">PO No</th>
                      <th className="border px-2 py-1">Buyer</th>
                      <th className="border px-2 py-1">Order Date</th>
                      <th className="border px-2 py-1">Currency</th>
                      <th className="border px-2 py-1">Status</th>
                      <th className="border px-2 py-1 w-24">Select</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPoItems.length === 0 ? (
                      <tr>
                        <td
                          className="border px-2 py-4 text-center text-gray-500"
                          colSpan={6}
                        >
                          해당 조건의 PO가 없습니다.
                        </td>
                      </tr>
                    ) : (
                      filteredPoItems.map((po) => (
                        <tr key={po.id} className="border-t">
                          <td className="border px-2 py-1">{po.po_no ?? "-"}</td>
                          <td className="border px-2 py-1">
                            {po.buyer_name ?? "-"}
                          </td>
                          <td className="border px-2 py-1">
                            {po.order_date
                              ? new Date(po.order_date).toLocaleDateString()
                              : "-"}
                          </td>
                          <td className="border px-2 py-1">
                            {po.currency ?? "-"}
                          </td>
                          <td className="border px-2 py-1">
                            {po.status ?? "-"}
                          </td>
                          <td className="border px-2 py-1 text-center">
                            <Button
                              size="sm"
                              variant={
                                selectedPoId === po.id ? "default" : "outline"
                              }
                              onClick={() => loadShipmentFromPo(po.id)}
                            >
                              {selectedPoId === po.id ? "Selected" : "Select"}
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* STEP 2: Shipment 상세 */}
        <Card>
          <CardHeader>
            <CardTitle>2. Shipment Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {shipmentLoading && <div>Loading shipment draft...</div>}
            {shipmentError && (
              <div className="text-sm text-red-600 border border-red-300 bg-red-50 rounded-md px-3 py-2">
                {shipmentError}
              </div>
            )}

            {!shipmentLoading && header && (
              <>
                {/* Header */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label className="block mb-1">PO No</Label>
                    <Input value={header.po_no ?? ""} readOnly />
                  </div>
                  <div>
                    <Label className="block mb-1">Buyer</Label>
                    <Input value={header.buyer_name ?? ""} readOnly />
                  </div>
                  <div>
                    <Label className="block mb-1">Currency</Label>
                    <Input value={header.currency ?? ""} readOnly />
                  </div>

                  <div>
                    <Label className="block mb-1">Incoterm</Label>
                    <Input
                      value={header.incoterm ?? ""}
                      onChange={(e) =>
                        handleHeaderChange("incoterm", e.target.value)
                      }
                    />
                  </div>
                  <div>
                    <Label className="block mb-1">Payment Term</Label>
                    <Input
                      value={header.payment_term ?? ""}
                      onChange={(e) =>
                        handleHeaderChange("payment_term", e.target.value)
                      }
                    />
                  </div>
                  <div>
                    <Label className="block mb-1">Destination</Label>
                    <Input
                      value={header.destination ?? ""}
                      onChange={(e) =>
                        handleHeaderChange("destination", e.target.value)
                      }
                    />
                  </div>

                  <div>
                    <Label className="block mb-1">ETD</Label>
                    <Input
                      type="date"
                      value={header.etd ?? ""}
                      onChange={(e) =>
                        handleHeaderChange("etd", e.target.value)
                      }
                    />
                  </div>
                  <div>
                    <Label className="block mb-1">ETA</Label>
                    <Input
                      type="date"
                      value={header.eta ?? ""}
                      onChange={(e) =>
                        handleHeaderChange("eta", e.target.value)
                      }
                    />
                  </div>
                  <div>
                    <Label className="block mb-1">Status</Label>
                    <Input
                      value={header.status ?? "DRAFT"}
                      onChange={(e) =>
                        handleHeaderChange("status", e.target.value)
                      }
                    />
                  </div>
                </div>

                <Separator />

                {/* 합계 영역: Auto/Manual 토글 */}
                <div className="flex items-center justify-between max-w-xl">
                  <div className="text-sm text-gray-600">
                    <span className="font-medium">Totals Mode:</span>{" "}
                    {autoTotals ? "라인 합계 자동 계산" : "수동 입력"}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Manual</span>
                    <Switch
                      checked={autoTotals}
                      onCheckedChange={(v) => setAutoTotals(v)}
                    />
                    <span className="text-xs text-gray-500">Auto</span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 max-w-xl mt-2">
                  <div>
                    <Label className="block mb-1">Total Cartons</Label>
                    <Input
                      type="number"
                      value={
                        autoTotals
                          ? autoTotalsValue.cartons
                          : header.total_cartons ?? 0
                      }
                      readOnly={autoTotals}
                      onChange={(e) =>
                        !autoTotals &&
                        handleHeaderChange(
                          "total_cartons",
                          e.target.value
                        )
                      }
                    />
                  </div>
                  <div>
                    <Label className="block mb-1">Total G.W.</Label>
                    <Input
                      type="number"
                      value={
                        autoTotals
                          ? autoTotalsValue.gw
                          : header.total_gw ?? 0
                      }
                      readOnly={autoTotals}
                      onChange={(e) =>
                        !autoTotals &&
                        handleHeaderChange("total_gw", e.target.value)
                      }
                    />
                  </div>
                  <div>
                    <Label className="block mb-1">Total N.W.</Label>
                    <Input
                      type="number"
                      value={
                        autoTotals
                          ? autoTotalsValue.nw
                          : header.total_nw ?? 0
                      }
                      readOnly={autoTotals}
                      onChange={(e) =>
                        !autoTotals &&
                        handleHeaderChange("total_nw", e.target.value)
                      }
                    />
                  </div>
                </div>

                {/* Lines */}
                <div className="mt-4">
                  <Label className="block mb-2">
                    Shipment Lines (shipped qty 0 =&gt; 이번 선적에서 제외)
                  </Label>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm border">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="border px-2 py-1">Line</th>
                          <th className="border px-2 py-1">Style No</th>
                          <th className="border px-2 py-1">Description</th>
                          <th className="border px-2 py-1">Color</th>
                          <th className="border px-2 py-1">Size</th>
                          <th className="border px-2 py-1">
                            Remaining Qty
                          </th>
                          <th className="border px-2 py-1">
                            Shipped Qty (this)
                          </th>
                          <th className="border px-2 py-1">Unit Price</th>
                          <th className="border px-2 py-1">Amount</th>
                          <th className="border px-2 py-1">Cartons</th>
                          <th className="border px-2 py-1">G.W.</th>
                          <th className="border px-2 py-1">N.W.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.length === 0 ? (
                          <tr>
                            <td
                              className="border px-2 py-4 text-center text-gray-500"
                              colSpan={12}
                            >
                              남은 수량이 있는 스타일이 없습니다.
                            </td>
                          </tr>
                        ) : (
                          lines.map((line, idx) => (
                            <tr key={idx} className="border-t">
                              <td className="border px-2 py-1 text-center">
                                {line.line_no}
                              </td>
                              <td className="border px-2 py-1">
                                <Input
                                  value={line.style_no ?? ""}
                                  onChange={(e) =>
                                    handleLineChange(
                                      idx,
                                      "style_no",
                                      e.target.value
                                    )
                                  }
                                />
                                {line.ordered_total_qty !== undefined && (
                                  <div className="mt-1 text-[10px] text-gray-500">
                                    Ordered: {line.ordered_total_qty} / Shipped
                                    so far: {line.shipped_so_far ?? 0}
                                  </div>
                                )}
                              </td>
                              <td className="border px-2 py-1">
                                <Input
                                  value={line.description ?? ""}
                                  onChange={(e) =>
                                    handleLineChange(
                                      idx,
                                      "description",
                                      e.target.value
                                    )
                                  }
                                />
                              </td>
                              <td className="border px-2 py-1">
                                <Input
                                  value={line.color ?? ""}
                                  onChange={(e) =>
                                    handleLineChange(
                                      idx,
                                      "color",
                                      e.target.value
                                    )
                                  }
                                />
                              </td>
                              <td className="border px-2 py-1">
                                <Input
                                  value={line.size ?? ""}
                                  onChange={(e) =>
                                    handleLineChange(
                                      idx,
                                      "size",
                                      e.target.value
                                    )
                                  }
                                />
                              </td>
                              <td className="border px-2 py-1">
                                <Input
                                  type="number"
                                  value={line.order_qty}
                                  readOnly
                                />
                              </td>
                              <td className="border px-2 py-1">
                                <Input
                                  type="number"
                                  value={line.shipped_qty}
                                  onChange={(e) =>
                                    handleLineChange(
                                      idx,
                                      "shipped_qty",
                                      e.target.value
                                    )
                                  }
                                />
                              </td>
                              <td className="border px-2 py-1">
                                <Input
                                  type="number"
                                  value={line.unit_price}
                                  onChange={(e) =>
                                    handleLineChange(
                                      idx,
                                      "unit_price",
                                      e.target.value
                                    )
                                  }
                                />
                              </td>
                              <td className="border px-2 py-1">
                                <Input
                                  type="number"
                                  value={line.amount}
                                  readOnly
                                />
                              </td>
                              <td className="border px-2 py-1">
                                <Input
                                  type="number"
                                  value={line.cartons}
                                  onChange={(e) =>
                                    handleLineChange(
                                      idx,
                                      "cartons",
                                      e.target.value
                                    )
                                  }
                                />
                              </td>
                              <td className="border px-2 py-1">
                                <Input
                                  type="number"
                                  value={line.gw}
                                  onChange={(e) =>
                                    handleLineChange(
                                      idx,
                                      "gw",
                                      e.target.value
                                    )
                                  }
                                />
                              </td>
                              <td className="border px-2 py-1">
                                <Input
                                  type="number"
                                  value={line.nw}
                                  onChange={(e) =>
                                    handleLineChange(
                                      idx,
                                      "nw",
                                      e.target.value
                                    )
                                  }
                                />
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex justify-end mt-4">
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? "Saving..." : "Save Shipment"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
