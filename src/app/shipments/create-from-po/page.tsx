"use client";

// src/app/shipments/create-from-po/page.tsx
// 부분선적 잔량 기준 버전
// - 기존 shipment 누적수량을 차감하여 remaining_qty만 표시
// - 전량 선적 완료 라인은 자동 제외
// - split 허용, 저장 시 서버에서도 remaining 재검증

import * as React from "react";
import { useRouter } from "next/navigation";

import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type DevRole = AppRole;
type ShipMode = "SEA" | "AIR" | "COURIER";

function safe(v: any) {
  return (v ?? "").toString().trim();
}
function num(v: any, fallback = 0) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function num1(v: any, fallback = 0) {
  if (v === null || v === undefined || v === "") return fallback;
  const s = String(v).replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n * 10) / 10;
}
function fmt2(n: number) {
  return (Number(n) || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function money(v: any, currency = "USD") {
  const n = num(v, 0);
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}
function pickFirst(obj: any, keys: string[]) {
  for (const k of keys) {
    const val = obj?.[k];
    if (val !== null && val !== undefined && safe(val) !== "") return val;
  }
  return "";
}
function normalizeMode(v: any): ShipMode {
  const s = safe(v).toUpperCase();
  if (s.includes("AIR")) return "AIR";
  if (s.includes("COURIER") || s.includes("DHL") || s.includes("FEDEX") || s.includes("UPS")) {
    return "COURIER";
  }
  return "SEA";
}
function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}
function originCodeToCooText(code: string | null | undefined) {
  const v = safe(code).toUpperCase();
  if (!v) return "";
  if (v.startsWith("VN_")) return "MADE IN VIETNAM";
  if (v.startsWith("CN_")) return "MADE IN CHINA";
  if (v.startsWith("KR_")) return "MADE IN KOREA";
  return "";
}
function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

const CANCELLED_SHIPMENT_STATUSES = new Set(["CANCELLED", "DELETED"]);
const SHIPMENT_CREATE_DRAFT_KEY = "jm.shipments.createFromPo.draft.v1";
const SHIPMENT_CREATE_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type PoHeader = any;
type PoLine = any;
type ShipmentLine = any;
type ShipmentHeaderLite = {
  id: string;
  status?: string | null;
  is_deleted?: boolean | null;
};

type AllocationRow = {
  id: string;
  po_id: string;
  po_no: string;
  po_line_id: string;
  line_no: number | null;

  style_no: string;
  description: string;
  color: string;
  size: string;

  order_qty: number;
  prev_shipped_qty: number;
  remaining_qty: number;
  shipped_qty: number;

  unit_price: number;
  amount: number;

  cartons: number;
  gw_per_ctn: number;
  nw_per_ctn: number;
  gw_per_ctn_raw?: string;
  nw_per_ctn_raw?: string;

  include: boolean;
  ship_mode: ShipMode;
  carrier: string;
  tracking_no: string;
};

type ShipmentCreateDraft = {
  version: 1;
  savedAt: string;
  searchText: string;
  poList: PoHeader[];
  selectedPoIds: string[];
  selectedHeaders: PoHeader[];
  allocs: AllocationRow[];
};

async function resolveIncotermFallback(supabase: any, buyerId: string | null): Promise<string | null> {
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

export default function ShipmentsCreateFromPoPage() {
  const currentRole: DevRole = ("staff" as any) as DevRole;

  const router = useRouter();
  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);

  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const [searchText, setSearchText] = React.useState("");
  const [poList, setPoList] = React.useState<PoHeader[]>([]);
  const [poLoading, setPoLoading] = React.useState(false);

  const [selectedPoIds, setSelectedPoIds] = React.useState<string[]>([]);
  const [selectedHeaders, setSelectedHeaders] = React.useState<PoHeader[]>([]);
  const [allocs, setAllocs] = React.useState<AllocationRow[]>([]);
  const [draftLoaded, setDraftLoaded] = React.useState(false);

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SHIPMENT_CREATE_DRAFT_KEY);
      if (!raw) return;

      const draft = JSON.parse(raw) as Partial<ShipmentCreateDraft>;
      const savedAtMs = Date.parse(String(draft?.savedAt ?? ""));
      if (
        draft?.version !== 1 ||
        !Number.isFinite(savedAtMs) ||
        Date.now() - savedAtMs > SHIPMENT_CREATE_DRAFT_TTL_MS
      ) {
        window.localStorage.removeItem(SHIPMENT_CREATE_DRAFT_KEY);
        return;
      }

      setSearchText(typeof draft.searchText === "string" ? draft.searchText : "");
      setPoList(Array.isArray(draft.poList) ? draft.poList : []);
      setSelectedPoIds(Array.isArray(draft.selectedPoIds) ? draft.selectedPoIds : []);
      setSelectedHeaders(Array.isArray(draft.selectedHeaders) ? draft.selectedHeaders : []);
      setAllocs(Array.isArray(draft.allocs) ? draft.allocs : []);
    } catch (e) {
      console.warn("Failed to restore shipment draft:", e);
      window.localStorage.removeItem(SHIPMENT_CREATE_DRAFT_KEY);
    } finally {
      setDraftLoaded(true);
    }
  }, []);

  const hasDraftData = React.useMemo(
    () =>
      searchText.trim() !== "" ||
      poList.length > 0 ||
      selectedPoIds.length > 0 ||
      selectedHeaders.length > 0 ||
      allocs.length > 0,
    [searchText, poList, selectedPoIds, selectedHeaders, allocs]
  );

  React.useEffect(() => {
    if (!draftLoaded) return;

    try {
      if (!hasDraftData) {
        window.localStorage.removeItem(SHIPMENT_CREATE_DRAFT_KEY);
        return;
      }

      const draft: ShipmentCreateDraft = {
        version: 1,
        savedAt: new Date().toISOString(),
        searchText,
        poList,
        selectedPoIds,
        selectedHeaders,
        allocs,
      };
      window.localStorage.setItem(SHIPMENT_CREATE_DRAFT_KEY, JSON.stringify(draft));
    } catch (e) {
      console.warn("Failed to save shipment draft:", e);
    }
  }, [draftLoaded, hasDraftData, searchText, poList, selectedPoIds, selectedHeaders, allocs]);

  const discardDraft = React.useCallback(() => {
    try {
      window.localStorage.removeItem(SHIPMENT_CREATE_DRAFT_KEY);
    } catch {}
  }, []);

  const selectedBuyerId = React.useMemo(() => {
    const h = selectedHeaders?.[0];
    return pickFirst(h, ["buyer_company_id", "buyer_id", "company_id"]) || "";
  }, [selectedHeaders]);

  const loadShippedAggByPoLine = React.useCallback(
    async (poLineIds: string[]) => {
      const shippedByLineId = new Map<string, number>();
      if (!poLineIds.length) return shippedByLineId;

      const { data: rawShipmentLines, error: slErr } = await supabase
        .from("shipment_lines")
        .select("id, shipment_id, po_line_id, shipped_qty, is_deleted")
        .in("po_line_id", poLineIds)
        .eq("is_deleted", false);

      if (slErr) throw slErr;

      const shipmentLines: ShipmentLine[] = rawShipmentLines ?? [];
      if (!shipmentLines.length) return shippedByLineId;

      const shipmentIds = Array.from(
        new Set(
          shipmentLines
            .map((r: any) => safe(r?.shipment_id))
            .filter(Boolean)
        )
      );

      const allowedShipmentIdSet = new Set<string>();
      if (shipmentIds.length) {
        const { data: shipments, error: shErr } = await supabase
          .from("shipments")
          .select("id, status, is_deleted")
          .in("id", shipmentIds);

        if (shErr) throw shErr;

        for (const sh of (shipments ?? []) as ShipmentHeaderLite[]) {
          const id = safe(sh?.id);
          if (!id) continue;
          if (Boolean(sh?.is_deleted)) continue;
          const status = safe(sh?.status).toUpperCase();
          if (CANCELLED_SHIPMENT_STATUSES.has(status)) continue;
          allowedShipmentIdSet.add(id);
        }
      }

      for (const row of shipmentLines) {
        const shipmentId = safe((row as any)?.shipment_id);
        if (allowedShipmentIdSet.size && !allowedShipmentIdSet.has(shipmentId)) continue;
        const lineId = safe((row as any)?.po_line_id);
        if (!lineId) continue;
        const shipped = num((row as any)?.shipped_qty, 0);
        shippedByLineId.set(lineId, num(shippedByLineId.get(lineId), 0) + shipped);
      }

      return shippedByLineId;
    },
    [supabase]
  );

  const handleSearchPo = React.useCallback(
    async (q?: string) => {
      const keyword = (q ?? searchText).trim();
      if (!keyword) {
        setPoList([]);
        return;
      }

      setPoLoading(true);
      try {
        const like = `%${keyword}%`;

        let qq = supabase
          .from("po_headers")
          .select("*")
          .or(
            [
              `po_no.ilike.${like}`,
              `buyer_name.ilike.${like}`,
              `buyer_brand_name.ilike.${like}`,
              `final_destination.ilike.${like}`,
              `destination.ilike.${like}`,
            ].join(",")
          )
          .order("created_at", { ascending: false })
          .limit(100);

        let headers: any[] = [];
        try {
          const { data, error } = await qq.eq("status", "CONFIRMED");
          if (!error) headers = data ?? [];
          else {
            const { data: data2, error: error2 } = await qq;
            if (error2) throw error2;
            headers = data2 ?? [];
          }
        } catch (e: any) {
          console.error(e);
          alert(`PO 검색 오류: ${e?.message ?? e}`);
          setPoList([]);
          return;
        }

        if (!headers.length) {
          setPoList([]);
          return;
        }

        const blockedStatuses = new Set([
          "CANCELLED",
          "CANCELED",
          "DELETED",
          "CLOSED",
          "CLOSE",
          "DONE",
          "COMPLETED",
          "SHIPPED",
        ]);

        const activeHeaders = headers.filter((h: any) => {
          if (Boolean(h?.is_deleted)) return false;
          const st = safe(h?.status).toUpperCase();
          if (st && blockedStatuses.has(st)) return false;
          return true;
        });

        if (!activeHeaders.length) {
          setPoList([]);
          return;
        }

        const poIds = activeHeaders.map((h: any) => safe(h.id)).filter(Boolean);

        const { data: poLines, error: lineErr } = await supabase
          .from("po_lines")
          .select("*")
          .in("po_header_id", poIds);

        if (lineErr) throw lineErr;

        const activeLines = (poLines ?? []).filter((ln: any) =>
          ln?.is_deleted === undefined ? true : ln.is_deleted === false
        );

        const lineIds = activeLines.map((ln: any) => safe(ln?.id)).filter(Boolean);
        const shippedAgg = await loadShippedAggByPoLine(lineIds);

        const remainingByPo = new Map<string, number>();
        for (const ln of activeLines) {
          const poId = safe((ln as any)?.po_header_id);
          const lineId = safe((ln as any)?.id);
          if (!poId || !lineId) continue;

          const orderQty = num(
            (ln as any)?.qty ?? (ln as any)?.order_qty ?? (ln as any)?.orderQty,
            0
          );
          const shippedQty = num(shippedAgg.get(lineId), 0);
          const remainingQty = Math.max(0, orderQty - shippedQty);

          remainingByPo.set(poId, num(remainingByPo.get(poId), 0) + remainingQty);
        }

        const filtered = activeHeaders.filter((h: any) => {
          const poId = safe(h?.id);
          return num(remainingByPo.get(poId), 0) > 0;
        });

        setPoList(filtered);
      } catch (e: any) {
        console.error(e);
        alert(`PO 검색 오류: ${e?.message ?? e}`);
        setPoList([]);
      } finally {
        setPoLoading(false);
      }
    },
    [searchText, supabase, loadShippedAggByPoLine]
  );

  const onKeyDownSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSearchPo();
  };

  const loadPoLines = React.useCallback(
    async (po: PoHeader) => {
      let fixedPo = po;
      const buyerId = pickFirst(po, ["buyer_company_id", "buyer_id", "company_id"]) || null;
      const incoterm = pickFirst(po, ["incoterm"]);
      if (!incoterm && buyerId) {
        const fallback = await resolveIncotermFallback(supabase, buyerId);
        if (fallback) fixedPo = { ...po, incoterm: fallback };
      }

      const { data, error } = await supabase
        .from("po_lines")
        .select("*")
        .eq("po_header_id", po.id)
        .order("line_no", { ascending: true });

      if (error) throw error;

      const lineIds = (data ?? []).map((ln: any) => safe(ln?.id)).filter(Boolean);
      const shippedAgg = await loadShippedAggByPoLine(lineIds);

      const headerMode = normalizeMode(pickFirst(fixedPo, ["ship_mode", "shipMode", "shipmode"]));
      const po_no = pickFirst(fixedPo, ["po_no", "poNo"]);

      const rows: AllocationRow[] = (data ?? [])
        .filter((ln: any) => (ln?.is_deleted === undefined ? true : ln.is_deleted === false))
        .map((ln: PoLine) => {
          const orderQty = num(pickFirst(ln, ["qty", "order_qty", "orderQty"]), 0);
          const prevShipped = num(shippedAgg.get(safe(ln?.id)), 0);
          const remainingQty = Math.max(0, orderQty - prevShipped);
          const unitPrice = num(pickFirst(ln, ["unit_price", "unitPrice"]), 0);
          const style = pickFirst(ln, [
            "buyer_style_no",
            "buyer_style_code",
            "style_no",
            "jm_style_no",
            "jm_style_code",
          ]);
          const mode = normalizeMode(
            pickFirst(ln, ["ship_mode", "shipMode"]) ||
              pickFirst(fixedPo, ["ship_mode", "shipMode"]) ||
              headerMode
          );

          return {
            id: uid(),
            po_id: ln.po_header_id,
            po_no: safe(po_no),
            po_line_id: ln.id,
            line_no: ln.line_no ?? null,
            style_no: safe(style),
            description: safe(pickFirst(ln, ["description"])),
            color: safe(pickFirst(ln, ["color"])),
            size: safe(pickFirst(ln, ["size"])),
            order_qty: orderQty,
            prev_shipped_qty: prevShipped,
            remaining_qty: remainingQty,
            shipped_qty: remainingQty,
            unit_price: unitPrice,
            amount: remainingQty * unitPrice,
            cartons: 0,
            gw_per_ctn: 0,
            nw_per_ctn: 0,
            gw_per_ctn_raw: "",
            nw_per_ctn_raw: "",
            include: remainingQty > 0,
            ship_mode: mode,
            carrier: "",
            tracking_no: "",
          };
        })
        .filter((r) => r.remaining_qty > 0);

      rows.sort((a, b) => {
        if (a.po_no !== b.po_no) return a.po_no.localeCompare(b.po_no);
        return (a.line_no ?? 0) - (b.line_no ?? 0);
      });

      return { fixedPo, rows };
    },
    [supabase, loadShippedAggByPoLine]
  );

  const handleTogglePo = React.useCallback(
    async (po: PoHeader) => {
      const poId = po?.id;
      if (!poId) return;

      const already = selectedPoIds.includes(poId);
      if (already) {
        setSelectedPoIds((prev) => prev.filter((x) => x !== poId));
        setSelectedHeaders((prev) => prev.filter((x) => x.id !== poId));
        setAllocs((prev) => prev.filter((r) => r.po_id !== poId));
        return;
      }

      const buyerKey = pickFirst(po, ["buyer_company_id", "buyer_id", "company_id"]);
      if (!buyerKey) {
        alert("선택한 PO에 buyer_id가 없습니다. 먼저 PO에 buyer_id가 저장되어야 합니다.");
        return;
      }
      if (selectedBuyerId && buyerKey !== selectedBuyerId) {
        alert("같은 Buyer의 PO만 한 Shipment로 묶을 수 있습니다.");
        return;
      }

      setLoading(true);
      try {
        const { fixedPo, rows } = await loadPoLines(po);
        const buyerKey2 = pickFirst(fixedPo, ["buyer_company_id", "buyer_id", "company_id"]);
        if (!buyerKey2) {
          alert("buyer_id 가 PO에 없습니다. PO에 buyer_id가 저장되어 있어야 합니다.");
          return;
        }
        if (selectedBuyerId && buyerKey2 !== selectedBuyerId) {
          alert("같은 Buyer의 PO만 한 Shipment로 묶을 수 있습니다.");
          return;
        }

        if (rows.length === 0) {
          alert("이 PO는 이미 전량 shipment 생성되어 남은 수량이 없습니다.");
          return;
        }

        setSelectedPoIds((prev) => [...prev, fixedPo.id]);
        setSelectedHeaders((prev) => [...prev, fixedPo]);
        setAllocs((prev) => {
          const next = [...prev, ...rows];
          next.sort((a, b) => {
            if (a.po_no !== b.po_no) return a.po_no.localeCompare(b.po_no);
            return (a.line_no ?? 0) - (b.line_no ?? 0);
          });
          return next;
        });
      } catch (e: any) {
        console.error(e);
        alert(`PO 라인 로딩 실패: ${e?.message ?? e}`);
      } finally {
        setLoading(false);
      }
    },
    [selectedPoIds, selectedBuyerId, loadPoLines]
  );

  const clearSelection = React.useCallback(() => {
    setSelectedPoIds([]);
    setSelectedHeaders([]);
    setAllocs([]);
  }, []);

  const updateAlloc = (id: string, patch: Partial<AllocationRow>) => {
    setAllocs((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const merged = { ...r, ...patch };
        const maxQty = num(merged.remaining_qty, 0);
        const shippedQty = clamp(num(merged.shipped_qty, 0), 0, maxQty);
        merged.shipped_qty = shippedQty;
        merged.amount = shippedQty * num(merged.unit_price, 0);
        return merged;
      })
    );
  };

  const splitRow = (id: string) => {
    const row = allocs.find((r) => r.id === id);
    if (!row) return;

    const max = num(row.shipped_qty, 0);
    if (max <= 0) {
      alert("Shipped Qty가 0이면 split 할 수 없습니다.");
      return;
    }
    const input = window.prompt(`Split qty (0 ~ ${max})`, String(Math.floor(max / 2)));
    if (input === null) return;

    const splitQty = num(input, NaN as any);
    if (!Number.isFinite(splitQty) || splitQty <= 0 || splitQty >= max) {
      alert("Invalid split qty");
      return;
    }

    const remain = max - splitQty;

    setAllocs((prev) => {
      const next: AllocationRow[] = [];
      for (const r of prev) {
        if (r.id !== id) {
          next.push(r);
          continue;
        }
        next.push({ ...r, shipped_qty: splitQty, amount: splitQty * num(r.unit_price, 0) });
        next.push({
          ...r,
          id: uid(),
          shipped_qty: remain,
          amount: remain * num(r.unit_price, 0),
        });
      }
      return next;
    });
  };

  const removeRow = (id: string) => setAllocs((prev) => prev.filter((r) => r.id !== id));

  const header0 = selectedHeaders?.[0] ?? null;
  const buyerName = safe(pickFirst(header0, ["buyer_name", "buyerName"]));
  const currency = safe(pickFirst(header0, ["currency"])) || "USD";
  const shipDate = safe(pickFirst(header0, ["requested_ship_date", "ship_date", "shipDate"]));
  const incoterm = safe(pickFirst(header0, ["incoterm"]));
  const paymentTerm = safe(pickFirst(header0, ["payment_term", "paymentTerm"]));
  const destination = safe(pickFirst(header0, ["final_destination", "destination"]));
  const shippingOrigin = safe(pickFirst(header0, ["shipping_origin_code", "shipping_origin", "origin"]));
  const cooText = originCodeToCooText(shippingOrigin) || "-";

  const summary = React.useMemo(() => {
    const inc = allocs.filter((r) => r.include && num(r.shipped_qty, 0) > 0);

    const totalCartons = inc.reduce((acc, r) => acc + num(r.cartons, 0), 0);
    const totalGW = inc.reduce((acc, r) => acc + num(r.cartons, 0) * num(r.gw_per_ctn, 0), 0);
    const totalNW = inc.reduce((acc, r) => acc + num(r.cartons, 0) * num(r.nw_per_ctn, 0), 0);
    const totalAmount = inc.reduce((acc, r) => acc + num(r.shipped_qty, 0) * num(r.unit_price, 0), 0);

    const byMode: Record<ShipMode, { qty: number; amount: number }> = {
      SEA: { qty: 0, amount: 0 },
      AIR: { qty: 0, amount: 0 },
      COURIER: { qty: 0, amount: 0 },
    };
    for (const r of inc) {
      const m = r.ship_mode || "SEA";
      byMode[m].qty += num(r.shipped_qty, 0);
      byMode[m].amount += num(r.shipped_qty, 0) * num(r.unit_price, 0);
    }

    return { totalCartons, totalGW, totalNW, totalAmount, byMode };
  }, [allocs]);

  const save = async () => {
    const po_ids = selectedHeaders.map((h) => h.id).filter(Boolean);
    if (po_ids.length === 0) {
      alert("PO를 선택하세요.");
      return;
    }

    const includedRows = allocs.filter((r) => r.include && num(r.shipped_qty, 0) > 0);
    if (includedRows.length === 0) {
      alert("출고할 라인이 없습니다. (Shipped Qty > 0 필요)");
      return;
    }

    const reqByLine = new Map<string, number>();
    for (const r of includedRows) {
      reqByLine.set(r.po_line_id, num(reqByLine.get(r.po_line_id), 0) + num(r.shipped_qty, 0));
    }
    for (const r of allocs) {
      const requested = num(reqByLine.get(r.po_line_id), 0);
      if (requested > num(r.remaining_qty, 0)) {
        alert(
          `Style ${r.style_no || r.po_line_id}: 요청 출고수량 ${requested} 이(가) 남은 수량 ${r.remaining_qty} 을 초과합니다.`
        );
        return;
      }
    }

    const lines = includedRows.map((r) => ({
      po_id: r.po_id,
      po_line_id: r.po_line_id,
      shipped_qty: num(r.shipped_qty, 0),
      ship_mode: r.ship_mode,
      carrier: safe(r.carrier),
      tracking_no: safe(r.tracking_no),
      cartons: num(r.cartons, 0),
      gw_per_ctn: num(r.gw_per_ctn, 0),
      nw_per_ctn: num(r.nw_per_ctn, 0),
    }));

    setSaving(true);
    try {
      const res = await fetch("/api/shipments/create-from-po", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ po_ids, lines }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }

      const created = json?.created ?? [];
      const ids = created.map((x: any) => x.shipment_id).filter(Boolean);

      discardDraft();
      setSearchText("");
      setPoList([]);
      setSelectedPoIds([]);
      setSelectedHeaders([]);
      setAllocs([]);

      alert(`Saved. Created Shipment(s): ${created.length}`);
      if (ids.length === 1) {
        window.location.href = `/shipments/${ids[0]}`;
      } else {
        router.refresh();
      }
    } catch (e: any) {
      console.error(e);
      alert(`Save failed: ${e?.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell currentRole={currentRole}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-semibold">Create Shipment from PO</div>
            <div className="text-sm text-muted-foreground">
              남은 shipment 가능 수량만 표시됩니다. 기존 shipment 누적수량은 자동 차감됩니다.
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push("/shipments")}>
              Back
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>1. Select PO(s)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={onKeyDownSearch}
                placeholder="Search PO / Buyer / Brand / Destination..."
              />
              <Button onClick={() => handleSearchPo()} disabled={poLoading}>
                {poLoading ? "Searching..." : "Search"}
              </Button>
              <Button variant="outline" onClick={clearSelection} disabled={!selectedPoIds.length}>
                Clear
              </Button>
            </div>

            <div className="text-sm">
              <span className="font-semibold">Selected:</span>{" "}
              {selectedHeaders.length ? (
                <>
                  {selectedHeaders.length} PO(s) — Buyer: <span className="font-semibold">{buyerName || "-"}</span>{" "}
                  <span className="text-muted-foreground">
                    ({selectedHeaders.map((h) => safe(pickFirst(h, ["po_no", "poNo"]))).join(", ")})
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">none</span>
              )}
              <div className="text-xs text-muted-foreground mt-1">
                * 한 Shipment에는 <span className="font-semibold">같은 Buyer</span>의 PO만 선택 가능합니다.
              </div>
            </div>

            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[70px]">Select</TableHead>
                    <TableHead>PO No</TableHead>
                    <TableHead>Buyer</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead>Order Date</TableHead>
                    <TableHead>Ship Date</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {poList.map((h: any) => {
                    const id = h.id;
                    const checked = selectedPoIds.includes(id);
                    const poNo = safe(pickFirst(h, ["po_no", "poNo"]));
                    const buyer = safe(pickFirst(h, ["buyer_name", "buyerName"]));
                    const brand = safe(pickFirst(h, ["buyer_brand_name", "brand"]));
                    const od = safe(pickFirst(h, ["order_date", "created_at", "orderDate"])).slice(0, 10);
                    const sd = safe(pickFirst(h, ["requested_ship_date", "ship_date", "shipDate"])).slice(0, 10);
                    const cur = safe(pickFirst(h, ["currency"])) || "USD";
                    const st = safe(pickFirst(h, ["status"])) || "";
                    const buyerKey = pickFirst(h, ["buyer_company_id", "buyer_id", "company_id"]);
                    const disabled = !checked && !!selectedBuyerId && !!buyerKey && buyerKey !== selectedBuyerId;

                    return (
                      <TableRow key={id} className={disabled ? "opacity-60" : ""}>
                        <TableCell>
                          <Checkbox
                            checked={checked}
                            disabled={disabled}
                            onCheckedChange={() => handleTogglePo(h)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{poNo}</TableCell>
                        <TableCell>{buyer || "-"}</TableCell>
                        <TableCell>{brand || "-"}</TableCell>
                        <TableCell>{od || "-"}</TableCell>
                        <TableCell>{sd || "-"}</TableCell>
                        <TableCell>{cur}</TableCell>
                        <TableCell>{st}</TableCell>
                      </TableRow>
                    );
                  })}

                  {poList.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-muted-foreground">
                        Search to show PO list.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {selectedPoIds.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>2. Shipment Details from Selected PO(s)</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div>
                <div className="text-sm font-semibold">PO(s)</div>
                <div className="text-sm">
                  {selectedHeaders.length} — {selectedHeaders.map((h) => safe(pickFirst(h, ["po_no", "poNo"]))).join(", ")}
                </div>
              </div>
              <div>
                <div className="text-sm font-semibold">Buyer</div>
                <div className="text-sm">{buyerName || "-"}</div>
              </div>
              <div>
                <div className="text-sm font-semibold">Currency</div>
                <div className="text-sm">{currency}</div>
              </div>
              <div>
                <div className="text-sm font-semibold">Ship Date</div>
                <div className="text-sm">{shipDate ? shipDate.slice(0, 10) : "-"}</div>
              </div>
              <div>
                <div className="text-sm font-semibold">COO</div>
                <div className="text-sm">{cooText}</div>
              </div>

              <div>
                <div className="text-sm font-semibold">Incoterm</div>
                <div className="text-sm">{incoterm || "-"}</div>
              </div>
              <div>
                <div className="text-sm font-semibold">Payment Term</div>
                <div className="text-sm">{paymentTerm || "-"}</div>
              </div>
              <div className="md:col-span-2">
                <div className="text-sm font-semibold">Destination</div>
                <div className="text-sm">{destination || "-"}</div>
              </div>
              <div>
                <div className="text-sm font-semibold">Shipping Origin</div>
                <div className="text-sm">{shippingOrigin || "-"}</div>
              </div>

              <div className="md:col-span-5">
                <Separator className="my-2" />
                <div className="text-sm text-muted-foreground">
                  * 저장 시 라인별 Mode 기준으로 Shipment가 나뉘어 생성됩니다. 기존 shipment는 덮어쓰지 않고 새 shipment가 생성됩니다.
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {selectedPoIds.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>3. Shipment Lines & Totals (Remaining Qty Based)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <Label>Total Cartons</Label>
                  <Input value={String(summary.totalCartons)} readOnly />
                </div>
                <div>
                  <Label>Total G.W. (KGS)</Label>
                  <Input value={fmt2(summary.totalGW)} readOnly />
                </div>
                <div>
                  <Label>Total N.W. (KGS)</Label>
                  <Input value={fmt2(summary.totalNW)} readOnly />
                </div>
                <div>
                  <Label>Total Amount</Label>
                  <Input value={money(summary.totalAmount, currency)} readOnly />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div>
                  <span className="font-semibold">SEA</span>{" "}
                  <span className="text-muted-foreground">
                    Qty {summary.byMode.SEA.qty.toLocaleString()} / {money(summary.byMode.SEA.amount, currency)}
                  </span>
                </div>
                <div>
                  <span className="font-semibold">AIR</span>{" "}
                  <span className="text-muted-foreground">
                    Qty {summary.byMode.AIR.qty.toLocaleString()} / {money(summary.byMode.AIR.amount, currency)}
                  </span>
                </div>
                <div>
                  <span className="font-semibold">COURIER</span>{" "}
                  <span className="text-muted-foreground">
                    Qty {summary.byMode.COURIER.qty.toLocaleString()} / {money(summary.byMode.COURIER.amount, currency)}
                  </span>
                </div>
              </div>

              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[52px]">Use</TableHead>
                      <TableHead className="w-[110px]">PO No</TableHead>
                      <TableHead className="w-[60px]">Line</TableHead>
                      <TableHead className="w-[120px]">Style No</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="w-[90px]">Color</TableHead>
                      <TableHead className="w-[70px]">Size</TableHead>
                      <TableHead className="w-[90px] text-right">Order</TableHead>
                      <TableHead className="w-[90px] text-right">Prev Shipped</TableHead>
                      <TableHead className="w-[90px] text-right">Remain</TableHead>
                      <TableHead className="w-[120px]">Shipped</TableHead>
                      <TableHead className="w-[120px] text-right">Unit Price</TableHead>
                      <TableHead className="w-[120px] text-right">Amount</TableHead>
                      <TableHead className="w-[90px]">Cartons</TableHead>
                      <TableHead className="w-[90px]">GW/CTN</TableHead>
                      <TableHead className="w-[90px]">NW/CTN</TableHead>
                      <TableHead className="w-[120px]">Mode</TableHead>
                      <TableHead className="w-[140px]">Carrier</TableHead>
                      <TableHead className="w-[160px]">Tracking</TableHead>
                      <TableHead className="w-[80px]">Split</TableHead>
                      <TableHead className="w-[70px]">Del</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allocs.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <Checkbox
                            checked={r.include}
                            onCheckedChange={(v) => updateAlloc(r.id, { include: Boolean(v) })}
                          />
                        </TableCell>

                        <TableCell>{r.po_no}</TableCell>
                        <TableCell>{r.line_no ?? "-"}</TableCell>
                        <TableCell className="font-medium">{r.style_no}</TableCell>
                        <TableCell className="whitespace-pre-wrap">{r.description}</TableCell>
                        <TableCell>{r.color || "-"}</TableCell>
                        <TableCell>{r.size || "-"}</TableCell>
                        <TableCell className="text-right">{r.order_qty.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{r.prev_shipped_qty.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-semibold">{r.remaining_qty.toLocaleString()}</TableCell>

                        <TableCell>
                          <Input
                            value={String(r.shipped_qty)}
                            onChange={(e) =>
                              updateAlloc(r.id, {
                                shipped_qty: clamp(num(e.target.value, 0), 0, num(r.remaining_qty, 0)),
                              })
                            }
                            disabled={!r.include}
                          />
                        </TableCell>

                        <TableCell className="text-right">{money(r.unit_price, currency)}</TableCell>
                        <TableCell className="text-right">
                          {money(num(r.shipped_qty, 0) * num(r.unit_price, 0), currency)}
                        </TableCell>

                        <TableCell>
                          <Input
                            value={String(r.cartons)}
                            onChange={(e) => updateAlloc(r.id, { cartons: num(e.target.value, 0) })}
                            disabled={!r.include}
                          />
                        </TableCell>

                        <TableCell>
                          <Input
                            type="text"
                            inputMode="decimal"
                            step="0.1"
                            pattern="[0-9]*[.,]?[0-9]?"
                            value={r.gw_per_ctn_raw ?? String(r.gw_per_ctn)}
                            onChange={(e) => updateAlloc(r.id, { gw_per_ctn_raw: e.target.value })}
                            onBlur={() => {
                              const v = num1(r.gw_per_ctn_raw ?? r.gw_per_ctn, 0);
                              updateAlloc(r.id, { gw_per_ctn: v, gw_per_ctn_raw: String(v) });
                            }}
                            disabled={!r.include}
                          />
                        </TableCell>

                        <TableCell>
                          <Input
                            type="text"
                            inputMode="decimal"
                            step="0.1"
                            pattern="[0-9]*[.,]?[0-9]?"
                            value={r.nw_per_ctn_raw ?? String(r.nw_per_ctn)}
                            onChange={(e) => updateAlloc(r.id, { nw_per_ctn_raw: e.target.value })}
                            onBlur={() => {
                              const v = num1(r.nw_per_ctn_raw ?? r.nw_per_ctn, 0);
                              updateAlloc(r.id, { nw_per_ctn: v, nw_per_ctn_raw: String(v) });
                            }}
                            disabled={!r.include}
                          />
                        </TableCell>

                        <TableCell>
                          <Select
                            value={r.ship_mode}
                            onValueChange={(v) => updateAlloc(r.id, { ship_mode: v as ShipMode })}
                            disabled={!r.include}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Mode" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="SEA">SEA</SelectItem>
                              <SelectItem value="AIR">AIR</SelectItem>
                              <SelectItem value="COURIER">COURIER</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>

                        <TableCell>
                          <Input
                            value={r.carrier}
                            onChange={(e) => updateAlloc(r.id, { carrier: e.target.value })}
                            placeholder={r.ship_mode === "COURIER" ? "DHL/UPS/..." : ""}
                            disabled={!r.include}
                          />
                        </TableCell>

                        <TableCell>
                          <Input
                            value={r.tracking_no}
                            onChange={(e) => updateAlloc(r.id, { tracking_no: e.target.value })}
                            disabled={!r.include}
                          />
                        </TableCell>

                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => splitRow(r.id)}
                            disabled={!r.include || num(r.shipped_qty, 0) <= 1}
                          >
                            Split
                          </Button>
                        </TableCell>

                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => removeRow(r.id)}
                          >
                            Del
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-end">
                <Button size="lg" onClick={save} disabled={saving || loading}>
                  {saving ? "Saving..." : "Create Shipment"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
