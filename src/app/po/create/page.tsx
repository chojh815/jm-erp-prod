"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectValue,
  SelectItem,
} from "@/components/ui/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";

type ShippingOriginCode =
  | "KR_SEOUL"
  | "CN_QINGDAO"
  | "CN_JIAOZHOU"
  | "VN_BACNINH";

type OrderType = "NEW" | "REORDER";
type POStatus = "DRAFT" | "CONFIRMED" | "CANCELLED" | "PARTIALLY_SHIPPED" | "SHIPPED";
type DevRole = AppRole;

const ORIGIN_LABEL: Record<ShippingOriginCode, string> = {
  KR_SEOUL: "Korea – Seoul (HQ)",
  CN_QINGDAO: "China – Qingdao",
  CN_JIAOZHOU: "China – Jiaozhou",
  VN_BACNINH: "Vietnam – Bac Ninh",
};

// 🔑 Create PO 자동 임시저장 localStorage 키
const DRAFT_KEY = "jm-erp-po-create-draft-v1";

interface POLine {
  id: string;
  buyerStyleNo: string;
  jmStyleNo: string;
  description?: string;
  color?: string;
  size?: string;
  plating_color?: string;
  hsCode?: string;
  imageUrl?: string;
  images?: string[];
  qty: number;
  qty_cancelled?: number;
  shipped_qty?: number;
  remaining_qty?: number;
  uom: string;
  unitPrice: number;
  unitPriceInput?: string; // 입력 중인 문자열 (소수점 포함)
  currency: string;
  upc?: string;
  amount: number;
  remark?: string;
  buyerStyleMapId?: string;
}

type DbStyle = {
  id: string;
  style_no: string;
  description?: string;
  color?: string;
  size?: string;
  plating_color?: string;
  hs_code?: string;
  default_uom?: string;
  default_unit_price?: number;
  image_url?: string;
  image_urls?: string[] | null;
};

// companies에서 buyer 타입만 사용
type DbBuyer = { id: string; name: string; code?: string | null };
type DbDept = { id: string; buyer_id: string; name: string };
type DbBrand = { id: string; buyer_id: string; name: string };

// 🔐 payment_terms → Select 에 쓰는 옵션 구조
type PaymentTermOption = {
  id: string; // payment_terms.id (uuid)
  code: string | null; // 예: "B030"
  name: string | null; // 예: "B/L 30 Days"
  label: string; // 화면 표시용: "B030 B/L 30 Days"
};

type DbBuyerStyleMap = {
  id: string;
  buyer_style_no: string;
  styles?: DbStyle | null;
};

type PoSummary = {
  id: string;
  po_no: string;
  buyer_name: string | null;
  order_date: string | null;
  requested_ship_date: string | null;
  currency: string | null;
  subtotal: number | null;
  status: POStatus;
  destination?: string | null;
};

const supabaseBrowser = createSupabaseBrowserClient();

export default function POCreatePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialPoNo = searchParams.get("poNo");
  const supabase = React.useMemo(
    () => createSupabaseBrowserClient(),
    []
  );

  const [loading, setLoading] = React.useState(true);
  const [role, setRole] = React.useState<DevRole | null>(null);
  const [currentUserId, setCurrentUserId] = React.useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] =
    React.useState<string | null>(null);


// ----------------------
// Minimal permissions fetch (no provider / no hook)
// - Does NOT block page rendering
// - Used only to enable/disable data-changing actions
// ----------------------
const [permissions, setPermissions] = React.useState<string[]>([]);
const [permLoaded, setPermLoaded] = React.useState(false);


  // URL ?poNo= 로부터 자동 로딩이 한 번이라도 실행됐는지 여부
  const [initializedFromQuery, setInitializedFromQuery] =
    React.useState(false);

  // ----------------------
  // 초기 로그인 / 권한 체크
  // ----------------------
  React.useEffect(() => {
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/login?redirectTo=/po/create");
        return;
      }

      const meta = (session.user.user_metadata || {}) as any;
      const r: AppRole = meta.role || "viewer";

      setRole(r as DevRole);
      setCurrentUserId(session.user.id);
      setCurrentUserEmail(session.user.email ?? null);
      setLoading(false);
    };

    init();
  }, [router, supabase]);


// ----------------------
// Permissions: fetch once (fast) for manage gating
// ----------------------
React.useEffect(() => {
  if (!currentUserId) return;

  let cancelled = false;

  const run = async () => {
    try {
      const res = await fetch("/api/me/permissions", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      });

      const json = await res.json().catch(() => null);

      const permsRaw =
        (json && (json.permissions || json.data?.permissions || json.perms)) ?? [];

      const perms = Array.isArray(permsRaw)
        ? permsRaw.map((p) => String(p))
        : [];

      if (!cancelled) setPermissions(perms);
    } catch (e) {
      // ignore (manage actions will stay disabled)
    } finally {
      if (!cancelled) setPermLoaded(true);
    }
  };

  run();

  return () => {
    cancelled = true;
  };
}, [currentUserId]);

  // ----------------------
  // Header state
  // ----------------------
  const [poNo, setPoNo] = React.useState("");
  const [poHeaderId, setPoHeaderId] = React.useState<string | null>(null);

  // ✅ Track the loaded PO identity to prevent accidental overwrite when PO No changes
  const loadedPoNoRef = React.useRef<string | null>(null);
  const loadedHeaderIdRef = React.useRef<string | null>(null);

  const [orderType, setOrderType] = React.useState<OrderType>("NEW");
  const [status, setStatus] = React.useState<POStatus>("DRAFT");

  const [buyerId, setBuyerId] = React.useState<string>("");
  const [dept, setDept] = React.useState("");
  const [brand, setBrand] = React.useState("");
  const [currency, setCurrency] = React.useState("USD");

  // 🔐 Payment Term: 화면은 라벨, DB에는 id + name 둘 다 저장
  const [paymentTerms, setPaymentTerms] = React.useState<PaymentTermOption[]>(
    []
  );
  const [paymentTermId, setPaymentTermId] = React.useState<string | null>(null);
  const [paymentTermName, setPaymentTermName] =
    React.useState<string>("");

  // ✅ Load PO 시 payment_term(text)만 있고 payment_term_id가 없는 경우가 있어서,
  //    payment_terms 옵션을 기준으로 id를 자동 매칭해 Select에 표시되게 합니다.
  const normalizePT = (v: any) =>
    String(v ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

  const findPaymentTermByText = React.useCallback(
    (textValue: string) => {
      const t = normalizePT(textValue);
      if (!t) return null;
      const hit = paymentTerms.find((opt) => {
        const a = normalizePT(opt.label);
        const b = normalizePT(opt.name);
        const c = normalizePT(opt.code);
        // exact match 우선, 그 다음 포함(DA 45DAYS 같은 케이스 대응)
        return a === t || b === t || c === t || a.includes(t) || b.includes(t);
      });
      return hit || null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paymentTerms]
  );


  // ✅ Payment Term 보정:
  // - 과거 데이터는 po_headers.payment_term(text)만 있고 payment_term_id가 없을 수 있음
  // - payment_terms 옵션이 "나중에" 로딩되는 경우가 있어, 옵션 로딩 후 한 번 더 매핑해준다
  React.useEffect(() => {
    if (paymentTermId) return;
    const txt = (paymentTermName ?? "").trim();
    if (!txt) return;
    if (!paymentTerms || paymentTerms.length === 0) return;

    const found = findPaymentTermByText(txt);
    if (found) {
      setPaymentTermId(found.id);
      setPaymentTermName(found.label || found.name || txt);
      return;
    }

    // 옵션에 없으면 임시 옵션을 추가해 화면에서라도 표시되게 함
    setPaymentTerms((prev) => {
      const existing = prev.find((t) => t.name === txt || t.label === txt);
      if (existing) {
        setPaymentTermId(existing.id);
        setPaymentTermName(existing.label || existing.name || txt);
        return prev;
      }
      const opt: PaymentTermOption = {
        id: `TEMP-${txt}`,
        code: null,
        name: txt,
        label: txt,
      };
      setPaymentTermId(opt.id);
      setPaymentTermName(opt.label);
      return [opt, ...prev];
    });
  }, [paymentTerms, paymentTermId, paymentTermName, findPaymentTermByText]);


  React.useEffect(() => {
    // id가 이미 있으면 그대로
    if (paymentTermId) return;
    if (!paymentTermName) return;
    if (!paymentTerms || paymentTerms.length === 0) return;

    const found = findPaymentTermByText(paymentTermName);
    if (!found) return;

    // id/라벨 모두 맞춰주면 Select가 정상 표시됨
    setPaymentTermId(found.id);
    setPaymentTermName(found.label);
  }, [paymentTermId, paymentTermName, paymentTerms, findPaymentTermByText]);

  const [shipMode, setShipMode] = React.useState("SEA");
  // COURIER일 때만 사용 (DHL/FEDEX/UPS)
  const [courierCarrier, setCourierCarrier] = React.useState("FEDEX");
  const [destination, setDestination] = React.useState("");
  const [orderDate, setOrderDate] = React.useState("");
  const [reqShipDate, setReqShipDate] = React.useState("");
  const [cancelDate, setCancelDate] = React.useState("");
  const [cancelReason, setCancelReason] = React.useState("");

  const [lines, setLines] = React.useState<POLine[]>([
    {
      id:
        typeof crypto !== "undefined"
          ? crypto.randomUUID()
          : String(Date.now()),
      buyerStyleNo: "",
      jmStyleNo: "",
      qty: 0,
      shipped_qty: 0,
      qty_cancelled: 0,
      uom: "PCS",
      unitPrice: 0,
      currency: "USD",
      upc: "",
      amount: 0,
    },
  ]);
  
const hasAnyShipped = React.useMemo(() => {
  try {
    return (lines || []).some(
      (l) => (Number((l as any).shipped_qty ?? 0) || 0) > 0
    );
  } catch {
    return false;
  }
}, [lines]);
  const [selectedOrigin, setSelectedOrigin] =
    React.useState<ShippingOriginCode | undefined>(undefined);

  const [approvalTarget, setApprovalTarget] = React.useState("");
  const [ppTarget, setPPTarget] = React.useState("");
  const [topTarget, setTOPTarget] = React.useState("");
  const [finalTarget, setFinalTarget] = React.useState("");

  const makeEmptyLine = React.useCallback(
    (): POLine => ({
      id:
        typeof crypto !== "undefined"
          ? crypto.randomUUID()
          : String(Date.now()),
      buyerStyleNo: "",
      jmStyleNo: "",
      qty: 0,
      shipped_qty: 0,
      qty_cancelled: 0,
      uom: "PCS",
      unitPrice: 0,
      currency: "USD",
      upc: "",
      amount: 0,
    }),
    []
  );

  
  const [saving, setSaving] = React.useState(false);

  // ----------------------
  // 수량 / 금액 계산 헬퍼
  // ----------------------
  const clampQty = (v: number) => {
    if (!Number.isFinite(v)) return 0;
    // qty/cancel qty는 반드시 0 이상의 정수
    return Math.max(0, Math.trunc(v));
  };

  const computeAmount = (l: POLine): POLine => {
    const qtyNum =
      typeof l.qty === "number"
        ? l.qty
        : Number((l as any).qty ?? 0) || 0;
    const priceNum =
      typeof l.unitPrice === "number"
        ? l.unitPrice
        : Number((l as any).unitPrice ?? 0) || 0;

    return {
      ...l,
      amount: Math.round(qtyNum * priceNum * 100) / 100,
    };
  };

  // 천단위 콤마 정수
  const formatIntWithComma = (v: number | null | undefined) => {
    if (v === null || v === undefined || Number.isNaN(v)) return "";
    return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  };

  // 금액(소수 2자리, 천단위 콤마)
  const formatAmountWithComma = (
    v: number | null | undefined
  ): string => {
    if (v === null || v === undefined || Number.isNaN(v)) return "";
    return v.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const updateLine = (id: string, patch: Partial<POLine>) =>
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const merged = { ...l, ...patch } as POLine;

        // shipped_qty / qty / qty_cancelled 모두 정수(>=0)로 강제
        merged.shipped_qty = clampQty(Number(merged.shipped_qty ?? 0));

        if (patch.qty !== undefined) {
          merged.qty = clampQty(
            typeof patch.qty === "number"
              ? patch.qty
              : Number((patch as any).qty ?? 0) || 0
          );
        }

        if ((patch as any).qty_cancelled !== undefined) {
          merged.qty_cancelled = clampQty(
            typeof (patch as any).qty_cancelled === "number"
              ? (patch as any).qty_cancelled
              : Number((patch as any).qty_cancelled ?? 0) || 0
          );
        }

        const ordered = clampQty(Number(merged.qty ?? 0));
        const shipped = clampQty(Number(merged.shipped_qty ?? 0));
        const maxCancel = Math.max(0, ordered - shipped);

        const cancelled = clampQty(Number(merged.qty_cancelled ?? 0));
        if (cancelled > maxCancel) merged.qty_cancelled = maxCancel;

        merged.remaining_qty = Math.max(
          0,
          ordered - shipped - clampQty(Number(merged.qty_cancelled ?? 0))
        );

        return computeAmount(merged);
      })
    );

  const addLine = () =>
    setLines((prev) => [
      ...prev,
      {
        id:
          typeof crypto !== "undefined"
            ? crypto.randomUUID()
            : String(Date.now()),
        buyerStyleNo: "",
        jmStyleNo: "",
        qty: 0,
        uom: "PCS",
        unitPrice: 0,
        currency,
        upc: "",
        amount: 0,
      },
    ]);

  const removeLine = (id: string) => {
    if (!window.confirm("Are you sure you want to delete this line?"))
      return;
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const subtotal = React.useMemo(
    () => lines.reduce((s, l) => s + (l.amount || 0), 0),
    [lines]
  );

  // ----------------------
  // 마스터 데이터
  // ----------------------
  const [buyers, setBuyers] = React.useState<DbBuyer[]>([]);
  const [buyerDepts, setBuyerDepts] = React.useState<DbDept[]>([]);
  const [buyerBrands, setBuyerBrands] = React.useState<DbBrand[]>([]);

  const currentBuyer = React.useMemo(
    () => buyers.find((b) => b.id === buyerId) || null,
    [buyers, buyerId]
  );

  // 바이어 / 결제조건 로딩 (companies에서 buyer 타입만)
  React.useEffect(() => {
    (async () => {
      const [
        { data: buyersData, error: buyersErr },
        { data: ptData, error: ptErr },
      ] = await Promise.all([
        supabase
          .from("companies")
          .select("id, company_name, code, company_type")
          .eq("company_type", "buyer")
          .order("company_name"),
        supabase
          .from("payment_terms")
          .select("id, code, name, is_active")
          .order("name"),
      ]);

      if (buyersErr) console.error("Failed to load buyers:", buyersErr);
      if (ptErr)
        console.error("Failed to load payment_terms:", ptErr);

      const mappedBuyers: DbBuyer[] =
        ((buyersData as any[]) || []).map((row) => ({
          id: row.id as string,
          name: row.company_name as string,
          code: row.code ?? null,
        }));

      setBuyers(mappedBuyers);

      // payment_terms → PaymentTermOption 으로 변환
      const mappedPT: PaymentTermOption[] =
        ((ptData as any[]) || [])
          .filter((row: any) => row?.is_active !== false)
          .map((row: any) => {
            const code = (row.code as string | null) ?? null;
            const name = (row.name as string | null) ?? null;
            const label =
              code && name ? `${code} ${name}` : name ?? code ?? "";
            return {
              id: row.id as string,
              code,
              name,
              label,
            };
          });

      setPaymentTerms(mappedPT);
    })();
  }, [supabase]);

  // ✅ 바이어 선택 시 companies 테이블에서 Payment Term / Ship Mode / Origin 기본값 가져오기
  React.useEffect(() => {
    if (!buyerId) return;

    (async () => {
      try {
        const { data, error } = await supabase
          .from("companies")
          .select("*")
          .eq("id", buyerId)
          .maybeSingle();

        if (error) {
          console.error("Failed to load buyer defaults:", error);
          return;
        }

        if (!data) return;

        const row = data as any;

        // Payment Term: id 우선, 없으면 텍스트 기준으로 생성
        if (row.buyer_payment_term_id) {
          const id = row.buyer_payment_term_id as string;
          setPaymentTermId(id);

          setPaymentTerms((prev) => {
            const found = prev.find((t) => t.id === id);
            if (found) {
              setPaymentTermName(found.label);
              return prev;
            }
            const txt = (row.buyer_payment_term as string | null) ?? null;
            const opt: PaymentTermOption = {
              id,
              code: null,
              name: txt,
              label: txt || "(Unknown Payment Term)",
            };
            setPaymentTermName(opt.label);
            return [opt, ...prev];
          });
        } else if (row.buyer_payment_term) {
          const term = row.buyer_payment_term as string;
          setPaymentTerms((prev) => {
            const existing = prev.find(
              (t) => t.name === term || t.label === term
            );
            if (existing) {
              setPaymentTermId(existing.id);
              setPaymentTermName(existing.label);
              return prev;
            }
            const opt: PaymentTermOption = {
              id: `TEMP-${term}`,
              code: null,
              name: term,
              label: term,
            };
            setPaymentTermId(opt.id);
            setPaymentTermName(opt.label);
            return [opt, ...prev];
          });
        } else {
          setPaymentTermId(null);
          setPaymentTermName("");
        }

        // Ship Mode 자동 세팅 (SEA / AIR / COURIER 등)
        if (row.buyer_default_ship_mode) {
          setShipMode(row.buyer_default_ship_mode as string);
        }

        // Preferred Origins 가 있으면 첫 번째를 기본 Shipping Origin 으로 사용
        if (
          row.preferred_origins &&
          Array.isArray(row.preferred_origins) &&
          row.preferred_origins.length > 0
        ) {
          setSelectedOrigin(
            row.preferred_origins[0] as ShippingOriginCode
          );
        }
        // ================================
// Buyer Final Destination
// ================================
if (row.buyer_final_destination) {
  setDestination(row.buyer_final_destination);
}
      } catch (err) {
        console.error(
          "Unexpected error loading buyer defaults:",
          err
        );
      }
    })();
  }, [buyerId, supabase]);

  // 바이어별 Dept/Brand 로딩 (companies.buyer_brand / buyer_dept 에서)
  React.useEffect(() => {
    (async () => {
      if (!buyerId) {
        setBuyerDepts([]);
        setBuyerBrands([]);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("companies")
          .select("buyer_brand, buyer_dept")
          .eq("id", buyerId)
          .maybeSingle();

        if (error) {
          console.error("Failed to load buyer brand/dept:", error);
          setBuyerDepts([]);
          setBuyerBrands([]);
          return;
        }

        if (!data) {
          setBuyerDepts([]);
          setBuyerBrands([]);
          return;
        }

        const row = data as any;
        const brandStr: string = row.buyer_brand || "";
        const deptStr: string = row.buyer_dept || "";

        const brands: DbBrand[] = (brandStr
          ? brandStr
              .split(",")
              .map((s: string) => s.trim())
              .filter(Boolean)
          : []
        ).map((name: string, idx: number) => ({
          id: `${buyerId}-brand-${idx}`,
          buyer_id: buyerId,
          name,
        }));

        const depts: DbDept[] = (deptStr
          ? deptStr
              .split(",")
              .map((s: string) => s.trim())
              .filter(Boolean)
          : []
        ).map((name: string, idx: number) => ({
          id: `${buyerId}-dept-${idx}`,
          buyer_id: buyerId,
          name,
        }));

        setBuyerBrands(brands);
        setBuyerDepts(depts);
      } catch (err) {
        console.error(
          "Unexpected error loading buyer brand/dept:",
          err
        );
        setBuyerDepts([]);
        setBuyerBrands([]);
      }
    })();
  }, [buyerId, supabase]);

  // ----------------------
  // Style 검색 (JM)
  // ----------------------
  const [styleFocusId, setStyleFocusId] =
    React.useState<string | null>(null);
  const [styleResults, setStyleResults] = React.useState<DbStyle[]>([]);
  const [styleLoading, setStyleLoading] = React.useState(false);

  const searchStyles = React.useCallback(
    async (q: string) => {
const query = (q || "").trim();
if (!query || query.length < 2) {
  setStyleResults([]);
  return;
}

try {
  setStyleLoading(true);

  // ✅ JM Style 검색은 dev master 테이블(product_development_headers)에서 조회
  // (기존 코드가 styles 테이블을 찾다가 404 나는 문제 해결)
  const { data, error } = await supabase
    .from("product_development_headers")
    .select(
      "id,style_no,remarks,size_text,hs_code,material_content,image_urls,is_deleted"
    )
    .eq("is_deleted", false)
    .ilike("style_no", `%${query}%`)
    .order("style_no", { ascending: true })
    .limit(20);

  if (error) throw error;

  const rows = (data ?? []).map((r: any) => {
    const image_urls = Array.isArray(r.image_urls) ? r.image_urls : null;
    return {
      id: String(r.id),
      style_no: String(r.style_no ?? ""),
      description: String(r.remarks ?? ""),
      color: "",
      size: String(r.size_text ?? ""),
      plating_color: "",
      hs_code: r.hs_code ?? null,
      default_uom: "PCS",
      default_unit_price: 0,
      image_url: image_urls && image_urls.length ? image_urls[0] : null,
      image_urls,
      material_content: r.material_content ?? null,
    } as DbStyle;
  });

  setStyleResults(rows);
} catch (e: any) {
  console.error("Failed to search styles:", e);
  alert(`Failed to search styles: ${e?.message || e}`);
} finally {
  setStyleLoading(false);
}
},
    [supabase]
  );

  const applyStyleToLine = (id: string, s: DbStyle) => {
    const imagesArray =
      s.image_urls && Array.isArray(s.image_urls)
        ? s.image_urls
        : s.image_url
        ? [s.image_url]
        : [];

    updateLine(id, {
      jmStyleNo: s.style_no,
      description: s.description || "",
      color: s.color || "",
      size: s.size || "",
      plating_color: s.plating_color || "",
      hsCode: s.hs_code || "",
      uom: s.default_uom || "PCS",
      unitPrice:
        typeof s.default_unit_price === "number"
          ? s.default_unit_price
          : 0,
      imageUrl: imagesArray[0],
      images: imagesArray,
    });
  };

  // ----------------------
  // Buyer Style 검색
  // ----------------------
  const [buyerStyleFocusId, setBuyerStyleFocusId] =
    React.useState<string | null>(null);
  const [buyerStyleResults, setBuyerStyleResults] =
    React.useState<DbBuyerStyleMap[]>([]);
  const [buyerStyleLoading, setBuyerStyleLoading] =
    React.useState(false);

  const searchBuyerStyles = React.useCallback(
    async (q: string) => {
      if (!q || q.trim().length < 2 || !buyerId) {
        setBuyerStyleResults([]);
        return;
      }

      setBuyerStyleLoading(true);
      const like = `%${q.trim()}%`;

      const { data, error } = await supabase
        .from("style_mappings")
        .select(
          `
          id,
          buyer_style_no,
          styles (
            id,
            style_no,
            description,
            color,
            size,
            plating_color,
            hs_code,
            default_uom,
            default_unit_price,
            image_url,
            image_urls
          )
        `
        )
        .eq("buyer_id", buyerId)
        .ilike("buyer_style_no", like)
        .limit(20);

      if (error) {
        console.error("Failed to search buyer styles:", error);
        setBuyerStyleResults([]);
      } else {
        setBuyerStyleResults((data as any[]) || []);
      }
      setBuyerStyleLoading(false);
    },
    [supabase, buyerId]
  );

  const applyBuyerStyleToLine = (
    lineId: string,
    map: DbBuyerStyleMap
  ) => {
    const style = map.styles;
    if (!style) {
      updateLine(lineId, {
        buyerStyleNo: map.buyer_style_no,
        buyerStyleMapId: map.id,
      });
      return;
    }

    const imagesArray =
      style.image_urls && Array.isArray(style.image_urls)
        ? style.image_urls
        : style.image_url
        ? [style.image_url]
        : [];

    updateLine(lineId, {
      buyerStyleNo: map.buyer_style_no,
      buyerStyleMapId: map.id,
      jmStyleNo: style.style_no,
      description: style.description || "",
      color: style.color || "",
      size: style.size || "",
      plating_color: style.plating_color || "",
      hsCode: style.hs_code || "",
      uom: style.default_uom || "PCS",
      unitPrice:
        typeof style.default_unit_price === "number"
          ? style.default_unit_price
          : 0,
      imageUrl: imagesArray[0],
      images: imagesArray,
    });
  };

  // ----------------------
  // 이미지 업로드 / 삭제 / 프리뷰
  // ----------------------
  const handleImageFileChange = async (
    lineId: string,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const line = lines.find((l) => l.id === lineId);
    const jmStyleNo = (line?.jmStyleNo || "").trim();

    if (!jmStyleNo) {
      alert(
        "먼저 JM Style No를 입력/선택한 후 이미지를 업로드해 주세요."
      );
      e.target.value = "";
      return;
    }

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("jmStyleNo", jmStyleNo);

      const res = await fetch("/api/orders/poline/upload-image", {
        method: "POST",
        body: formData,
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const msg =
          (data && (data.error || data.message)) ||
          `Upload failed (status ${res.status})`;
        alert(msg);
        e.target.value = "";
        return;
      }

      const url: string = data?.imageUrl || data?.url;
      if (!url) {
        alert("Upload succeeded but no image URL was returned.");
        e.target.value = "";
        return;
      }

      setLines((prev) =>
        prev.map((l) => {
          if (l.id !== lineId) return l;
          const nextImages = Array.from(
            new Set([...(l.images || []), url])
          );
          return {
            ...l,
            imageUrl: l.imageUrl || url,
            images: nextImages.slice(0, 3),
          };
        })
      );
    } catch (err) {
      console.error("Image upload error:", err);
      alert("Unexpected error while uploading image.");
    } finally {
      e.target.value = "";
    }
  };

  const handleDeleteImage = async (lineId: string, url: string) => {
    
    if (!canManage) {
      alert("You do not have permission to delete images.");
      return;
    }
const line = lines.find((l) => l.id === lineId);
    const jmStyleNo = line?.jmStyleNo || "";

    if (
      !window.confirm(
        "Delete this image from storage? This may affect other POs using the same style."
      )
    ) {
      return;
    }

    try {
      const res = await fetch("/api/orders/poline/delete-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: url, jmStyleNo }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        alert(
          (data && (data.error || data.message)) ||
            `Failed to delete image (status ${res.status})`
        );
        return;
      }

      setLines((prev) =>
        prev.map((l) => {
          if (l.id !== lineId) return l;
          const remaining = (l.images || []).filter(
            (img) => img !== url
          );
          let nextMain = l.imageUrl;
          if (l.imageUrl === url) {
            nextMain =
              remaining.length > 0 ? remaining[0] : undefined;
          }
          return {
            ...l,
            imageUrl: nextMain,
            images: remaining.length > 0 ? remaining : undefined,
          };
        })
      );
    } catch (err) {
      console.error("Delete image error:", err);
      alert(
        "Unexpected error while deleting image. See console for details."
      );
    }
  };

  const [previewImage, setPreviewImage] = React.useState<{
    url: string;
    title?: string;
  } | null>(null);

  const openPreview = (url: string, title?: string) => {
    setPreviewImage({ url, title });
  };

  // ----------------------
  // 🔍 PO 검색 팝업 상태
  // ----------------------
  const [poSearchOpen, setPoSearchOpen] = React.useState(false);
  const [poSearchKeyword, setPoSearchKeyword] =
    React.useState("");
  const [poSearchResults, setPoSearchResults] =
    React.useState<PoSummary[]>([]);
  const [poSearchLoading, setPoSearchLoading] =
    React.useState(false);

const fetchPoList = React.useCallback(
  async (keyword: string) => {
    try {
      setPoSearchLoading(true);

      // ✅ /api/orders/list 는 keyword가 아니라 q 파라미터를 사용합니다.
      // (PO List 화면과 동일한 검색 키를 써야 Create PO Search에서도 같은 결과가 나옵니다.)
      const kw = String(keyword || "").trim();

      const params = new URLSearchParams();
      if (kw) params.set("q", kw);

      // 검색 팝업은 보통 최근/상단 몇십개면 충분 → 넉넉히 50개
      params.set("page", "1");
      params.set("pageSize", "50");

      const url = `/api/orders/list?${params.toString()}`;

      const res = await fetch(url);
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        console.error("Search PO error:", data);
        alert(
          (data && (data.error || data.message)) ||
            `Failed to search POs (status ${res.status}).`
        );
        return;
      }

      // 1) API에서 넘어온 원본 리스트
      const rawItems = (data?.items ?? data?.results ?? []) as any[];

      console.log("rawItems from API ===>", rawItems);

      // 2) 여기서 한 번 더 삭제된 PO 제거 (status=DELETED, is_deleted=true 둘 다)
      const filtered = rawItems.filter((row: any) => {
        const isDeletedFlag =
          row.is_deleted === true || row.is_deleted === "true";
        const isDeletedStatus = row.status === "DELETED";
        return !isDeletedFlag && !isDeletedStatus;
      });

      // 3) 화면에서 쓰는 형태로 매핑
      const mapped: PoSummary[] = filtered.map((row: any) => ({
        id:
          row.id ??
          row.header_id ??
          row.po_header_id ??
          row.po_no ??
          String(Math.random()),
        po_no: row.po_no ?? row.poNo ?? "",
        buyer_name:
          row.buyer_name ?? row.buyer ?? row.buyerName ?? null,
        order_date: row.order_date ?? row.orderDate ?? null,
        requested_ship_date:
          row.requested_ship_date ??
          row.requestedShipDate ??
          row.reqShipDate ??
          row.req_ship_date ??
          row.req_ship_date ??
          row.delivery_date ?? // 일부 데이터는 delivery_date로 저장됨
          row.deliveryDate ??
          null,
        currency: row.currency ?? null,
        subtotal:
          row.subtotal ??
          row.amount ??
          row.total_amount ??
          row.total ??
          row.grand_total ??
          row.grandTotal ??
          null,
        status: (row.status ?? "DRAFT") as POStatus,
        destination: row.destination ?? null,
      }));

      setPoSearchResults(mapped);
    } catch (err) {
      console.error("Search PO unexpected error:", err);
      alert("Unexpected error while searching POs. See console for details.");
    } finally {
      setPoSearchLoading(false);
    }
  },
  []
);
;

  React.useEffect(() => {
  // 모달이 열릴 때 한 번만 실행
  if (!poSearchOpen) return;

  // 🔹 모달 열릴 때는 항상 최신 전체 리스트를 다시 불러오고
  //    (이때 API에서 is_deleted=false 조건 때문에 삭제된 건 안 나옴)
  setPoSearchKeyword(""); // 검색어 초기화
  fetchPoList("");        // 키워드 없이 전체 조회
}, [poSearchOpen, fetchPoList]);

  // ----------------------
  // Reset Form
  // ----------------------
  const resetForm = React.useCallback(() => {
    setPoNo("");
    setPoHeaderId(null);
    loadedPoNoRef.current = null;
    loadedHeaderIdRef.current = null;
    setOrderType("NEW");
    setStatus("DRAFT");
    setBuyerId("");
    setDept("");
    setBrand("");
    setCurrency("USD");
    setPaymentTermId(null);
    setPaymentTermName("");
    setShipMode("SEA");
    setCourierCarrier("FEDEX");
    setDestination("");
    setOrderDate("");
    setReqShipDate("");
    setCancelDate("");
    setCancelReason("");
    setSelectedOrigin(undefined);
    setApprovalTarget("");
    setPPTarget("");
    setTOPTarget("");
    setFinalTarget("");
    setLines([makeEmptyLine()]);

    // 🔥 Clear 버튼 누르면 Draft 삭제
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(DRAFT_KEY);
    }
  }, [makeEmptyLine]);

  // ----------------------
  // 📥 기존 PO 불러오기
  // ----------------------
  const loadPO = React.useCallback(
    async (targetPoNo: string) => {
      try {
        const res = await fetch(
          `/api/orders?poNo=${encodeURIComponent(targetPoNo)}`
        );
        const data = await res.json().catch(() => null);

        if (!res.ok) {
          console.error("Load PO error:", data);
          alert(
            (data && (data.error || data.message)) ||
              `Failed to load PO (status ${res.status}).`
          );
          return;
        }

        const header = data.header as any;

        // keep header id for UPDATE
        const _loadedHeaderId = header?.id ? String(header.id) : null;
        setPoHeaderId(_loadedHeaderId);
        loadedHeaderIdRef.current = _loadedHeaderId;
        loadedPoNoRef.current = (header.po_no || "").toString();
        const apiLines = (data.lines as any[]) || [];

        setPoNo(header.po_no || "");
        setOrderType((header.order_type as OrderType) || "NEW");
        setStatus((header.status as POStatus) || "DRAFT");
        setBuyerId(header.buyer_id || "");
        setDept(header.department || "");
        setBrand(header.brand || "");
        setBrand(header.buyer_brand_name || "");
        setDept(header.buyer_dept_name || "");

        setCurrency(header.currency || "USD");

        const headerPTText =
      header.payment_term ||
      header.payment_term_name ||
      header.payment_term_text ||
      header.paymentTerm ||
      "";
        const headerPTId =
      header.payment_term_id ||
      header.buyer_payment_term_id ||
      header.paymentTermId ||
      null;

        // 기본 세팅
        setPaymentTermId(headerPTId);
        setPaymentTermName(headerPTText);

        // ✅ 과거 데이터/입력 방식 때문에 payment_term(text)만 있고 id가 없는 경우
        //    → 옵션에서 id를 찾아 바로 매핑(없으면 effect가 나중에 한 번 더 시도)
        if (!headerPTId && headerPTText) {
          const found = findPaymentTermByText(headerPTText);
          if (found) {
            setPaymentTermId(found.id);
            setPaymentTermName(found.label);
          }
        }

        setShipMode(header.ship_mode || "SEA");
        setCourierCarrier(header.courier_carrier || "FEDEX");
        setDestination(header.destination || "");
        setOrderDate(header.order_date || "");
        setReqShipDate(header.requested_ship_date || "");
        setCancelDate(header.cancel_date || "");
        setSelectedOrigin(
          header.shipping_origin_code as ShippingOriginCode | undefined
        );
        setApprovalTarget(
          header.approval_sample_target_date || ""
        );
        setPPTarget(header.pp_sample_target_date || "");
        setTOPTarget(header.top_sample_target_date || "");
        setFinalTarget(header.final_sample_target_date || "");

        
  const normalizeImageUrls = (v: any, fallbackSingle?: any): string[] => {
    const out: string[] = [];

    const push = (s: any) => {
      if (!s) return;
      const t = String(s).trim();
      if (!t) return;
      out.push(t);
    };

    if (Array.isArray(v)) {
      v.forEach(push);
    } else if (typeof v === "string") {
      const s = v.trim();
      if (s) {
        // JSON array (preferred)
        if (s.startsWith("[") && s.endsWith("]")) {
          try {
            const parsed = JSON.parse(s);
            if (Array.isArray(parsed)) parsed.forEach(push);
            else push(s);
          } catch {
            push(s);
          }
        } else if (s.includes(",")) {
          // comma-separated
          s.split(",").forEach(push);
        } else {
          // single url/path
          push(s);
        }
      }
    } else if (v && typeof v === "object") {
      // sometimes comes as { urls: [...] }
      if (Array.isArray((v as any).urls)) (v as any).urls.forEach(push);
    }

    // fallback: if thumbnails empty but we have a main image url/path, show it as first thumb
    if (out.length === 0 && fallbackSingle) push(fallbackSingle);

    // de-dupe & keep max 3 for UI
    return Array.from(new Set(out)).slice(0, 3);
  };

const mappedLines: POLine[] = apiLines.map((row: any) =>
          computeAmount({
            id: row.id
              ? String(row.id)
              : typeof crypto !== "undefined"
              ? crypto.randomUUID()
              : String(Date.now() + Math.random()),
            buyerStyleNo: row.buyer_style_no || "",
            jmStyleNo: row.jm_style_no || "",
            description: row.description || "",
            color: row.color || "",
            size: row.size || "",
            plating_color: row.plating_color || "",
            hsCode: row.hs_code || "",
            imageUrl: row.image_url || undefined,
            images: normalizeImageUrls((row as any).image_urls ?? (row as any).images ?? (row as any).imageUrls, (row as any).image_url ?? (row as any).imageUrl),
            qty: row.qty ?? 0,
            shipped_qty:
              (row.shipped_qty ?? (row as any).shippedQty ?? 0) as any,
            qty_cancelled:
              (row.qty_cancelled ?? (row as any).cancel_qty ?? (row as any).cancelQty ?? 0) as any,
            uom: row.uom || "PCS",
            unitPrice: row.unit_price ?? 0,
            currency: row.currency || header.currency || "USD",
            upc: row.upc || "",
            amount: row.amount ?? 0,
            remark: row.remark || "",
            buyerStyleMapId: row.buyer_style_map_id || undefined,
          } as POLine)
        );

        setLines(
          mappedLines.length ? mappedLines : [makeEmptyLine()]
        );

        // 기존 PO를 열었다면 임시 Draft는 필요 없으니 삭제
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(DRAFT_KEY);
        }
      } catch (err) {
        console.error("Load PO unexpected error:", err);
        alert("Unexpected error while loading PO.");
      }
    },
    [makeEmptyLine]
  );

  // URL의 ?poNo= 값으로 자동 로드 (한 번만)
  React.useEffect(() => {
    if (!initialPoNo) return;
    if (initializedFromQuery) return;

    loadPO(initialPoNo);
    setInitializedFromQuery(true);
  }, [initialPoNo, initializedFromQuery, loadPO]);

  // ----------------------
  // Step 2 — 페이지 최초 진입 시 Draft 불러오기
  // ----------------------
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    // URL로 기존 PO를 여는 경우에는 Draft 복원하지 않음
    if (initialPoNo) return;

    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;

      const draft = JSON.parse(raw) as any;

      if (draft.poNo) setPoNo(draft.poNo);
      if (draft.orderType) setOrderType(draft.orderType as OrderType);
      if (draft.status) setStatus(draft.status as POStatus);
      if (draft.buyerId) setBuyerId(draft.buyerId);
      if (typeof draft.dept === "string") setDept(draft.dept);
      if (typeof draft.brand === "string") setBrand(draft.brand);
      if (typeof draft.currency === "string")
        setCurrency(draft.currency);
      if (typeof draft.paymentTermId === "string")
        setPaymentTermId(draft.paymentTermId);
      if (typeof draft.paymentTermName === "string")
        setPaymentTermName(draft.paymentTermName);
      if (typeof draft.shipMode === "string")
        setShipMode(draft.shipMode);
      if (typeof draft.destination === "string")
        setDestination(draft.destination);
      if (typeof draft.orderDate === "string")
        setOrderDate(draft.orderDate);
      if (typeof draft.reqShipDate === "string")
        setReqShipDate(draft.reqShipDate);
      if (typeof draft.cancelDate === "string")
        setCancelDate(draft.cancelDate);
      if (typeof (draft as any).cancelReason === "string")
        setCancelReason((draft as any).cancelReason);
      if (draft.selectedOrigin)
        setSelectedOrigin(draft.selectedOrigin);
      if (typeof draft.approvalTarget === "string")
        setApprovalTarget(draft.approvalTarget);
      if (typeof draft.ppTarget === "string")
        setPPTarget(draft.ppTarget);
      if (typeof draft.topTarget === "string")
        setTOPTarget(draft.topTarget);
      if (typeof draft.finalTarget === "string")
        setFinalTarget(draft.finalTarget);

      if (Array.isArray(draft.lines) && draft.lines.length > 0) {
        const restored = draft.lines.map((l: any) =>
          computeAmount({
            ...makeEmptyLine(),
            ...l,
            id:
              l.id ||
              (typeof crypto !== "undefined"
                ? crypto.randomUUID()
                : String(Date.now() + Math.random())),
          } as POLine)
        );
        setLines(restored);
      }
    } catch (err) {
      console.error(
        "Failed to restore PO draft from localStorage:",
        err
      );
    }
  }, [initialPoNo, makeEmptyLine]);

  // ----------------------
  // Step 3 — 값이 바뀔 때마다 자동 저장
  // ----------------------
  React.useEffect(() => {
    if (typeof window === "undefined") return;

    // 완전히 빈 상태면 Draft 삭제
    const firstLine = lines[0];
    const isEmpty =
      !poNo &&
      !buyerId &&
      !dept &&
      !brand &&
      !destination &&
      !orderDate &&
      !reqShipDate &&
      lines.length === 1 &&
      !firstLine.buyerStyleNo &&
      !firstLine.jmStyleNo &&
      !firstLine.qty &&
      !firstLine.amount;

    if (isEmpty) {
      window.localStorage.removeItem(DRAFT_KEY);
      return;
    }

    const draft = {
      poNo,
      orderType,
      status,
      buyerId,
      dept,
      brand,
      currency,
      paymentTermId,
      paymentTermName,
      shipMode,
      courierCarrier,
      destination,
      orderDate,
      reqShipDate,
      cancelDate,
      cancelReason,
      selectedOrigin,
      approvalTarget,
      ppTarget,
      topTarget,
      finalTarget,
      lines,
    };

    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (err) {
      console.error("Failed to save PO draft to localStorage:", err);
    }
  }, [
    poNo,
    orderType,
    status,
    buyerId,
    dept,
    brand,
    currency,
    paymentTermId,
    paymentTermName,
    shipMode,
    courierCarrier,
    destination,
    orderDate,
    reqShipDate,
    cancelDate,
    selectedOrigin,
    approvalTarget,
    ppTarget,
    topTarget,
    finalTarget,
    lines,
  ]);

  const handleCancel = () => {
    if (
      !window.confirm(
        "This will clear all fields and reset the form. Continue?"
      )
    )
      return;
    resetForm();
  };

  
  // ----------------------
  // 📄 Duplicate / Save as New
  // - Keeps current header fields + lines
  // - Clears poHeaderId so backend creates a NEW header row
  // ----------------------
  
  const handleSaveAsCancelled = async () => {
    if (!String(cancelReason || "").trim()) {
      alert("Cancel Reason is required.");
      return;
    }

    // Policy: full CANCELLED is only allowed when NOTHING has been shipped.
    const totalShipped = (lines || []).reduce(
      (sum, l) => sum + Math.trunc(Number((l as any).shipped_qty ?? 0) || 0),
      0
    );

    if (totalShipped > 0) {
      const ok = window.confirm(
        `⚠️ This PO already has shipped quantity (total shipped: ${totalShipped}).\n\n` +
          `You cannot set the whole PO status to CANCELLED after shipping.\n\n` +
          `Do you want to CANCEL ONLY the remaining quantity instead?`
      );
      if (!ok) return;

      const todayStr = new Date().toISOString().slice(0, 10);
      if (!cancelDate) setCancelDate(todayStr);

      const newLines = (lines || []).map((l) => {
        const ordered = Math.trunc(Number(l.qty ?? 0) || 0);
        const shipped = Math.trunc(Number((l as any).shipped_qty ?? 0) || 0);
        const maxCancel = Math.max(0, ordered - shipped);
        return {
          ...l,
          qty_cancelled: maxCancel,
        };
      });

      setLines(newLines);
      // Save header (keep current status), then save cancel qty (cancel-lines API will auto-update status)
      await onSavePO(status, { overrideLines: newLines });
      return;
    }

    // No shipment yet => full cancel is allowed
    const todayStr = new Date().toISOString().slice(0, 10);
    if (!cancelDate) setCancelDate(todayStr);
    await onSavePO("CANCELLED");
  };
const handleDuplicateAsNew = async () => {
    const base = (poNo || "").toString().trim();
    const suggested =
      base && !base.toUpperCase().endsWith("S") ? `${base}S` : `${base}-COPY`;

    const nextPoNo = window.prompt("New PO No (Duplicate as New):", suggested);
    if (!nextPoNo) return;

    // Clear loaded identity so we don't overwrite
    setPoHeaderId(null);
    loadedPoNoRef.current = null;
    loadedHeaderIdRef.current = null;

    setPoNo(nextPoNo.trim());
    setStatus("DRAFT");

    // Optional: reset line_no sequencing to avoid accidental duplicates
    setLines((prev) =>
      (prev || []).map((l: any, idx: number) => ({
        ...l,
        // keep UI id, but normalize line numbers
        lineNo: idx + 1,
      }))
    );

    alert(
      `Duplicated as NEW draft.\n\nNow save to create a new PO: ${nextPoNo.trim()}`
    );
  };


// ----------------------
  // 🗑️ PO 삭제
  // ----------------------
  const handleDeletePO = async () => {
    
    if (!canManage) {
      alert("You do not have permission to delete POs.");
      return;
    }
if (!poNo) {
      alert("There is no PO No. to delete.");
      return;
    }

    if (!window.confirm(`Delete PO ${poNo}? This cannot be undone.`)) {
      return;
    }

    try {
      const res = await fetch("/api/orders", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poNo }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        console.error("Delete PO error:", data);
        alert(
          (data && (data.error || data.message)) ||
            `Failed to delete PO (status ${res.status}).`
        );
        return;
      }

      alert(`PO ${poNo} deleted.`);
      resetForm();
    } catch (err) {
      console.error("Delete PO unexpected error:", err);
      alert("Unexpected error while deleting PO.");
    }
  };

  // ----------------------
  // 🔴 Supabase 저장 로직 (DRAFT / CONFIRMED 공통)
  // ----------------------
  const onSavePO = async (
    targetStatus: POStatus,
    options?: { silent?: boolean; overrideLines?: POLine[] }
  ) => {
    if (saving) return;

    // 1) 현재 로그인 유저 다시 한번 정확히 가져오기
    let createdBy = currentUserId;
    let createdByEmail = currentUserEmail;

    try {
      const { data, error: userError } = await supabase.auth.getUser();
      if (userError) {
        console.error("Failed to get user in onSavePO:", userError);
      }
      const user = data?.user ?? null;
      if (user) {
        createdBy = user.id;
        createdByEmail = user.email ?? createdByEmail;
      }
    } catch (err) {
      console.error("Unexpected error in getUser (onSavePO):", err);
    }


    // PO No 필수 체크 (빈 문자열 방지)
    if (!poNo || poNo.trim() === "") {
      alert("PO No is required.");
      return;
    }
    const linesToSave = options?.overrideLines ?? lines;

    // ✅ Safety: if this page loaded an existing PO and user changed PO No,
    //    saving would RENAME the existing PO (overwrite). Block unless confirmed.
    const loadedPoNo = (loadedPoNoRef.current ?? "").toString().trim();
    const loadedId = (loadedHeaderIdRef.current ?? "").toString().trim();
    const currentPoNo = poNo.toString().trim();

    if (poHeaderId && loadedId && loadedPoNo && currentPoNo && loadedPoNo !== currentPoNo) {
      const okRename = window.confirm(
        `⚠️ You changed PO No from "${loadedPoNo}" to "${currentPoNo}".\n\n` +
          `If you click OK, this will RENAME the EXISTING PO (ID: ${loadedId}).\n` +
          `If you want a NEW PO instead, click Cancel and use "Duplicate / Save as New".`
      );
      if (!okRename) return;
    }

    const toNum = (d: string) => (d ? Number(d.replace(/-/g, "")) : 0);
    const od = toNum(orderDate);
    const ap = toNum(approvalTarget);
    const pp = toNum(ppTarget);
    const tp = toNum(topTarget);
    const fn = toNum(finalTarget);
    const rs = toNum(reqShipDate);

    if (!buyerId) {
      alert("Buyer is required.");
      return;
    }

    if (!currency) {
      alert("Currency is required.");
      return;
    }

    if (!lines.length || lines.every((l) => !l.qty || !l.amount)) {
      alert("Please enter at least one valid line (qty and amount).");
      return;
    }

    if (orderDate && reqShipDate && od > rs) {
      alert("Order Date must be before Requested Ship Date.");
      return;
    }

    if (reqShipDate) {
      const checks = [
        ...(orderType === "REORDER"
          ? []
          : approvalTarget
          ? ([ [ap, rs, "Approval Sample Target Date"] ] as const)
          : []),
        ...(ppTarget
          ? ([ [pp, rs, "PP Sample Target Date"] ] as const)
          : []),
        ...(topTarget
          ? ([ [tp, rs, "TOP Sample Target Date"] ] as const)
          : []),
        ...(finalTarget
          ? ([ [fn, rs, "Final Sample Target Date"] ] as const)
          : []),
      ];

      for (const [x, y, name] of checks) {
        if (x > y) {
          alert(
            `${name} must be before or equal to Requested Ship Date.`
          );
          return;
        }
      }
    }
// Policy (v3): after any shipping happened, do NOT allow full PO status = CANCELLED.
if (targetStatus === "CANCELLED" && hasAnyShipped) {
  alert(
    "You cannot set the whole PO status to CANCELLED after shipping.\n\nPlease cancel only the remaining quantity using Cancel Qty per line."
  );
  return;
}
    const nowIso = new Date().toISOString();

    const todayStr = new Date().toISOString().slice(0, 10);
    const cancelDateToSave =
      targetStatus === "CANCELLED"
        ? (cancelDate || todayStr)
        : (cancelDate || null);

    // 전량취소 저장 시 cancel date가 비어있으면 오늘로 자동 세팅
    if (targetStatus === "CANCELLED" && !cancelDate) {
      setCancelDate(todayStr);
    }

    const headerPayload = {
      id: poHeaderId || undefined,
      po_no: poNo || null,
      order_type: orderType,
      status: targetStatus,
      order_date: orderDate || null,
      buyer_id: buyerId,
      buyer_name: currentBuyer?.name || "",
     // Buyer Brand & Department 저장 (최종)
  buyer_brand_name: brand || null,
  buyer_dept_name: dept || null,

      currency,
      payment_term_id:
        paymentTermId &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          paymentTermId
        )
          ? paymentTermId
          : null,
      payment_term: paymentTermName || null,
      ship_mode: shipMode || null,
      destination: destination || null,
      cancel_date: cancelDateToSave,
      cancel_reason: (cancelReason || null),
      requested_ship_date: reqShipDate || null,
      shipping_origin_code: selectedOrigin || null,
      approval_sample_target_date:
        orderType === "REORDER" ? null : approvalTarget || null,
      pp_sample_target_date: ppTarget || null,
      top_sample_target_date: topTarget || null,
      final_sample_target_date: finalTarget || null,
      created_by: createdBy || null,
      created_by_email: createdByEmail || null,
    };

    const audit = {
      created_by: createdBy || null,
      created_by_email: createdByEmail || null,
      created_at: nowIso,
    };

    const payload = {
      header: headerPayload,
      lines,
      totals: { subtotal },
      audit,
    };

    try {
      setSaving(true);

      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        console.error("Save PO error:", data);
        alert(
          (data && (data.error || data.message)) ||
            `Failed to save PO (status ${res.status}).`
        );
        return;
      }

      setStatus(targetStatus);

      if (!poNo && data?.po_no) {
        setPoNo(data.po_no);
      }


// ✅ qty_cancelled 저장(별도 API): /api/orders/{po_no}/cancel-lines
// - /api/orders POST가 라인에 qty_cancelled를 저장하지 않는 환경에서도 안정적으로 동작하게 분리
const resolvedPoNo = String(poNo || data?.po_no || "").trim();
if (resolvedPoNo) {
  const payloadCancel = {
    cancel_reason: cancelReason || null,
    cancel_date: cancelDateToSave || null,
    lines: (linesToSave || []).map((l) => ({
      po_line_id: l.id,
      qty_cancelled: Number(l.qty_cancelled ?? 0) || 0,
    })),
  };

  // qty_cancelled가 하나라도 있거나, 취소 저장/검증이 필요할 때 호출
  const shouldCallCancel =
    payloadCancel.lines.some((x: any) => (Number(x.qty_cancelled) || 0) > 0) ||
    targetStatus === "CANCELLED";

  if (shouldCallCancel) {
    const resCancel = await fetch(
      `/api/orders/${encodeURIComponent(resolvedPoNo)}/cancel-lines`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadCancel),
      }
    );
    const dataCancel = await resCancel.json().catch(() => null);
    if (!resCancel.ok) {
      console.error("cancel-lines error:", dataCancel);
      alert(
        (dataCancel && (dataCancel.error || dataCancel.message)) ||
          `Failed to save cancel qty (status ${resCancel.status}).`
      );
      // cancel qty 저장 실패해도 PO 자체 저장은 성공했으니 여기서 return은 하지 않음
    }
  }
}

      // keep header id (create/update)
      if (data?.headerId || data?.header_id) {
        setPoHeaderId(String(data.headerId ?? data.header_id));
      }

      // ✅ 저장 성공 시 Draft 삭제
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(DRAFT_KEY);
      }

      if (!options?.silent) {
        alert(
          `PO saved successfully in ${targetStatus} status.\nPO Header ID: ${data.headerId ?? data.header_id ?? ""}`
        );
      }
    } catch (err) {
      console.error("Unexpected error saving PO:", err);
      alert(
        "Unexpected error while saving PO. See console for details."
      );
    } finally {
      setSaving(false);
    }
  };

  // ----------------------
  // Proforma Invoice 생성
  // ----------------------
  const [creatingPI, setCreatingPI] = React.useState(false);

  const handleCreateProforma = async () => {
    // NOTE: Do NOT block PI creation purely on client-side permission flags.
    // Server API will enforce permission; client flags can lag/mismatch for manager/staff.

if (!buyerId) {
      alert("Please select a buyer before creating a proforma invoice.");
      return;
    }
    if (!currency) {
      alert("Currency is required to create a proforma invoice.");
      return;
    }
    if (!lines.length || lines.every((l) => !l.qty || !l.amount)) {
      alert("Please enter at least one valid line (qty and amount).");
      return;
    }
    if (!poNo) {
      alert(
        "Please save the PO first so that PO No. is assigned before creating a proforma invoice."
      );
      return;
    }
    const nowIso = new Date().toISOString();
    const audit = {
      created_by: currentUserId,
      created_by_email: currentUserEmail,
      created_at: nowIso,
    };

    const payload = {
      header: {
        po_no: poNo || undefined,
        buyer_id: buyerId,
        buyer_name: currentBuyer?.name,
        currency,
        payment_term: paymentTermName || undefined,
        ship_mode: shipMode || undefined,
        destination: destination || undefined,
        incoterm: undefined as string | undefined,
      },
      lines: (lines || []).map((l) => ({
        buyerStyleNo: l.buyerStyleNo || null,
        jmStyleNo: l.jmStyleNo || null,
        description: l.description || null,
        color: l.color || null,
        size: l.size || null,
        plating_color: l.plating_color || null,
        hsCode: l.hsCode || null,
        qty: l.qty || 0,
        uom: l.uom || null,
        unitPrice: l.unitPrice || 0,
        currency: l.currency || currency,
        amount: l.amount || 0,
        upcCode: l.upc || null,
      })),
      audit,
    };

    try {
      setCreatingPI(true);

      const res = await fetch("/api/proforma/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to create proforma invoice.");
        return;
      }

      // Option A: 상태만 CONFIRMED로 변경 (Lock 없음)
      await onSavePO("CONFIRMED", { silent: true });

      alert(
        `Proforma Invoice created: ${data.invoice_no}\nPO status updated to CONFIRMED.`
      );
    } catch (err) {
      console.error("Error creating proforma invoice:", err);
      alert("Unexpected error while creating proforma invoice.");
    } finally {
      setCreatingPI(false);
    }
  };

  // ----------------------
  // 📄 현재 화면 상태로 PO PDF 내보내기
  // ----------------------
  const handleExportPdf = () => {
    if (!poNo) {
      alert("PO No. 가 있어야 PDF를 만들 수 있습니다.");
      return;
    }
    if (!lines.length) {
      alert("라인이 하나 이상 있어야 합니다.");
      return;
    }

    const popup = window.open("", "_blank");
    if (!popup) return;

    const fmt = (v: number) =>
      (v ?? 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

    popup.document.write("<html><head><title>Purchase Order</title>");
    popup.document.write(`
      <style>
        body { font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; padding: 24px; }
        h1 { font-size: 20px; margin-bottom: 4px; }
        .subtitle { font-size: 12px; color: #4b5563; margin-bottom: 16px; }
        .section-title { font-size: 13px; font-weight: 600; margin: 16px 0 8px; }
        table { border-collapse: collapse; width: 100%; font-size: 11px; }
        th, td { border: 1px solid #ddd; padding: 4px 6px; text-align: left; }
        th { background: #f3f4f6; }
        .flex { display: flex; justify-content: space-between; gap: 12px; }
        .box { border: 1px solid #e5e7eb; padding: 8px 10px; font-size: 11px; }
        .text-right { text-align: right; }
        .mt-4 { margin-top: 16px; }
      </style>
    `);
    popup.document.write("</head><body>");

    popup.document.write("<h1>Purchase Order</h1>");
    popup.document.write(
      `<div class="subtitle">
        PO No: <strong>${poNo}</strong>
        &nbsp; | &nbsp; Status: ${status}
        &nbsp; | &nbsp; Currency: ${currency}
      </div>`
    );

    popup.document.write('<div class="flex">');
    popup.document.write(`
      <div class="box" style="flex:1;">
        <div class="section-title">Buyer</div>
        <div>${currentBuyer?.name || "-"}</div>
        <div>Dept: ${dept || "-"}</div>
        <div>Brand: ${brand || "-"}</div>
      </div>
    `);
    popup.document.write(`
      <div class="box" style="flex:1;">
        <div class="section-title">Order Info</div>
        <div>Order Date: ${orderDate || "-"}</div>
        <div>Req. Ship Date: ${reqShipDate || "-"}</div>
        <div>Ship Mode: ${shipMode || "-"}</div>
        <div>Destination: ${destination || "-"}</div>
      </div>
    `);
    popup.document.write("</div>");

    popup.document.write(
      '<div class="section-title mt-4">Line Items</div>'
    );
    popup.document.write("<table><thead><tr>");
    const headers = [
      "No",
      "Buyer Style",
      "JM Style",
      "Description",
      "Color",
      "Size",
      "HS",
      "Qty",
      "UOM",
      "Unit Price",
      "Amount",
      "UPC",
    ];
    headers.forEach((h) =>
      popup!.document.write(`<th>${h}</th>`)
    );
    popup.document.write("</tr></thead><tbody>");

    lines.forEach((l, idx) => {
      popup!.document.write("<tr>");
      popup!.document.write(`<td>${idx + 1}</td>`);
      popup!.document.write(`<td>${l.buyerStyleNo || ""}</td>`);
      popup!.document.write(`<td>${l.jmStyleNo || ""}</td>`);
      popup!.document.write(`<td>${l.description || ""}</td>`);
      popup!.document.write(`<td>${l.color || ""}</td>`);
      popup!.document.write(`<td>${l.size || ""}</td>`);
      popup!.document.write(`<td>${l.hsCode || ""}</td>`);
      popup!.document.write(
        `<td class="text-right">${(l.qty ?? 0).toLocaleString()}</td>`
      );
      popup!.document.write(`<td>${l.uom || ""}</td>`);
      popup!.document.write(
        `<td class="text-right">${fmt(l.unitPrice ?? 0)}</td>`
      );
      popup!.document.write(
        `<td class="text-right">${fmt(l.amount ?? 0)}</td>`
      );
      popup!.document.write(`<td>${l.upc || ""}</td>`);
      popup!.document.write("</tr>");
    });

    popup.document.write(`
      <tr>
        <td colspan="10" class="text-right"><strong>Subtotal</strong></td>
        <td class="text-right"><strong>${fmt(subtotal)}</strong></td>
        <td></td>
      </tr>
    `);

    popup.document.write("</tbody></table>");
    popup.document.write("</body></html>");
    popup.document.close();
    popup.focus();
  };

  // 간단 테스트
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const t = computeAmount({
      id: "t",
      buyerStyleNo: "",
      jmStyleNo: "S",
      qty: 2,
      uom: "PCS",
      unitPrice: 3.5,
      currency: "USD",
      upc: "",
      amount: 0,
    } as POLine);
    console.assert(t.amount === 7, "[TEST] amount calc");
  }, []);

  const statusBadgeClass =
    status === "CONFIRMED"
      ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border border-amber-200 bg-amber-50 text-amber-700";


const resolvedRoleRaw = role ?? ("viewer" as DevRole);
const resolvedRole = (typeof resolvedRoleRaw === "string"
  ? resolvedRoleRaw.toLowerCase()
  : String(resolvedRoleRaw).toLowerCase()) as DevRole;

const hasPerm = React.useCallback(
  (key: string) => permissions.includes(key),
  [permissions]
);

// "Manage" here is used to gate data-changing actions on this page (Save/Delete/etc.)
const canManage =
  ["admin", "manager", "staff"].includes(resolvedRole) ||
  hasPerm("orders.manage") ||
  hasPerm("po.manage") ||
  hasPerm("trade.orders.manage");

// PI 생성은 별도 권한 키가 있을 수 있어 넓게 허용 (권한은 API에서도 최종 검증 권장)
const canCreateProforma =
  canManage ||
  ["admin", "manager", "staff"].includes(resolvedRole) ||
  hasPerm("proforma_invoices.create") ||
  hasPerm("proforma.create") ||
  hasPerm("proforma_invoices.manage") ||
  hasPerm("proforma.manage") ||
  hasPerm("trade.proforma.create") ||
  hasPerm("invoices.create") ||
  hasPerm("invoices.manage") ||
  hasPerm("trade.invoices.create") ||
  hasPerm("trade.invoices.manage");


  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="text-sm text-slate-500">Loading...</div>
      </div>
    );
  }

  return (
    <AppShell
      role={resolvedRole}
      title="PO / Orders – Create"
      description="Create and manage purchase orders."
    >
      <div className="flex flex-col space-y-4 lg:space-y-6">
        {/* 상단 탭 (Create / List) */}
        <div className="flex items-center justify-between">
          <Tabs defaultValue="create" className="w-full">
            <div className="flex items-center justify-between mb-2">
              <TabsList>
                <TabsTrigger value="create">Create PO</TabsTrigger>
                <TabsTrigger
                  value="list"
                  onClick={() => router.push("/po/list")}
                >
                  PO List
                </TabsTrigger>
              </TabsList>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPoSearchOpen(true)}
                >
                  Search PO
                </Button>
              </div>
            </div>

            <TabsContent value="create">
              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4 lg:gap-6 items-start">
                {/* 좌측: Header + Lines */}
                <div className="space-y-4 lg:space-y-6">
                  {/* Header Card */}
                  <Card className="shadow-sm border-slate-200">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-base lg:text-lg font-semibold">
                            Create PO
                          </CardTitle>
                          <p className="text-xs lg:text-sm text-slate-500 mt-1">
                            Create a new PO or load an existing one to edit.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadgeClass}`}
                          >
                            {status}
                          </span>
                        </div>
                      </div>
                    </CardHeader>
                    <Separator />
                    <CardContent className="pt-4 space-y-4">
                      {/* 3열 그리드: PO 기본 정보 */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Left Column */}
                        <div className="space-y-4">
                          {/* PO No. / Order Type */}
                          <div className="space-y-2">
                            <Label className="text-xs text-slate-600">
                              PO No.
                            </Label>
                            <Input
                              value={poNo}
                              onChange={(e) => setPoNo(e.target.value)}
                              placeholder="e.g., 4400003943"
                              className="h-9 text-sm"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label className="text-xs text-slate-600">
                              Order Type
                            </Label>
                            <Select
                              value={orderType}
                              onValueChange={(v: OrderType) =>
                                setOrderType(v)
                              }
                            >
                              <SelectTrigger className="h-9 text-sm">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="NEW">NEW</SelectItem>
                                <SelectItem value="REORDER">
                                  RE-ORDER
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Status 표시만 (변경은 버튼으로) */}
                          <div className="space-y-2">
                            <Label className="text-xs text-slate-600">
                              PO Status
                            </Label>
                            <div className="text-xs px-2 py-1 rounded border border-dashed border-slate-300 text-slate-600 bg-slate-50">
                              {status}
                            </div>

                          {/* Cancel Reason */}
                          <div className="space-y-2">
                            <Label className="text-xs text-slate-600">
                              Cancel Reason
                            </Label>
                            <Input
                              value={cancelReason}
                              onChange={(e) => setCancelReason(e.target.value)}
                              placeholder="e.g., Buyer cancelled / revised order"
                              className="h-9 text-sm"
                            />
                          </div>

                          </div>
                        </div>

                        {/* Middle Column */}
                        <div className="space-y-4">
                          {/* Order Date */}
                          <div className="space-y-2">
                            <Label className="text-xs text-slate-600">
                              Order Date
                            </Label>
                            <Input
                              type="date"
                              value={orderDate}
                              onChange={(e) =>
                                setOrderDate(e.target.value)
                              }
                              className="h-9 text-sm"
                            />
                          </div>

                          {/* Requested Ship Date */}
                          <div className="space-y-2">
                            <Label className="text-xs text-slate-600">
                              Requested Ship Date
                            </Label>
                            <Input
                              type="date"
                              value={reqShipDate}
                              onChange={(e) =>
                                setReqShipDate(e.target.value)
                              }
                              className="h-9 text-sm"
                            />
                          </div>

                          {/* Cancel Date */}
                          <div className="space-y-2">
                            <Label className="text-xs text-slate-600">
                              Cancel Date
                            </Label>
                            <Input
                              type="date"
                              value={cancelDate}
                              onChange={(e) =>
                                setCancelDate(e.target.value)
                              }
                              className="h-9 text-sm"
                            />
                          </div>
                        </div>

                        {/* Right Column */}
                        <div className="space-y-4">
                          {/* Currency */}
                          <div className="space-y-2">
                            <Label className="text-xs text-slate-600">
                              Currency
                            </Label>
                            <Select
                              value={currency}
                              onValueChange={(v) => setCurrency(v)}
                            >
                              <SelectTrigger className="h-9 text-sm">
                                <SelectValue placeholder="Select currency" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="USD">USD</SelectItem>
                                <SelectItem value="EUR">EUR</SelectItem>
                                <SelectItem value="JPY">JPY</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Ship Mode */}
                          <div className="space-y-2">
                            <Label className="text-xs text-slate-600">
                              Ship Mode
                            </Label>
                            <Select
                              value={shipMode}
                              onValueChange={(v) => {
                                setShipMode(v);
                                if (v !== "COURIER") {
                                  // keep stored value, but it will not be saved unless COURIER
                                }
                              }}
                            >
                              <SelectTrigger className="h-9 text-sm">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="SEA">SEA</SelectItem>
                                <SelectItem value="AIR">AIR</SelectItem>
                                <SelectItem value="COURIER">
                                  COURIER
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>


{/* Carrier (COURIER only) */}
{shipMode === "COURIER" && (
  <div className="space-y-2">
    <Label className="text-xs text-slate-600">
      Carrier
    </Label>
    <Select
      value={courierCarrier}
      onValueChange={(v) => setCourierCarrier(v)}
    >
      <SelectTrigger className="h-9 text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="FEDEX">FEDEX</SelectItem>
        <SelectItem value="DHL">DHL</SelectItem>
        <SelectItem value="UPS">UPS</SelectItem>
      </SelectContent>
    </Select>
  </div>
)}

                          {/* Destination */}
                          <div className="space-y-2">
                            <Label className="text-xs text-slate-600">
                              Destination
                            </Label>
                            <Input
                              value={destination}
                              onChange={(e) =>
                                setDestination(e.target.value)
                              }
                              placeholder="e.g., USA - LA"
                              className="h-9 text-sm"
                            />
                          </div>
                        </div>
                      </div>

                      <Separator className="my-3" />

                      {/* Buyer / Dept / Brand / Origin */}
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        {/* Buyer */}
                        <div className="space-y-2">
                          <Label className="text-xs text-slate-600">
                            Buyer
                          </Label>
                          <Select
                            value={buyerId}
                            onValueChange={(v) => setBuyerId(v)}
                          >
                            <SelectTrigger className="h-9 text-sm">
                              <SelectValue placeholder="Select buyer" />
                            </SelectTrigger>
                            <SelectContent>
                              {buyers.map((b) => (
                                <SelectItem key={b.id} value={b.id}>
                                  {b.name}
                                  {b.code ? ` (${b.code})` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Brand */}
<div className="space-y-2">
  <Label className="text-xs text-slate-600">Brand</Label>
  <Select
    value={brand || ""}                 // ✅ 선택된 브랜드 이름 그대로
    onValueChange={(value) => {
      setBrand(value);                  // 화면 + 저장용 state 둘 다 이걸로
    }}
  >
    <SelectTrigger className="h-9 text-sm">
      <SelectValue
        placeholder={
          buyerBrands.length
            ? "Select brand"
            : "No brand registered"
        }
      />
    </SelectTrigger>

    {buyerBrands.length > 0 && (
      <SelectContent>
        {buyerBrands.map((b) => (
          <SelectItem key={b.id} value={b.name}>
            {b.name}
          </SelectItem>
        ))}
      </SelectContent>
    )}
  </Select>
</div>

                       {/* Department */}
<div className="space-y-2">
  <Label className="text-xs text-slate-600">Department</Label>
  <Select
    value={dept || ""}                  // ✅ 선택된 dept 이름
    onValueChange={(value) => {
      setDept(value);
    }}
  >
    <SelectTrigger className="h-9 text-sm">
      <SelectValue
        placeholder={
          buyerDepts.length
            ? "Select department"
            : "No department"
        }
      />
    </SelectTrigger>

    {buyerDepts.length > 0 && (
      <SelectContent>
        {buyerDepts.map((d) => (
          <SelectItem key={d.id} value={d.name}>
            {d.name}
          </SelectItem>
        ))}
      </SelectContent>
    )}
  </Select>
</div>

                        {/* Shipping Origin */}
                        <div className="space-y-2">
                          <Label className="text-xs text-slate-600">
                            Shipping Origin
                          </Label>
                          <Select
                            value={selectedOrigin}
                            onValueChange={(v: ShippingOriginCode) =>
                              setSelectedOrigin(v)
                            }
                          >
                            <SelectTrigger className="h-9 text-sm">
                              <SelectValue placeholder="Select origin" />
                            </SelectTrigger>
                            <SelectContent>
                              {(
                                Object.keys(
                                  ORIGIN_LABEL
                                ) as ShippingOriginCode[]
                              ).map((key) => (
                                <SelectItem key={key} value={key}>
                                  {ORIGIN_LABEL[key]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Payment Term & Sample Dates */}
                      <Separator className="my-3" />
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        {/* Payment Term */}
                        <div className="space-y-2">
                          <Label className="text-xs text-slate-600">
                            Payment Term
                          </Label>
                          <Select
                            value={paymentTermId ?? ""}
                            onValueChange={(id) => {
                              const opt = paymentTerms.find(
                                (t) => t.id === id
                              );
                              setPaymentTermId(id || null);
                              setPaymentTermName(
                                opt?.label || opt?.name || ""
                              );
                            }}
                          >
                            <SelectTrigger className="h-9 text-sm">
                              <SelectValue placeholder="Select payment term" />
                            </SelectTrigger>
                            <SelectContent>
                              {paymentTerms.map((t) => (
                                <SelectItem key={t.id} value={t.id}>
                                  {t.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Approval Sample Target Date */}
                        <div className="space-y-2">
                          <Label className="text-xs text-slate-600">
                            Approval Sample Target Date
                          </Label>
                          <Input
                            type="date"
                            value={approvalTarget}
                            onChange={(e) =>
                              setApprovalTarget(e.target.value)
                            }
                            className="h-9 text-sm"
                          />
                        </div>

                        {/* PP Sample Target Date */}
                        <div className="space-y-2">
                          <Label className="text-xs text-slate-600">
                            PP Sample Target Date
                          </Label>
                          <Input
                            type="date"
                            value={ppTarget}
                            onChange={(e) =>
                              setPPTarget(e.target.value)
                            }
                            className="h-9 text-sm"
                          />
                        </div>

                        {/* TOP Sample Target Date */}
                        <div className="space-y-2">
                          <Label className="text-xs text-slate-600">
                            TOP Sample Target Date
                          </Label>
                          <Input
                            type="date"
                            value={topTarget}
                            onChange={(e) =>
                              setTOPTarget(e.target.value)
                            }
                            className="h-9 text-sm"
                          />
                        </div>
                      </div>

                      {/* Final Sample Target Date */}
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-3">
                        <div className="space-y-2">
                          <Label className="text-xs text-slate-600">
                            Final Sample Target Date
                          </Label>
                          <Input
                            type="date"
                            value={finalTarget}
                            onChange={(e) =>
                              setFinalTarget(e.target.value)
                            }
                            className="h-9 text-sm"
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Line Items Card */}
                  <Card className="shadow-sm border-slate-200">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base lg:text-lg font-semibold">
                          Line Items
                        </CardTitle>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleExportPdf}
                          >
                            Export PDF
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={addLine}
                          >
                            + Add Line
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <Separator />
                    <CardContent className="pt-3 space-y-4">
                      <div className="space-y-3">
                        {lines.map((line, index) => (
                          <div
                            key={line.id}
                            className="border border-slate-200 rounded-lg p-3 space-y-3 bg-white"
                          >
                            {/* Header Row: index / delete / main info */}
                            <div className="flex items-center justify-between">
                              <div className="text-xs font-medium text-slate-600">
                                Line {index + 1}
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="text-[11px] text-slate-500">
                                  Amount:{" "}
                                  <span className="font-semibold">
                                    {formatAmountWithComma(line.amount)}
                                  </span>
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-slate-400 hover:text-red-500"
                                  onClick={() => removeLine(line.id)}
                                >
                                  ✕
                                </Button>
                              </div>
                            </div>

                            {/* Buyer Style / JM Style / Description */}
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                              {/* Buyer Style No. */}
                              <div className="space-y-1.5">
                                <Label className="text-[11px] text-slate-600">
                                  Buyer Style No.
                                </Label>
                                <div className="flex gap-1.5">
                                  <Input
                                    value={line.buyerStyleNo}
                                    onChange={(e) =>
                                      updateLine(line.id, {
                                        buyerStyleNo: e.target.value,
                                      })
                                    }
                                    onFocus={() =>
                                      setBuyerStyleFocusId(line.id)
                                    }
                                    placeholder="Buyer style"
                                    className="h-8 text-xs"
                                  />
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="outline"
                                    className="h-8 w-8 text-[11px]"
                                    onClick={() => {
                                      setBuyerStyleFocusId(line.id);
                                      searchBuyerStyles(line.buyerStyleNo);
                                    }}
                                  >
                                    <Search className="h-4 w-4" />
                                  </Button>
                                </div>
                                {/* Buyer Style Search Result */}
                                {buyerStyleFocusId === line.id &&
                                  buyerStyleResults.length > 0 && (
                                    <div className="mt-1 border rounded bg-white shadow-sm max-h-40 overflow-auto text-[11px]">
                                      {buyerStyleLoading && (
                                        <div className="px-2 py-1 text-slate-400">
                                          Loading...
                                        </div>
                                      )}
                                      {buyerStyleResults.map((bs) => (
                                        <button
                                          key={bs.id}
                                          type="button"
                                          className="w-full text-left px-2 py-1 hover:bg-slate-50"
                                          onClick={() =>
                                            applyBuyerStyleToLine(
                                              line.id,
                                              bs
                                            )
                                          }
                                        >
                                          <div className="font-medium">
                                            {bs.buyer_style_no}
                                          </div>
                                          {bs.styles && (
                                            <div className="text-slate-500">
                                              {bs.styles.style_no} –{" "}
                                              {bs.styles.description}
                                            </div>
                                          )}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                              </div>

                              {/* JM Style No. */}
                              <div className="space-y-1.5">
                                <Label className="text-[11px] text-slate-600">
                                  JM Style No.
                                </Label>
                                <div className="flex gap-1.5">
                                  <Input
                                    value={line.jmStyleNo}
                                    onChange={(e) =>
                                      updateLine(line.id, {
                                        jmStyleNo: e.target.value,
                                      })
                                    }
                                    onFocus={() =>
                                      setStyleFocusId(line.id)
                                    }
                                    placeholder="JM style"
                                    className="h-8 text-xs"
                                  />
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="outline"
                                    className="h-8 w-8 text-[11px]"
                                    onClick={() =>
                                      searchStyles(line.jmStyleNo)
                                    }
                                  >
                                    <Search className="h-4 w-4" />
                                  </Button>
                                </div>
                                {/* Style Search Result */}
                                {styleFocusId === line.id &&
                                  styleResults.length > 0 && (
                                    <div className="mt-1 border rounded bg-white shadow-sm max-h-40 overflow-auto text-[11px]">
                                      {styleLoading && (
                                        <div className="px-2 py-1 text-slate-400">
                                          Loading...
                                        </div>
                                      )}
                                      {styleResults.map((s) => (
                                        <button
                                          key={s.id}
                                          type="button"
                                          className="w-full text-left px-2 py-1 hover:bg-slate-50"
                                          onClick={() =>
                                            applyStyleToLine(line.id, s)
                                          }
                                        >
                                          <div className="font-medium">
                                            {s.style_no}
                                          </div>
                                          <div className="text-slate-500">
                                            {s.description}
                                          </div>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                              </div>

                              {/* Description */}
                              <div className="space-y-1.5 md:col-span-2">
                                <Label className="text-[11px] text-slate-600">
                                  Description
                                </Label>
                                <Input
                                  value={line.description || ""}
                                  onChange={(e) =>
                                    updateLine(line.id, {
                                      description: e.target.value,
                                    })
                                  }
                                  placeholder="Item description"
                                  className="h-8 text-xs"
                                />
                              </div>
                            </div>

                            {/* Color / Size / Plating / HS Code */}
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                              <div className="space-y-1.5">
                                <Label className="text-[11px] text-slate-600">
                                  Color
                                </Label>
                                <Input
                                  value={line.color || ""}
                                  onChange={(e) =>
                                    updateLine(line.id, {
                                      color: e.target.value,
                                    })
                                  }
                                  className="h-8 text-xs"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-[11px] text-slate-600">
                                  Size
                                </Label>
                                <Input
                                  value={line.size || ""}
                                  onChange={(e) =>
                                    updateLine(line.id, {
                                      size: e.target.value,
                                    })
                                  }
                                  className="h-8 text-xs"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-[11px] text-slate-600">
                                  plating_color
                                </Label>
                                <Input
                                 value={line.plating_color || ""}
                                 onChange={(e) =>
                                   updateLine(line.id, {
                                    plating_color: e.target.value,
                                   })
                                  }
                                  className="h-8 text-xs"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-[11px] text-slate-600">
                                  HS Code
                                </Label>
                                <Input
                                  value={line.hsCode || ""}
                                  onChange={(e) =>
                                    updateLine(line.id, {
                                      hsCode: e.target.value,
                                    })
                                  }
                                  className="h-8 text-xs"
                                />
                              </div>
                            </div>

                            {/* Qty / UOM / Unit Price / Amount / UPC */}
                            <div className="grid grid-cols-1 md:grid-cols-8 gap-3">
                              {/* Qty */}
                              <div className="space-y-1.5">
                                <Label className="text-[11px] text-slate-600">
                                  Qty
                                </Label>
                                <Input
                                  type="text"
                                  inputMode="numeric"
                                  className="h-8 text-xs text-right"
                                  value={
                                    line.qty
                                      ? formatIntWithComma(line.qty)
                                      : ""
                                  }
                                  onChange={(e) => {
                                    const raw = e.target.value.replace(
                                      /,/g,
                                      ""
                                    );
                                    if (raw === "") {
                                      updateLine(line.id, { qty: 0 });
                                      return;
                                    }
                                    if (!/^\d*$/.test(raw)) return;
                                    const n = Number(raw);
                                    if (Number.isNaN(n)) return;
                                    updateLine(line.id, { qty: n });
                                  }}
                                />
                              </div>

                              {/* Shipped Qty (read only) */}
                              <div className="space-y-1.5">
                                <Label className="text-[11px] text-slate-600">
                                  Shipped
                                </Label>
                                <div className="h-8 text-xs flex items-center justify-end px-2 rounded border border-slate-200 bg-slate-50 text-slate-700">
                                  {line.shipped_qty ? formatIntWithComma(line.shipped_qty) : "0"}
                                </div>
                              </div>

                              {/* Cancel Qty */}
                              <div className="space-y-1.5">
                                <Label className="text-[11px] text-slate-600">
                                  Cancel Qty
                                </Label>
                                <Input
                                  type="text"
                                  inputMode="numeric"
                                  className="h-8 text-xs text-right"
                                  value={
                                    line.qty_cancelled
                                      ? formatIntWithComma(line.qty_cancelled)
                                      : ""
                                  }
                                  onChange={(e) => {
                                    const raw = e.target.value.replace(/,/g, "").trim();
                                    if (!/^\d*$/.test(raw)) return;
                                    const n = Number(raw || "0");
                                    if (Number.isNaN(n)) return;
                                    updateLine(line.id, { qty_cancelled: n } as any);
                                  }}
                                />
                                <div className="text-[10px] text-slate-500">
                                  Max:{" "}
                                  {formatIntWithComma(
                                    Math.max(
                                      0,
                                      (line.qty || 0) - (line.shipped_qty || 0)
                                    )
                                  )}
                                </div>
                              </div>

                              {/* Remaining (computed) */}
                              <div className="space-y-1.5">
                                <Label className="text-[11px] text-slate-600">
                                  Remaining
                                </Label>
                                <div className="h-8 text-xs flex items-center justify-end px-2 rounded border border-slate-200 bg-slate-50 text-slate-700">
                                  {formatIntWithComma(
                                    Math.max(
                                      0,
                                      (line.qty || 0) -
                                        (line.shipped_qty || 0) -
                                        (line.qty_cancelled || 0)
                                    )
                                  )}
                                </div>
                              </div>

                              {/* UOM */}
                              <div className="space-y-1.5">
                                <Label className="text-[11px] text-slate-600">
                                  UOM
                                </Label>
                                <Input
                                  value={line.uom ?? ""}
                                  onChange={(e) =>
                                    updateLine(line.id, {
                                      uom: e.target.value.toUpperCase(),
                                    })
                                  }
                                  className="h-8 text-xs"
                                />
                              </div>

                              {/* Unit Price */}
                              <div className="space-y-1.5">
                                <Label className="text-[11px] text-slate-600">
                                  Unit Price
                                </Label>
                                <Input
                                  type="text"
                                  inputMode="decimal"
                                  className="h-8 text-xs text-right"
                                  value={
                                    line.unitPriceInput !== undefined
                                      ? line.unitPriceInput
                                      : line.unitPrice
                                      ? line.unitPrice.toFixed(2)
                                      : ""
                                  }
                                  onChange={(e) => {
                                    const raw = e.target.value;

                                    // 숫자 + 소수점 4자리까지 허용
                                    if (
                                      !/^\d*(\.\d{0,4})?$/.test(raw)
                                    ) {
                                      return;
                                    }

                                    if (raw === "") {
                                      updateLine(line.id, {
                                        unitPriceInput: "",
                                        unitPrice: 0,
                                      });
                                      return;
                                    }

                                    const n = Number(raw);
                                    if (Number.isNaN(n)) {
                                      // 파싱 안되면 입력 문자열만 유지
                                      updateLine(line.id, {
                                        unitPriceInput: raw,
                                      });
                                      return;
                                    }

                                    updateLine(line.id, {
                                      unitPriceInput: raw,
                                      unitPrice: n,
                                    });
                                  }}
                                  onBlur={() => {
                                    const price = line.unitPrice || 0;
                                    if (price) {
                                      updateLine(line.id, {
                                        unitPriceInput:
                                          price.toFixed(2),
                                      });
                                    } else {
                                      updateLine(line.id, {
                                        unitPriceInput: "",
                                      });
                                    }
                                  }}
                                />
                              </div>

                              {/* Amount (읽기전용) */}
                              <div className="space-y-1.5">
                                <Label className="text-[11px] text-slate-600">
                                  Amount
                                </Label>
                                <Input
                                  readOnly
                                  value={formatAmountWithComma(
                                    line.amount
                                  )}
                                  className="h-8 text-xs text-right bg-slate-50"
                                />
                              </div>

                              {/* UPC */}
                              <div className="space-y-1.5">
                                <Label className="text-[11px] text-slate-600">
                                  UPC
                                </Label>
                                <Input
                                  value={line.upc ?? ""}
                                  onChange={(e) =>
                                    updateLine(line.id, {
                                      upc: e.target.value,
                                    })
                                  }
                                  className="h-8 text-xs"
                                />
                              </div>
                            </div>

                            {/* Remark */}
                            <div className="space-y-1.5">
                              <Label className="text-[11px] text-slate-600">
                                Remark
                              </Label>
                              <Input
                                value={line.remark || ""}
                                onChange={(e) =>
                                  updateLine(line.id, {
                                    remark: e.target.value,
                                  })
                                }
                                className="h-8 text-xs"
                              />
                            </div>

                            {/* Image Upload & Preview */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <div className="space-y-1.5">
                                <Label className="text-[11px] text-slate-600">
                                  Main Image
                                </Label>
                                <div className="flex items-center gap-2">
                                  <Input
                                    type="file"
                                    accept="image/*"
                                    className="h-8 text-xs"
                                    onChange={(e) =>
                                      handleImageFileChange(
                                        line.id,
                                        e
                                      )
                                    }
                                  />
                                  {line.imageUrl && (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-8 text-[11px]"
                                      onClick={() =>
                                        openPreview(
                                          line.imageUrl!,
                                          line.jmStyleNo ||
                                            line.buyerStyleNo
                                        )
                                      }
                                    >
                                      View
                                    </Button>
                                  )}
                                </div>
                              </div>

                              {/* Thumbnail 리스트 */}
                              <div className="md:col-span-2 space-y-1.5">
                                <Label className="text-[11px] text-slate-600">
                                  Thumbnails (max 3)
                                </Label>
                                <div className="flex gap-2 flex-wrap">
                                  {line.images?.map((url) => (
                                    <div
                                      key={url}
                                      className="relative w-16 h-16 border rounded overflow-hidden bg-slate-100 flex items-center justify-center"
                                    >
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={url}
                                        alt=""
                                        className="object-cover w-full h-full cursor-pointer"
                                        onClick={() =>
                                          openPreview(
                                            url,
                                            line.jmStyleNo ||
                                              line.buyerStyleNo
                                          )
                                        }
                                      />
                                      <button
                                        type="button"
                                        className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-white text-[10px] border border-slate-300 flex items-center justify-center text-slate-600 hover:bg-red-50 hover:text-red-600"
                                        onClick={() =>
                                          handleDeleteImage(
                                            line.id,
                                            url
                                          )
                                        }
                                      >
                                        ×
                                      </button>
                                    </div>
                                  ))}
                                  {!line.images?.length && (
                                    <div className="text-[11px] text-slate-400">
                                      No images uploaded.
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* 우측: Summary + Actions */}
                <div className="space-y-4 lg:space-y-6">
                  <Card className="shadow-sm border-slate-200">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base lg:text-lg font-semibold">
                        Summary & Actions
                      </CardTitle>
                    </CardHeader>
                    <Separator />
                    <CardContent className="pt-4 space-y-4">
                      {/* 요약 정보 */}
                      <div className="space-y-3 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-500">Subtotal</span>
                          <span className="font-semibold">
                            {subtotal.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}{" "}
                            {currency}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Lines</span>
                          <span className="font-medium">
                            {lines.length}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Buyer</span>
                          <span className="font-medium">
                            {currentBuyer?.name || "-"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">
                            Destination
                          </span>
                          <span className="font-medium">
                            {destination || "-"}
                          </span>
                        </div>
                      </div>

                      <Separator />

                      {/* 액션 버튼들 */}
                      <div className="space-y-2">
                        <Button
                          type="button"
                          className="w-full"
                          disabled={saving}
                          onClick={() => onSavePO("DRAFT")}
                        >
                          {saving && status === "DRAFT"
                            ? "Saving..."
                            : "Save as Draft"}
                        </Button>

                        <Button
                          type="button"
                          variant="secondary"
                          className="w-full"
                          disabled={saving}
                          onClick={handleDuplicateAsNew}
                        >
                          Duplicate / Save as New
                        </Button>
                        <Button
                          type="button"
                          className="w-full bg-emerald-600 hover:bg-emerald-700"
                          disabled={saving}
                          onClick={() => onSavePO("CONFIRMED")}
                        >
                          {saving && status === "CONFIRMED"
                            ? "Saving..."
                            : "Save as Confirmed"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          title={!canCreateProforma ? "Permission will be verified by server." : ""}
                          onClick={handleCreateProforma}
                          // NOTE: permission is enforced inside handleCreateProforma()
                          disabled={creatingPI || !poNo}
                        >
                          {creatingPI
                            ? "Creating Proforma..."
                            : "Create Proforma Invoice"}
                        </Button>
                        <Button
                          type="button"
                          className="w-full bg-rose-600 hover:bg-rose-700"
                          disabled={saving || !poNo || hasAnyShipped}
                          title={
                            !poNo
                              ? "Save PO first to get PO No."
                              : hasAnyShipped
                              ? "Shipping exists: use Cancel Qty per line"
                              : !String(cancelReason || "").trim()
                              ? "Cancel Reason is required"
                              : "Cancel this PO (buyer cancelled)"
                          }
                          onClick={handleSaveAsCancelled}
                        >
                          {saving && status === "CANCELLED"
                            ? "Saving..."
                            : "Save as Cancelled"}
                        </Button>

                      </div>

                      <Separator />

                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="flex-1"
                          onClick={handleCancel}
                        >
                          Clear
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="flex-1 text-red-600 border-red-200 hover:bg-red-50"
                          onClick={handleDeletePO}
                          disabled={!poNo}
                        >
                          Delete PO
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* PO Search Modal */}
      {poSearchOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-3xl max-h-[80vh] flex flex-col">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div>
                <div className="font-semibold text-sm">Search PO</div>
                <div className="text-xs text-slate-500">
                  Search by PO No, Buyer, Destination, etc.
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setPoSearchOpen(false)}
              >
                ✕
              </Button>
            </div>

            <div className="px-4 py-3 border-b flex gap-2 items-center">
              <Input
                placeholder="Keyword..."
                value={poSearchKeyword}
                onChange={(e) => setPoSearchKeyword(e.target.value)}
                className="h-8 text-sm"
              />
              <Button
                type="button"
                size="sm"
                onClick={() => fetchPoList(poSearchKeyword)}
              >
                Search
              </Button>
            </div>

            <div className="flex-1 overflow-auto">
              {poSearchLoading ? (
                <div className="p-4 text-sm text-slate-500">
                  Loading...
                </div>
              ) : poSearchResults.length === 0 ? (
                <div className="p-4 text-sm text-slate-500">
                  No results found.
                </div>
              ) : (
                <table className="w-full text-xs border-t">
                  <thead className="bg-slate-50">
                    <tr className="text-left">
                      <th className="px-3 py-2 border-b w-28">PO No</th>
                      <th className="px-3 py-2 border-b">Buyer</th>
                      <th className="px-3 py-2 border-b w-28">
                        Order Date
                      </th>
                      <th className="px-3 py-2 border-b w-28">
                        Req. Ship Date
                      </th>
                      <th className="px-3 py-2 border-b w-20 text-right">
                        Amount
                      </th>
                      <th className="px-3 py-2 border-b w-28">Status</th>
                      <th className="px-3 py-2 border-b w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {poSearchResults.map((po) => (
                      <tr key={po.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2 border-b">{po.po_no}</td>
                        <td className="px-3 py-2 border-b">
                          {po.buyer_name || "-"}
                        </td>
                        <td className="px-3 py-2 border-b">
                          {po.order_date || "-"}
                        </td>
                        <td className="px-3 py-2 border-b">
                          {po.requested_ship_date || "-"}
                        </td>
                        <td className="px-3 py-2 border-b text-right">
                          {po.subtotal?.toFixed(2) ?? "-"}
                        </td>
                        <td className="px-3 py-2 border-b">
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] border border-slate-200">
                            {po.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 border-b text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setPoSearchOpen(false);
                              loadPO(po.po_no);
                            }}
                          >
                            Load
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="px-4 py-3 border-t flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPoSearchOpen(false)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {previewImage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div className="text-sm font-medium">
                {previewImage.title || "Image Preview"}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setPreviewImage(null)}
              >
                ✕
              </Button>
            </div>
            <div className="flex-1 p-4 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewImage.url}
                alt=""
                className="max-h-[80vh] max-w-full object-contain rounded-md"
              />
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
