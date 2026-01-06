// src/app/dev/product-register/page.tsx
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import type { AppRole } from "@/config/menuConfig";
import AppShell from "@/components/layout/AppShell";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";

import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import * as XLSX from "xlsx";
import { isValidStyleNo } from "@/lib/styleNo";

type DevRole = AppRole;

type MaterialRow = {
  id: string;
  name: string;
  spec: string;
  qty: string;
  unitPrice: string;
  supplier: string;
};

type OperationRow = {
  id: string;
  name: string;
  qty: string;
  unitPrice: string;
  supplier: string;
};

type ProductCategoryCode =
  | "N"
  | "E"
  | "B"
  | "K"
  | "A"
  | "R"
  | "H"
  | "S"
  | "O";

type CompanyOption = {
  id: string;
  name: string;
  code: string | null;
  company_type?: string | null;
};

type SearchResultRow = {
  styleNo: string;
  productName: string | null;
  productType: string | null;
  devDate: string | null;
  currency: string | null;
};

type HistoryItem = {
  versionNo: number;
  createdAt: string;
  snapshot: {
    header: any;
    materials: any[];
    operations: any[];
  };
};

export default function ProductRegisterPage() {
  const router = useRouter();
  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);

  const [role, setRole] = React.useState<DevRole | null>(null);
  const [loading, setLoading] = React.useState(true);

  const [isPrintMode, setIsPrintMode] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const [styleNo, setStyleNo] = React.useState("JN250001");
  const [styleError, setStyleError] = React.useState<string | null>(null);

  // ✅ Legacy(기존제품) 입력 모드: 스타일 번호 형식 제한 없이 저장 허용
  // - 기존 상품을 DB에 처음 등록할 때(레거시 번호) 사용
  // - 신규 상품(JM 규칙 생성)은 OFF로 두고 Auto Generate 권장
  const [legacyStyleMode, setLegacyStyleMode] = React.useState(false);

  const [productCategory, setProductCategory] =
    React.useState<ProductCategoryCode | "">("");
  const [productType, setProductType] = React.useState("");
  const [weight, setWeight] = React.useState<string>("");
  const [size, setSize] = React.useState("");
  const [devDate, setDevDate] = React.useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [developer, setDeveloper] = React.useState("");
  const [remarks, setRemarks] = React.useState("");
  const [currency, setCurrency] = React.useState<"CNY" | "USD" | "KRW" | "VND">(
    "CNY"
  );

  const [baseStyleNo, setBaseStyleNo] = React.useState("");
  const [colorSuffix, setColorSuffix] = React.useState("");

  const [imageFile, setImageFile] = React.useState<File | null>(null);
  const [imagePreview, setImagePreview] = React.useState<string | null>(null);

  const [materials, setMaterials] = React.useState<MaterialRow[]>([
    { id: "m-1", name: "", spec: "", qty: "", unitPrice: "", supplier: "" },
  ]);

  const [operations, setOperations] = React.useState<OperationRow[]>([
    { id: "o-1", name: "", qty: "", unitPrice: "", supplier: "" },
  ]);

  // Supplier / factory options from companies
  const [suppliers, setSuppliers] = React.useState<CompanyOption[]>([]);

  // Search popup state
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [searchKeyword, setSearchKeyword] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<SearchResultRow[]>([]);
  const [searchLoading, setSearchLoading] = React.useState(false);
  const [searchError, setSearchError] = React.useState<string | null>(null);
  const [searchHasMore, setSearchHasMore] = React.useState(false);

  // History popup state
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [historyError, setHistoryError] = React.useState<string | null>(null);
  const [historyItems, setHistoryItems] = React.useState<HistoryItem[]>([]);
  const [selectedHistory, setSelectedHistory] =
    React.useState<HistoryItem | null>(null);

  const s = (v: any) => (v ?? "").toString();

  // ===== Session check =====
  React.useEffect(() => {
    const loadSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/login?redirectTo=/dev/product-register");
        return;
      }

      const r =
        ((session.user.user_metadata as any)?.role as AppRole | undefined) ||
        "staff";
      setRole(r as DevRole);
      setLoading(false);
    };

    loadSession();
  }, [supabase, router]);

  // ===== Load suppliers/factories from companies =====
  React.useEffect(() => {
    const loadSuppliers = async () => {
      try {
        const { data, error } = await supabase
          .from("companies")
          .select("id, name, code, company_type")
          .order("name", { ascending: true });

        if (error) {
          console.error("Failed to load companies:", error);
          return;
        }
        if (!data) return;

        const filtered = (data as any[]).filter(
          (c) => c.company_type === "supplier" || c.company_type === "factory"
        );

        setSuppliers(
          filtered.map((c) => ({
            id: c.id as string,
            name: c.name as string,
            code: (c.code as string | null) ?? null,
            company_type: c.company_type as string | null,
          }))
        );
      } catch (err) {
        console.error("Failed to load suppliers:", err);
      }
    };

    loadSuppliers();
  }, [supabase]);

  // ===== Numeric utils =====
  const sanitizeNumericInput = (raw: string): string => {
    const onlyNumericAndDot = raw.replace(/[^0-9.]/g, "");
    const firstDotIndex = onlyNumericAndDot.indexOf(".");
    if (firstDotIndex === -1) return onlyNumericAndDot;
    const intPart = onlyNumericAndDot.slice(0, firstDotIndex + 1);
    const decimalPart = onlyNumericAndDot
      .slice(firstDotIndex + 1)
      .replace(/\./g, "");
    return intPart + decimalPart;
  };

  const isValidNumericString = (value: string): boolean => {
    const trimmed = value.trim();
    if (!trimmed) return true;
    return /^\d+(\.\d{0,4})?$/.test(trimmed);
  };

  const toNumber = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (Number.isNaN(n)) return null;
    return n;
  };

  const hasInvalidNumericFields = React.useMemo(() => {
    if (!isValidNumericString(weight)) return true;
    for (const m of materials) {
      if (!isValidNumericString(m.qty)) return true;
      if (!isValidNumericString(m.unitPrice)) return true;
    }
    for (const o of operations) {
      if (!isValidNumericString(o.qty) || !isValidNumericString(o.unitPrice))
        return true;
    }
    return false;
  }, [weight, materials, operations]);

  const isFieldInvalid = (value: string): boolean =>
    !isValidNumericString(value);

  const getActiveMaterials = () =>
    materials.filter((m) =>
      (m.name + m.spec + m.qty + m.unitPrice + m.supplier).trim()
    );

  const getActiveOperations = () =>
    operations.filter((o) =>
      (o.name + o.qty + o.unitPrice + o.supplier).trim()
    );

  const validateAllNumbers = (): boolean => {
    if (!isValidNumericString(weight)) {
      alert("Weight must be a valid number (up to 4 decimals).");
      return false;
    }

    for (const m of getActiveMaterials()) {
      if (!isValidNumericString(m.qty) || !isValidNumericString(m.unitPrice)) {
        alert(
          "Material Qty and Unit Cost must be valid numbers (up to 4 decimals)."
        );
        return false;
      }
    }

    for (const o of getActiveOperations()) {
      if (!isValidNumericString(o.qty) || !isValidNumericString(o.unitPrice)) {
        alert(
          "Operation Qty and Unit Cost must be valid numbers (up to 4 decimals)."
        );
        return false;
      }
    }

    return true;
  };

  // ===== Auto style number generator (공식 JM 번호) =====
  const handleAutoStyleNo = async () => {
    try {
      setStyleError(null);

      const category = (productCategory || "N"); // E, N, B...
      const res = await fetch(
        `/api/dev/styles/next-style-no?category=${encodeURIComponent(category)}`
      );
      const json = await res.json();

      if (!res.ok || json?.success === false) {
        console.error("Failed to generate style number:", json);
        setStyleError(json?.error || "스타일 넘버 자동 생성에 실패했습니다.");
        return;
      }

      // ✅ 서버 응답 키가 styleNo 또는 style_no 어떤 것이든 다 받기
      const nextNo =
        (typeof json?.styleNo === "string" && json.styleNo) ||
        (typeof json?.style_no === "string" && json.style_no) ||
        (typeof json?.nextStyleNo === "string" && json.nextStyleNo) ||
        (typeof json?.next_style_no === "string" && json.next_style_no) ||
        "";

      if (!nextNo.trim()) {
        console.error("style number missing in response:", json);
        setStyleError("스타일 넘버 자동 생성에 실패했습니다.");
        return;
      }

      setStyleNo(nextNo.trim().toUpperCase());
      setLegacyStyleMode(false); // ✅ Auto Generate는 신규 JM 룰이므로 레거시 모드 해제
      setStyleError(null); // ✅ 기존 에러 문구 강제 제거
    } catch (err) {
      console.error("handleAutoStyleNo error:", err);
      setStyleError("스타일 넘버 자동 생성 중 오류가 발생했습니다.");
    }
  };

  // ===== Image handling (원본 5MB 제한 + 자동 리사이즈/압축) =====
  const MAX_ORIGINAL_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB (원본 제한)
  const MAX_IMAGE_DIM = 1600; // 최대 가로/세로 픽셀 (과도한 원본 방지)
  const TARGET_MAX_BYTES = 1_200_000; // 리사이즈 후 목표 용량(약 1.2MB)
  const FIRST_QUALITY = 0.85;
  const FALLBACK_QUALITY = 0.75;

  const loadImageFromFile = (file: File) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = URL.createObjectURL(file);
    });

  const canvasToJpegFile = (
    canvas: HTMLCanvasElement,
    fileNameBase: string,
    quality: number
  ) =>
    new Promise<File>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error("Failed to encode image"));
          const name = `${fileNameBase}.jpg`;
          resolve(new File([blob], name, { type: "image/jpeg" }));
        },
        "image/jpeg",
        quality
      );
    });

  const resizeAndCompressImage = async (file: File) => {
    // 1) 원본 용량 제한
    if (file.size > MAX_ORIGINAL_IMAGE_SIZE) {
      throw new Error("Image file must be 5MB or smaller.");
    }

    // 2) 이미지 로드
    const img = await loadImageFromFile(file);

    // 3) 리사이즈 비율 계산
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;

    const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(w, h));
    const outW = Math.max(1, Math.round(w * scale));
    const outH = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported.");

    // 고품질 리사이즈
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, outW, outH);

    // 4) 1차 압축 (quality 0.85)
    const baseName = (styleNo || "image").trim() || "image";
    let outFile = await canvasToJpegFile(canvas, baseName, FIRST_QUALITY);

    // 5) 여전히 너무 크면 2차 압축 (quality 0.75)
    if (outFile.size > TARGET_MAX_BYTES) {
      outFile = await canvasToJpegFile(canvas, baseName, FALLBACK_QUALITY);
    }

    // 객체 URL 정리(이미지 로드에 사용한 URL)
    try {
      URL.revokeObjectURL((img as any).src);
    } catch {}

    return outFile;
  };

  const handleImageChange: React.ChangeEventHandler<HTMLInputElement> = async (
    e
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const resized = await resizeAndCompressImage(file);

      // 이전 preview URL 정리(메모리 누수 방지) - 단, DB에서 가져온 URL은 revoke 하면 안되니 blob:만 정리
      if (imagePreview && imagePreview.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(imagePreview);
        } catch {}
      }

      setImageFile(resized);
      const url = URL.createObjectURL(resized);
      setImagePreview(url);
    } catch (err: any) {
      console.error("handleImageChange error:", err);
      alert(err?.message || "Failed to process image.");
      (e.target as HTMLInputElement).value = "";
      setImageFile(null);
      setImagePreview(null);
    }
  };

  // ===== Row operations =====
  const addMaterialRow = () => {
    setMaterials((prev) => [
      ...prev,
      {
        id: `m-${prev.length + 1}`,
        name: "",
        spec: "",
        qty: "",
        unitPrice: "",
        supplier: "",
      },
    ]);
  };

  const updateMaterialRow = (
    id: string,
    field: keyof Omit<MaterialRow, "id">,
    value: string
  ) => {
    setMaterials((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              [field]: value,
            }
          : row
      )
    );
  };

  const removeMaterialRow = (id: string) => {
    setMaterials((prev) =>
      prev.length === 1 ? prev : prev.filter((r) => r.id !== id)
    );
  };

  const addOperationRow = () => {
    setOperations((prev) => [
      ...prev,
      {
        id: `o-${prev.length + 1}`,
        name: "",
        qty: "",
        unitPrice: "",
        supplier: "",
      },
    ]);
  };

  const updateOperationRow = (
    id: string,
    field: keyof Omit<OperationRow, "id">,
    value: string
  ) => {
    setOperations((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              [field]: value,
            }
          : row
      )
    );
  };

  const removeOperationRow = (id: string) => {
    setOperations((prev) =>
      prev.length === 1 ? prev : prev.filter((r) => r.id !== id)
    );
  };

  // ===== Reset (화면만 초기화) =====
  const handleReset = () => {
    setStyleNo("JN250001");
    setStyleError(null);
    setLegacyStyleMode(false);
    setProductCategory("");
    setProductType("");
    setWeight("");
    setSize("");
    setDevDate(new Date().toISOString().slice(0, 10));
    setDeveloper("");
    setRemarks("");
    setCurrency("CNY");
    setImageFile(null);
    setImagePreview(null);
    setMaterials([
      { id: "m-1", name: "", spec: "", qty: "", unitPrice: "", supplier: "" },
    ]);
    setOperations([
      { id: "o-1", name: "", qty: "", unitPrice: "", supplier: "" },
    ]);
    setBaseStyleNo("");
    setColorSuffix("");
  };

  // ===== Delete (DB에서 현재 스타일 삭제) =====
  const handleDelete = async () => {
    const trimmed = s(styleNo).trim().toUpperCase();

    if (!trimmed) {
      alert("Style No. is required to delete.");
      return;
    }

    if (
      !window.confirm(
        `Delete style "${trimmed}" from database?\nThis action cannot be undone.`
      )
    ) {
      return;
    }

    try {
      setSaving(true);

      // ✅ 삭제용 API 호출: /api/dev/products + DELETE
      const params = new URLSearchParams({ styleNo: trimmed });
      const res = await fetch(`/api/dev/products?${params.toString()}`, {
        method: "DELETE",
      });

      let data: any = {};
      try {
        data = await res.json();
      } catch {}

      if (!res.ok) {
        console.error("Delete error", data);
        alert(data?.error || "Failed to delete product.");
        return;
      }

      alert("Product deleted successfully.");
      handleReset();
    } catch (err) {
      console.error("Delete request error", err);
      alert("Network or server error while deleting.");
    } finally {
      setSaving(false);
    }
  };

  // ===== Totals =====
  const materialTotal = getActiveMaterials().reduce((sum, r) => {
    const q = toNumber(r.qty) ?? 0;
    const p = toNumber(r.unitPrice) ?? 0;
    return sum + q * p;
  }, 0);

  const operationTotal = getActiveOperations().reduce((sum, r) => {
    const q = toNumber(r.qty) ?? 0;
    const p = toNumber(r.unitPrice) ?? 0;
    return sum + q * p;
  }, 0);

  const total = materialTotal + operationTotal;

  const fxKRW = currency === "CNY" ? total * 190 : 0;
  const fxUSD = currency === "CNY" ? total * 0.14 : 0;
  const fxVND = currency === "CNY" ? total * 3500 : 0;

  // ===== Excel Export =====
  const handleExportExcel = () => {
    if (!validateAllNumbers()) return;

    const headerRows = [
      ["Style No", styleNo],
      ["Product Name", productType],
      ["Category", productCategory],
      ["Weight (g)", weight],
      ["Size", size],
      ["Development Date", devDate],
      ["Developer", developer],
      ["Currency", currency],
      ["Remarks", remarks],
      [],
    ];

    const materialHeader = [
      ["Materials"],
      ["Name", "Spec", "Qty", "Unit Cost", "Supplier", "Amount"],
    ];

    const materialRows = getActiveMaterials().map((m) => {
      const q = toNumber(m.qty) ?? 0;
      const p = toNumber(m.unitPrice) ?? 0;
      const amt = q * p;
      return [m.name, m.spec, m.qty, m.unitPrice, m.supplier, amt ? amt.toFixed(4) : ""];
    });

    const operationHeader = [
      [],
      ["Operations"],
      ["Name", "Qty", "Unit Cost", "Supplier", "Amount"],
    ];

    const operationRows = getActiveOperations().map((o) => {
      const q = toNumber(o.qty) ?? 0;
      const p = toNumber(o.unitPrice) ?? 0;
      const amt = q * p;
      return [o.name, o.qty, o.unitPrice, o.supplier, amt ? amt.toFixed(4) : ""];
    });

    const totalRows = [
      [],
      ["Material Total", materialTotal.toFixed(4)],
      ["Operation Total", operationTotal.toFixed(4)],
      ["Total", total.toFixed(4)],
    ];

    const wsData = [
      ...headerRows,
      ...materialHeader,
      ...materialRows,
      ...operationHeader,
      ...operationRows,
      ...totalRows,
    ];

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Costing");
    XLSX.writeFile(wb, `${styleNo || "style"}_costing.xlsx`);
  };

  // ===== PDF Export =====
  const handleExportPDF = () => {
    if (!validateAllNumbers()) return;

    setIsPrintMode(true);

    setTimeout(async () => {
      const element = document.getElementById("dev-product-register");
      if (!element) {
        alert("Content not found for PDF export.");
        setIsPrintMode(false);
        return;
      }

      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();

      const imgProps = pdf.getImageProperties(imgData);
      const imgHeight = (imgProps.height * pdfWidth) / imgProps.width;

      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, "PNG", 0, position, pdfWidth, imgHeight);
      heightLeft -= pdfHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, pdfWidth, imgHeight);
        heightLeft -= pdfHeight;
      }

      pdf.save(`${styleNo || "style"}_costing.pdf`);
      setIsPrintMode(false);
    }, 80);
  };

  // ===== Apply loaded product (header + materials + operations) =====
  const applyLoadedStyleFromApi = (data: any) => {
    const header = data.header ?? data.product ?? {};

    // 기본 헤더 필드
    if (header.style_no || header.styleNo) {
      const sn = header.style_no ?? header.styleNo;
      if (sn && typeof sn === "string") setStyleNo(sn.toUpperCase());
    }

    if (header.product_category) {
      setProductCategory(header.product_category as ProductCategoryCode);
    }
    if (header.product_type) {
      setProductType(header.product_type as string);
    }
    if (header.weight != null) {
      setWeight(String(header.weight));
    }
    if (header.size) {
      setSize(header.size as string);
    }
    if (header.dev_date) {
      setDevDate(header.dev_date as string);
    }
    if (header.developer) {
      setDeveloper(header.developer as string);
    }
    if (header.remarks) {
      setRemarks(header.remarks as string);
    }
    if (header.currency) {
      setCurrency(header.currency as "CNY" | "USD" | "KRW" | "VND");
    }

    // 이미지
    const imageUrls = header?.image_urls ?? data?.image_urls ?? null;
    const imageUrl =
      Array.isArray(imageUrls) && imageUrls.length > 0 ? imageUrls[0] : null;

    if (imageUrl && typeof imageUrl === "string") {
      setImagePreview(imageUrl);
      setImageFile(null);
    } else {
      setImagePreview(null);
      setImageFile(null);
    }

    // 자재
    const matRows: MaterialRow[] =
      (data.materials as any[] | null)?.map((m, idx) => ({
        id: `m-${idx + 1}`,
        name: m.name ?? "",
        spec: m.spec ?? "",
        qty: m.qty != null ? String(m.qty) : "",
        unitPrice: m.unit_cost != null ? String(m.unit_cost) : "",
        supplier: m.vendor_name ?? m.vendor ?? m.supplier ?? "",
      })) ?? [];

    // 공정
    const opRows: OperationRow[] =
      (data.operations as any[] | null)?.map((o, idx) => ({
        id: `o-${idx + 1}`,
        name: o.name ?? "",
        qty: o.qty != null ? String(o.qty) : "",
        unitPrice: o.unit_cost != null ? String(o.unit_cost) : "",
        supplier: o.vendor_name ?? o.vendor ?? o.supplier ?? "",
      })) ?? [];

    setMaterials(
      matRows.length
        ? matRows
        : [{ id: "m-1", name: "", spec: "", qty: "", unitPrice: "", supplier: "" }]
    );
    setOperations(
      opRows.length
        ? opRows
        : [{ id: "o-1", name: "", qty: "", unitPrice: "", supplier: "" }]
    );
  };

  // ===== 레거시 모드용: 해당 스타일이 DB에 존재하는지 조회 =====
  const checkExistsByProductsApi = async (value: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/dev/products?styleNo=${encodeURIComponent(value)}`);
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) return false;
      return Boolean(json?.header && json.header?.id);
    } catch {
      return false;
    }
  };

  // ===== 스타일 번호 중복 체크 & blur 핸들러 =====
  const checkDuplicateStyle = async (value: string) => {
    try {
      const res = await fetch(
        `/api/dev/styles/check-style-no?styleNo=${encodeURIComponent(value)}`
      );
      const json = await res.json();

      if (!res.ok) {
        setStyleError(json.error || "스타일 번호 중복 확인에 실패했습니다.");
        return;
      }

      if (!json.valid) {
        setStyleError(
          "스타일 번호 형식이 잘못되었습니다. 예: JN250001 또는 JN250001A"
        );
        return;
      }

      if (json.exists) {
        setStyleError("이미 사용 중인 스타일 번호입니다.");
      } else {
        setStyleError(null);
      }
    } catch (err) {
      console.error("checkDuplicateStyle error:", err);
      setStyleError("스타일 번호 중복 확인 중 오류가 발생했습니다.");
    }
  };

  const handleStyleNoBlur = async (
    e: React.FocusEvent<HTMLInputElement, Element>
  ) => {
    const value = e.target.value.trim().toUpperCase();
    if (!value) return;

    // ✅ 레거시 모드: 형식검사/서버 check-style-no(형식 강제) 호출 금지
    if (legacyStyleMode) {
      setStyleError(null);
      // 레거시도 "이미 DB에 있으면" 안내만(막지 않음)
      const exists = await checkExistsByProductsApi(value);
      if (exists) setStyleError("이미 등록된 스타일입니다. 저장하면 업데이트됩니다.");
      return;
    }

    if (!isValidStyleNo(value)) {
      setStyleError(
        "스타일 번호는 J + 카테고리 + YY + 4자리(+옵션문자) 형식이어야 합니다. 예: JN250001"
      );
      return;
    }

    void checkDuplicateStyle(value);
  };

  // ===== Save to Supabase (덮어쓰기 확인 + 히스토리와 연동) =====
  const handleSave = async () => {
    if (!validateAllNumbers()) return;

    const trimmed = s(styleNo).trim().toUpperCase();

    if (!trimmed) {
      alert("Style No. is required.");
      return;
    }

    // ✅ 신규(JM 룰)일 때만 형식 강제. 레거시는 형식 제한 없음.
    if (!legacyStyleMode && !isValidStyleNo(trimmed)) {
      alert("스타일 번호 형식이 잘못되었습니다. 예: JN250001 또는 JN250001A");
      return;
    }

    // 기존 에러 메시지 있으면 막기(레거시 모드에서는 "안내" 문구도 포함될 수 있음 → 저장은 허용)
    if (styleError && !legacyStyleMode) {
      alert(styleError);
      return;
    }

    // 4) 실제 저장 전, 존재여부 확인 + 덮어쓰기 경고
    let exists = false;

    if (legacyStyleMode) {
      // ✅ 레거시: /api/dev/products로 존재여부만 판단 (형식검사 없음)
      exists = await checkExistsByProductsApi(trimmed);
      // 레거시도 덮어쓰기 확인은 동일
      if (exists) {
        const ok = window.confirm(
          [
            `이미 등록된 스타일입니다: ${trimmed}`,
            "",
            "이 스타일은 '기존 자료 수정(업데이트)' 방식으로 저장됩니다.",
            "이전 버전은 History에 백업되어 비교할 수 있습니다.",
            "",
            "계속 진행하시겠습니까?",
          ].join("\n")
        );
        if (!ok) return;
      }
      setStyleError(null);
    } else {
      // ✅ 신규(JM 룰): 서버 check-style-no로 유효성+중복 확인
      try {
        const resCheck = await fetch(
          `/api/dev/styles/check-style-no?styleNo=${encodeURIComponent(trimmed)}`
        );
        const json = await resCheck.json();

        if (!resCheck.ok) {
          console.error("check-style-no error:", json);
          const msg =
            json.error ||
            "스타일 번호 중복 확인에 실패했습니다. 잠시 후 다시 시도해주세요.";
          setStyleError(msg);
          alert(msg);
          return;
        }

        if (!json.valid) {
          const msg =
            "스타일 번호 형식이 잘못되었습니다. 예: JN250001 또는 JN250001A";
          setStyleError(msg);
          alert(msg);
          return;
        }

        exists = !!json.exists;

        if (exists) {
          const ok = window.confirm(
            [
              `이미 사용 중인 스타일 번호입니다: ${trimmed}`,
              "",
              "이 스타일은 '기존 자료 수정(업데이트)' 방식으로 저장됩니다.",
              "저장하면 이전 버전 데이터가 덮어쓰기되지만,",
              "이전 버전은 History에 백업되어 비교할 수 있습니다.",
              "",
              "계속 진행하시겠습니까?",
            ].join("\n")
          );

          if (!ok) return;
        } else {
          setStyleError(null);
        }
      } catch (err) {
        console.error("checkDuplicateStyle before save error:", err);
        const msg =
          "스타일 번호 중복 확인 중 오류가 발생했습니다. 네트워크나 서버 상태를 확인해주세요.";
        setStyleError(msg);
        alert(msg);
        return;
      }
    }

    // 포맷 통일
    if (trimmed !== styleNo) {
      setStyleNo(trimmed);
    }

    const activeMaterials = getActiveMaterials();
    const activeOperations = getActiveOperations();
    const weightNum = toNumber(weight);

    const payload = {
      styleNo: trimmed,
      productCategory: productCategory || null,
      productType: productType.trim() || null,
      weight: weightNum,
      size: size.trim() || null,
      devDate: devDate || null,
      developer: developer.trim() || null,
      remarks: remarks.trim() || null,
      currency,
      baseStyleNo: baseStyleNo.trim() || null,
      colorSuffix: colorSuffix.trim() || null,
      materials: activeMaterials.map((m, index) => ({
        rowIndex: index + 1,
        name: m.name.trim() || null,
        spec: m.spec.trim() || null,
        qty: toNumber(m.qty),
        unitCost: toNumber(m.unitPrice),
        vendorName: m.supplier.trim() || null,
      })),
      operations: activeOperations.map((o, index) => ({
        rowIndex: index + 1,
        name: o.name.trim() || null,
        qty: toNumber(o.qty),
        unitCost: toNumber(o.unitPrice),
        vendorName: o.supplier.trim() || null,
      })),
    };

    try {
      setSaving(true);

      const res = await fetch("/api/dev/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({} as any));

      if (!res.ok) {
        console.error("Save error", data);
        alert(data.error || "Failed to save product.");
        return;
      }

      const baseMsg = exists
        ? "기존 스타일이 성공적으로 업데이트되었고, 이전 버전은 History에 저장되었습니다."
        : "새 스타일이 성공적으로 저장되었습니다.";

      // ===== 이미지가 선택된 경우 → 추가 업로드 =====
      if (imageFile) {
        try {
          const formData = new FormData();
          formData.append("styleNo", trimmed);
          formData.append("file", imageFile);

          const uploadRes = await fetch("/api/dev/products/upload-image", {
            method: "POST",
            body: formData,
          });
          const uploadJson = await uploadRes.json().catch(() => ({} as any));

          if (!uploadRes.ok) {
            console.error("Image upload error", uploadJson);
            alert(
              baseMsg +
                "\n\n단, 이미지 업로드에는 실패했습니다. (나중에 다시 시도해 주세요.)"
            );
            return;
          }

          const imageUrl =
            uploadJson.imageUrl || uploadJson.url || uploadJson.publicUrl;

          if (imageUrl && typeof imageUrl === "string") {
            setImagePreview(imageUrl);
            setImageFile(null);
          }

          alert(baseMsg + "\n\n이미지도 함께 업로드되었습니다.");
        } catch (e) {
          console.error("Image upload request error", e);
          alert(baseMsg + "\n\n단, 네트워크 문제로 이미지 업로드에 실패했습니다.");
        }
      } else {
        alert(baseMsg);
      }
    } catch (err) {
      console.error("Save request error", err);
      alert("Network or server error while saving.");
    } finally {
      setSaving(false);
    }
  };

  // ===== Generate color variation from base style =====
  const handleGenerateColorStyle = async () => {
    if (!baseStyleNo.trim() || !colorSuffix.trim()) {
      alert("Base style no. and color suffix are required.");
      return;
    }

    const base = baseStyleNo.trim().toUpperCase();
    const suffix = colorSuffix.trim().toUpperCase();

    if (base.length !== 8) {
      alert("Base style no. must be exactly 8 characters (e.g. JN250001).");
      return;
    }

    if (suffix.length !== 1) {
      alert("Color suffix must be exactly 1 character (e.g. A, B, C).");
      return;
    }

    const newStyleNo = `${base}${suffix}`; // 9 chars
    setStyleNo(newStyleNo);
    setLegacyStyleMode(false);

    try {
      const res = await fetch(
        `/api/dev/products?styleNo=${encodeURIComponent(base)}`
      );
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Failed to load base style.");
        return;
      }

      // Copy materials & operations from base style
      const matRows: MaterialRow[] =
        (data.materials as any[] | null)?.map((m, idx) => ({
          id: `m-${idx + 1}`,
          name: m.name ?? "",
          spec: m.spec ?? "",
          qty: m.qty != null ? String(m.qty) : "",
          unitPrice: m.unit_cost != null ? String(m.unit_cost) : "",
          supplier: m.vendor_name ?? m.vendor ?? m.supplier ?? "",
        })) ?? [];

      const opRows: OperationRow[] =
        (data.operations as any[] | null)?.map((o, idx) => ({
          id: `o-${idx + 1}`,
          name: o.name ?? "",
          qty: o.qty != null ? String(o.qty) : "",
          unitPrice: o.unit_cost != null ? String(o.unit_cost) : "",
          supplier: o.vendor_name ?? o.vendor ?? o.supplier ?? "",
        })) ?? [];

      setMaterials(
        matRows.length
          ? matRows
          : [{ id: "m-1", name: "", spec: "", qty: "", unitPrice: "", supplier: "" }]
      );
      setOperations(
        opRows.length
          ? opRows
          : [{ id: "o-1", name: "", qty: "", unitPrice: "", supplier: "" }]
      );

      alert("Base style materials & operations copied.");
    } catch (err) {
      console.error("copy from base error", err);
      alert("Error while copying from base style.");
    }
  };

  // ===== Search: load style by styleNo =====
  const handleSearch = async () => {
    const kw = searchKeyword.trim().toUpperCase();

    if (kw.length < 2) {
      setSearchError(
        "Please enter at least 6 characters of the style no. (e.g. JN2500)."
      );
      setSearchResults([]);
      setSearchHasMore(false);
      return;
    }

    try {
      setSearchLoading(true);
      setSearchError(null);
      setSearchResults([]);
      setSearchHasMore(false);

      const params = new URLSearchParams({ keyword: kw });
      const res = await fetch(`/api/dev/products/search?${params.toString()}`, {
        method: "GET",
      });

      const data = await res.json();

      if (!res.ok) {
        console.error("Search error", data);
        setSearchError(data.error || "Failed to search styles.");
        return;
      }

      const items = (data.items as any[]) ?? [];

      const mapped: SearchResultRow[] = items.map((p) => ({
        styleNo:
          (p.style_no as string | undefined) ??
          (p.styleNo as string | undefined) ??
          "",
        productName:
          (p.product_name as string | null | undefined) ??
          (p.productName as string | null | undefined) ??
          null,
        productType:
          (p.product_type as string | null | undefined) ??
          (p.productType as string | null | undefined) ??
          null,
        devDate: (p.dev_date as string | null | undefined) ?? null,
        currency: (p.currency as string | null | undefined) ?? null,
      }));

      setSearchResults(mapped);
      setSearchHasMore(Boolean(data.hasMore));

      if (mapped.length === 0) {
        setSearchError("No matching styles found.");
      }
    } catch (err) {
      console.error("Search request error", err);
      setSearchError("Network or server error during search.");
    } finally {
      setSearchLoading(false);
    }
  };

  const handleLoadFromSearch = async (styleToLoad: string) => {
    if (!styleToLoad) return;

    try {
      const res = await fetch(
        `/api/dev/products?styleNo=${encodeURIComponent(styleToLoad)}`
      );
      const data = await res.json();

      if (!res.ok) {
        console.error("Load from search error", data);
        alert(data.error || "Failed to load selected style.");
        return;
      }

      applyLoadedStyleFromApi(data);
      setLegacyStyleMode(false); // 로드된 스타일은 "등록된 스타일"이므로 레거시 토글은 자동 해제(원하면 다시 켜도 됨)
      setSearchOpen(false);
    } catch (err) {
      console.error("Load from search request error", err);
      alert("Network or server error while loading selected style.");
    }
  };

  // ===== History: load versions for current style =====
  const handleOpenHistory = async () => {
    const trimmed = s(styleNo).trim().toUpperCase();
    if (!trimmed) {
      alert("History를 보려면 먼저 Style No.를 입력하세요.");
      return;
    }

    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryError(null);
    setHistoryItems([]);
    setSelectedHistory(null);

    try {
      const params = new URLSearchParams({ styleNo: trimmed });
      const res = await fetch(`/api/dev/products/history?${params.toString()}`);
      const data = await res.json();

      if (!res.ok) {
        console.error("History load error", data);
        setHistoryError(data.error || "Failed to load history for this style.");
        return;
      }

      const items = (data.items as any[]) ?? [];

      const mapped: HistoryItem[] = items.map((it) => ({
        versionNo: it.version_no as number,
        createdAt: it.created_at as string,
        snapshot: it.snapshot as {
          header: any;
          materials: any[];
          operations: any[];
        },
      }));

      setHistoryItems(mapped);

      if (mapped.length === 0) {
        setHistoryError("No history found for this style.");
      }
    } catch (err) {
      console.error("History request error", err);
      setHistoryError("Network or server error while loading history.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleApplyHistoryVersion = (item: HistoryItem | null) => {
    if (!item) return;
    if (
      !window.confirm(
        [
          `버전 ${item.versionNo}의 내용을 현재 화면에 불러옵니다.`,
          "저장하지 않은 현재 변경 내용은 사라집니다.",
          "",
          "계속 진행하시겠습니까?",
        ].join("\n")
      )
    ) {
      return;
    }

    applyLoadedStyleFromApi(item.snapshot);
    setLegacyStyleMode(false);
    setHistoryOpen(false);
    setSelectedHistory(null);
  };

  if (loading || !role) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="text-sm text-slate-500">Loading...</div>
      </div>
    );
  }

  // ================= UI =================
  return (
    <AppShell
      role={role}
      title="Product Development"
      description="Register new styles and calculate development cost."
    >
      <div id="dev-product-register" className="p-2">
        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="pb-4 flex flex-row items-center justify-between">
            <CardTitle className="text-lg font-semibold">
              Product Registration (Development)
            </CardTitle>
            <div className="flex items-center gap-3 text-xs">
              <Button
                type="button"
                variant="outline"
                className="h-8 px-3 text-xs bg-slate-100"
                onClick={() => {
                  setSearchOpen(true);
                  setSearchKeyword("");
                  setSearchResults([]);
                  setSearchError(null);
                  setSearchHasMore(false);
                }}
              >
                Search
              </Button>

              <Button
                type="button"
                variant="outline"
                className="h-8 px-3 text-xs bg-slate-100"
                onClick={handleOpenHistory}
              >
                History
              </Button>

              <div className="flex items-center gap-2">
                <span className="text-slate-600">Base currency:</span>
                <Select
                  value={currency}
                  onValueChange={(v) =>
                    setCurrency(v as "CNY" | "USD" | "KRW" | "VND")
                  }
                >
                  <SelectTrigger className="h-8 w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CNY">CNY</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="KRW">KRW</SelectItem>
                    <SelectItem value="VND">VND</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-[2.2fr,1fr] gap-6">
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-[1.3fr,auto] gap-2 items-end">
                  <div>
                    <div className="flex items-center justify-between">
                      <Label className="mb-2 block">Style No.</Label>

                      {!isPrintMode && (
                        <label className="flex items-center gap-2 text-[11px] text-slate-600 select-none">
                          <input
                            type="checkbox"
                            checked={legacyStyleMode}
                            onChange={(e) => {
                              const on = e.target.checked;
                              setLegacyStyleMode(on);
                              setStyleError(null);
                            }}
                          />
                          Legacy style (allow any)
                        </label>
                      )}
                    </div>

                    {isPrintMode ? (
                      <div className="min-h-[34px] flex items-center justify-center px-3 border rounded-md bg-white text-sm">
                        {styleNo}
                      </div>
                    ) : (
                      <>
                        <Input
                          className="h-9"
                          value={styleNo}
                          onChange={(e) => setStyleNo(e.target.value.toUpperCase())}
                          onBlur={handleStyleNoBlur}
                          placeholder={
                            legacyStyleMode
                              ? "Any style no. allowed (legacy)."
                              : "e.g. JN250001 or JN250001A"
                          }
                        />
                        {!legacyStyleMode && (
                          <p className="mt-1 text-[11px] text-slate-500">
                            신규 제품은 JM 규칙 사용 권장 (Auto Generate).
                          </p>
                        )}
                        {legacyStyleMode && (
                          <p className="mt-1 text-[11px] text-slate-500">
                            기존 제품(레거시) 등록용: 자리수/형식 제한 없이 저장됩니다.
                          </p>
                        )}
                        {styleError && (
                          <p className="mt-1 text-xs text-red-500">{styleError}</p>
                        )}
                      </>
                    )}
                  </div>

                  {!isPrintMode && (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 text-xs"
                      onClick={handleAutoStyleNo}
                    >
                      Auto Generate
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="mb-2 block">
                      Product Type / Category
                    </Label>
                    {isPrintMode ? (
                      <div className="min-h-[34px] flex items-center justify-center px-3 border rounded-md bg-white text-xs">
                        {productCategory}
                      </div>
                    ) : (
                      <Select
                        value={productCategory || ""}
                        onValueChange={(v) =>
                          setProductCategory(v as ProductCategoryCode)
                        }
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="N">Necklace (JN)</SelectItem>
                          <SelectItem value="E">Earring (JE)</SelectItem>
                          <SelectItem value="B">Bracelet (JB)</SelectItem>
                          <SelectItem value="R">Ring (JR)</SelectItem>
                          <SelectItem value="H">Hair (JH)</SelectItem>
                          <SelectItem value="K">Keyring (JK)</SelectItem>
                          <SelectItem value="A">Anklet (JA)</SelectItem>
                          <SelectItem value="S">Set (JS)</SelectItem>
                          <SelectItem value="O">Other (JO)</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  <div>
                    <Label className="mb-2 block">Weight (g)</Label>
                    {isPrintMode ? (
                      <div className="min-h-[34px] flex items-center justify-center px-3 border rounded-md bg-white text-xs">
                        {weight}
                      </div>
                    ) : (
                      <>
                        <Input
                          className={`h-9 text-center ${
                            isFieldInvalid(weight)
                              ? "border-red-500 focus-visible:ring-red-500"
                              : ""
                          }`}
                          type="text"
                          inputMode="decimal"
                          value={weight}
                          onChange={(e) =>
                            setWeight(sanitizeNumericInput(e.target.value))
                          }
                          placeholder="e.g. 12.3456"
                        />
                        {isFieldInvalid(weight) && (
                          <p className="mt-1 text-[10px] text-red-500">
                            Only numbers and one decimal point are allowed (up
                            to 4 decimal places).
                          </p>
                        )}
                      </>
                    )}
                  </div>
                  <div>
                    <Label className="mb-2 block">Size</Label>
                    {isPrintMode ? (
                      <div className="min-h-[34px] flex items-center justify-center px-3 border rounded-md bg-white text-xs">
                        {size}
                      </div>
                    ) : (
                      <Input
                        className="h-9 text-center"
                        placeholder='e.g. 16" + 2" EXT'
                        value={size}
                        onChange={(e) => setSize(e.target.value)}
                      />
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="mb-2 block">Product Name</Label>
                    {isPrintMode ? (
                      <div className="min-h-[34px] flex items-center justify-center px-3 border rounded-md bg-white text-xs">
                        {productType}
                      </div>
                    ) : (
                      <Input
                        className="h-9"
                        placeholder="e.g. 3-row chain necklace"
                        value={productType}
                        onChange={(e) => setProductType(e.target.value)}
                      />
                    )}
                  </div>
                  <div>
                    <Label className="mb-2 block">Development Date</Label>
                    {isPrintMode ? (
                      <div className="min-h-[34px] flex items-center justify-center px-3 border rounded-md bg-white text-xs">
                        {devDate}
                      </div>
                    ) : (
                      <Input
                        className="h-9"
                        type="date"
                        value={devDate}
                        onChange={(e) => setDevDate(e.target.value)}
                      />
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="mb-2 block">Developer</Label>
                    {isPrintMode ? (
                      <div className="min-h-[34px] flex items-center justify-center px-3 border rounded-md bg-white text-xs">
                        {developer}
                      </div>
                    ) : (
                      <Input
                        className="h-9"
                        placeholder="Developer name"
                        value={developer}
                        onChange={(e) => setDeveloper(e.target.value)}
                      />
                    )}
                  </div>

                  {!isPrintMode && (
                    <div className="border rounded-lg px-3 py-2 bg-slate-50">
                      <p className="text-[11px] font-semibold mb-1">
                        Color variation from base style
                      </p>
                      <div className="flex gap-2 items-center">
                        <Input
                          className="h-7 text-xs"
                          placeholder="Base style no. (e.g. JN250001)"
                          value={baseStyleNo}
                          onChange={(e) =>
                            setBaseStyleNo(e.target.value.toUpperCase())
                          }
                        />
                        <span className="text-xs">+</span>
                        <Input
                          className="h-7 w-16 text-xs text-center"
                          placeholder="A"
                          value={colorSuffix}
                          onChange={(e) =>
                            setColorSuffix(e.target.value.toUpperCase())
                          }
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px]"
                          onClick={handleGenerateColorStyle}
                        >
                          Apply
                        </Button>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1">
                        When the product is the same and only the color is
                        different: use Base style + A/B/C… and copy costing and
                        operations from the base style.
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  <Label className="mb-2 block">Remarks / Description</Label>
                  {isPrintMode ? (
                    <div className="min-h-[60px] border rounded-md bg-white px-3 py-2 text-xs whitespace-pre-wrap">
                      {remarks}
                    </div>
                  ) : (
                    <Textarea
                      rows={3}
                      placeholder="Notes about product development, reference info, etc."
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                    />
                  )}
                </div>
              </div>

              {/* Image */}
              <div className="flex flex-col items-center border rounded-xl p-4 bg-slate-50">
                <div className="w-40 h-52 border rounded-lg bg-white flex items-center justify-center overflow-hidden mb-3">
                  {imagePreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imagePreview}
                      alt="Product"
                      className="max-w-full max-h-full object-contain"
                    />
                  ) : (
                    <span className="text-xs text-slate-400">No image</span>
                  )}
                </div>

                {!isPrintMode && (
                  <div className="flex flex-col gap-2 w-full items-center">
                    <Input
                      type="file"
                      accept="image/*"
                      className="text-xs"
                      onChange={handleImageChange}
                    />
                    <div className="flex gap-2 mt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!imagePreview}
                        onClick={() => {
                          if (!imagePreview) return;
                          const a = document.createElement("a");
                          a.href = imagePreview;
                          a.download = `${styleNo || "image"}.jpg`;
                          a.click();
                        }}
                      >
                        Download Image
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!imagePreview}
                        onClick={async () => {
                          if (!imagePreview) return;

                          const trimmedStyleNo = (styleNo || "").trim().toUpperCase();

                          if (!trimmedStyleNo) {
                            setImageFile(null);
                            setImagePreview(null);
                            return;
                          }

                          if (
                            typeof window !== "undefined" &&
                            !window.confirm(
                              "이미지를 완전히 삭제하시겠어요?\n(DB와 Storage에서도 삭제됩니다.)"
                            )
                          ) {
                            return;
                          }

                          try {
                            const params = new URLSearchParams({ styleNo: trimmedStyleNo });
                            const res = await fetch(
                              `/api/dev/products/upload-image?${params.toString()}`,
                              { method: "DELETE" }
                            );

                            const json = await res.json().catch(() => ({} as any));

                            if (!res.ok || !json?.success) {
                              console.error("Image delete error:", json);
                              alert(json?.error || "이미지 삭제에 실패했습니다.");
                              return;
                            }

                            setImageFile(null);
                            setImagePreview(null);
                          } catch (err) {
                            console.error("Image delete request failed:", err);
                            alert("이미지 삭제 중 서버 통신 오류가 발생했습니다.");
                          }
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                    {imageFile && (
                      <p className="text-[11px] text-slate-500 mt-1">
                        {imageFile.name}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* MATERIALS */}
            <div className="space-y-2 text-sm">
              <h3 className="font-semibold">Material Composition</h3>
              <div className="border rounded-xl overflow-hidden bg-white">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 text-xs">
                    <tr className="align-middle">
                      <th className="border px-2 py-2 w-[28%]">
                        <div className="flex h-8 items-center justify-center text-center leading-[1.2]">
                          Material Name
                        </div>
                      </th>
                      <th className="border px-2 py-2 w-[28%]">
                        <div className="flex h-8 items-center justify-center text-center leading-[1.2]">
                          Spec / Description
                        </div>
                      </th>
                      <th className="border px-2 py-2 w-[10%]">
                        <div className="flex h-8 items-center justify-center text-center leading-[1.2]">
                          Qty
                        </div>
                      </th>
                      <th className="border px-2 py-2 w-[12%]">
                        <div className="flex h-8 items-center justify-center text-center leading-[1.2]">
                          Unit Cost
                        </div>
                      </th>
                      <th className="border px-2 py-2 w-[18%]">
                        <div className="flex h-8 items-center justify-center text-center leading-[1.2]">
                          Supplier
                        </div>
                      </th>
                      <th className="border px-2 py-2 w-[4%]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {materials.map((row) => (
                      <tr key={row.id} className="align-middle">
                        <td className="border px-2 py-2 align-middle">
                          {isPrintMode ? (
                            <div className="min-h-[28px] flex items-center justify-center px-1 text-[11px] leading-[1.3]">
                              {row.name}
                            </div>
                          ) : (
                            <Input
                              className="h-8 text-xs text-center"
                              value={row.name}
                              onChange={(e) =>
                                updateMaterialRow(row.id, "name", e.target.value)
                              }
                            />
                          )}
                        </td>
                        <td className="border px-2 py-2 align-middle">
                          {isPrintMode ? (
                            <div className="min-h-[28px] flex items-center justify-center px-1 text-[11px] leading-[1.3]">
                              {row.spec}
                            </div>
                          ) : (
                            <Input
                              className="h-8 text-xs text-center"
                              value={row.spec}
                              onChange={(e) =>
                                updateMaterialRow(row.id, "spec", e.target.value)
                              }
                            />
                          )}
                        </td>
                        <td className="border px-2 py-2 align-middle">
                          {isPrintMode ? (
                            <div className="min-h-[28px] flex items-center justify-center px-1 text-[11px] leading-[1.3]">
                              {row.qty}
                            </div>
                          ) : (
                            <>
                              <Input
                                className={`h-8 text-xs text-center ${
                                  isFieldInvalid(row.qty)
                                    ? "border-red-500 focus-visible:ring-red-500"
                                    : ""
                                }`}
                                type="text"
                                inputMode="decimal"
                                value={row.qty}
                                onChange={(e) =>
                                  updateMaterialRow(
                                    row.id,
                                    "qty",
                                    sanitizeNumericInput(e.target.value)
                                  )
                                }
                                placeholder="0.0000"
                              />
                              {isFieldInvalid(row.qty) && (
                                <p className="mt-1 text-[10px] text-red-500">
                                  Only numbers and one decimal point are allowed
                                  (up to 4 decimal places).
                                </p>
                              )}
                            </>
                          )}
                        </td>
                        <td className="border px-2 py-2 align-middle">
                          {isPrintMode ? (
                            <div className="min-h-[28px] flex items-center justify-center px-1 text-[11px] leading-[1.3]">
                              {row.unitPrice}
                            </div>
                          ) : (
                            <>
                              <Input
                                className={`h-8 text-xs text-center ${
                                  isFieldInvalid(row.unitPrice)
                                    ? "border-red-500 focus-visible:ring-red-500"
                                    : ""
                                }`}
                                type="text"
                                inputMode="decimal"
                                value={row.unitPrice}
                                onChange={(e) =>
                                  updateMaterialRow(
                                    row.id,
                                    "unitPrice",
                                    sanitizeNumericInput(e.target.value)
                                  )
                                }
                                placeholder="0.0000"
                              />
                              {isFieldInvalid(row.unitPrice) && (
                                <p className="mt-1 text-[10px] text-red-500">
                                  Only numbers and one decimal point are allowed
                                  (up to 4 decimal places).
                                </p>
                              )}
                            </>
                          )}
                        </td>
                        <td className="border px-2 py-2 align-middle">
                          {isPrintMode ? (
                            <div className="min-h-[28px] flex items-center justify-center px-1 text-[11px] leading-[1.3]">
                              {row.supplier}
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1">
                              <Select
                                value=""
                                onValueChange={(id) => {
                                  const found = suppliers.find((s) => s.id === id);
                                  const label = found
                                    ? found.code
                                      ? `${found.code} - ${found.name}`
                                      : found.name
                                    : "";
                                  updateMaterialRow(row.id, "supplier", label);
                                }}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue placeholder="Select supplier" />
                                </SelectTrigger>
                                <SelectContent>
                                  {suppliers.map((s) => (
                                    <SelectItem key={s.id} value={s.id}>
                                      {s.code ? `${s.code} - ${s.name}` : s.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>

                              <Input
                                className="h-7 text-[11px] text-center"
                                placeholder="Or type supplier manually"
                                value={row.supplier}
                                onChange={(e) =>
                                  updateMaterialRow(row.id, "supplier", e.target.value)
                                }
                              />
                            </div>
                          )}
                        </td>
                        <td className="border px-2 py-2 align-middle text-center">
                          {!isPrintMode && (
                            <button
                              type="button"
                              className="text-[11px] text-red-500"
                              onClick={() => removeMaterialRow(row.id)}
                            >
                              Remove
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!isPrintMode && (
                  <button
                    type="button"
                    className="text-[11px] text-sky-700 px-2 py-1"
                    onClick={addMaterialRow}
                  >
                    + Add material
                  </button>
                )}
              </div>
            </div>

            {/* OPERATIONS */}
            <div className="space-y-2 text-sm">
              <h3 className="font-semibold">Operations (Labor / Process)</h3>
              <div className="border rounded-xl overflow-hidden bg-white">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 text-xs">
                    <tr className="align-middle">
                      <th className="border px-2 py-2 w-[42%]">
                        <div className="flex h-8 items-center justify-center text-center leading-[1.2]">
                          Operation Name
                        </div>
                      </th>
                      <th className="border px-2 py-2 w-[12%]">
                        <div className="flex h-8 items-center justify-center text-center leading-[1.2]">
                          Qty
                        </div>
                      </th>
                      <th className="border px-2 py-2 w-[14%]">
                        <div className="flex h-8 items-center justify-center text-center leading-[1.2]">
                          Unit Cost
                        </div>
                      </th>
                      <th className="border px-2 py-2 w-[24%]">
                        <div className="flex h-8 items-center justify-center text-center leading-[1.2]">
                          Supplier
                        </div>
                      </th>
                      <th className="border px-2 py-2 w-[8%]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {operations.map((row) => (
                      <tr key={row.id} className="align-middle">
                        <td className="border px-2 py-2 align-middle">
                          {isPrintMode ? (
                            <div className="min-h-[28px] flex items-center justify-center px-1 text-[11px] leading-[1.3]">
                              {row.name}
                            </div>
                          ) : (
                            <Input
                              className="h-8 text-xs text-center"
                              value={row.name}
                              onChange={(e) =>
                                updateOperationRow(row.id, "name", e.target.value)
                              }
                            />
                          )}
                        </td>
                        <td className="border px-2 py-2 align-middle">
                          {isPrintMode ? (
                            <div className="min-h-[28px] flex items-center justify-center px-1 text-[11px] leading-[1.3]">
                              {row.qty}
                            </div>
                          ) : (
                            <>
                              <Input
                                className={`h-8 text-xs text-center ${
                                  isFieldInvalid(row.qty)
                                    ? "border-red-500 focus-visible:ring-red-500"
                                    : ""
                                }`}
                                type="text"
                                inputMode="decimal"
                                value={row.qty}
                                onChange={(e) =>
                                  updateOperationRow(
                                    row.id,
                                    "qty",
                                    sanitizeNumericInput(e.target.value)
                                  )
                                }
                                placeholder="0.0000"
                              />
                              {isFieldInvalid(row.qty) && (
                                <p className="mt-1 text-[10px] text-red-500">
                                  Only numbers and one decimal point are allowed
                                  (up to 4 decimal places).
                                </p>
                              )}
                            </>
                          )}
                        </td>
                        <td className="border px-2 py-2 align-middle">
                          {isPrintMode ? (
                            <div className="min-h-[28px] flex items-center justify-center px-1 text-[11px] leading-[1.3]">
                              {row.unitPrice}
                            </div>
                          ) : (
                            <>
                              <Input
                                className={`h-8 text-xs text-center ${
                                  isFieldInvalid(row.unitPrice)
                                    ? "border-red-500 focus-visible:ring-red-500"
                                    : ""
                                }`}
                                type="text"
                                inputMode="decimal"
                                value={row.unitPrice}
                                onChange={(e) =>
                                  updateOperationRow(
                                    row.id,
                                    "unitPrice",
                                    sanitizeNumericInput(e.target.value)
                                  )
                                }
                                placeholder="0.0000"
                              />
                              {isFieldInvalid(row.unitPrice) && (
                                <p className="mt-1 text-[10px] text-red-500">
                                  Only numbers and one decimal point are allowed
                                  (up to 4 decimal places).
                                </p>
                              )}
                            </>
                          )}
                        </td>
                        <td className="border px-2 py-2 align-middle">
                          {isPrintMode ? (
                            <div className="min-h-[28px] flex items-center justify-center px-1 text-[11px] leading-[1.3]">
                              {row.supplier}
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1">
                              <Select
                                value=""
                                onValueChange={(id) => {
                                  const found = suppliers.find((s) => s.id === id);
                                  const label = found
                                    ? found.code
                                      ? `${found.code} - ${found.name}`
                                      : found.name
                                    : "";
                                  updateOperationRow(row.id, "supplier", label);
                                }}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue placeholder="Select supplier" />
                                </SelectTrigger>
                                <SelectContent>
                                  {suppliers.map((s) => (
                                    <SelectItem key={s.id} value={s.id}>
                                      {s.code ? `${s.code} - ${s.name}` : s.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>

                              <Input
                                className="h-7 text-[11px] text-center"
                                placeholder="Or type supplier manually"
                                value={row.supplier}
                                onChange={(e) =>
                                  updateOperationRow(row.id, "supplier", e.target.value)
                                }
                              />
                            </div>
                          )}
                        </td>
                        <td className="border px-2 py-2 align-middle text-center">
                          {!isPrintMode && (
                            <button
                              type="button"
                              className="text-[11px] text-red-500"
                              onClick={() => removeOperationRow(row.id)}
                            >
                              Remove
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!isPrintMode && (
                  <button
                    type="button"
                    className="text-[11px] text-sky-700 px-2 py-1"
                    onClick={addOperationRow}
                  >
                    + Add operation
                  </button>
                )}
              </div>
            </div>

            {/* Summary */}
            <div className="border rounded-xl bg-slate-50 px-4 py-3 text-xs space-y-1">
              <div>
                <span className="font-semibold">Auto cost summary</span>
              </div>
              <div>
                Material cost:{" "}
                <span className="font-semibold">
                  {materialTotal.toFixed(4)} {currency}
                </span>
              </div>
              <div>
                Operation cost:{" "}
                <span className="font-semibold">
                  {operationTotal.toFixed(4)} {currency}
                </span>
              </div>
              <div>
                Total:{" "}
                <span className="font-semibold">
                  {total.toFixed(4)} {currency}
                </span>
              </div>
              {currency === "CNY" && (
                <div className="mt-1 text-[11px] text-slate-600">
                  Converted (sample rates): KRW {fxKRW.toFixed(0)} / USD{" "}
                  {fxUSD.toFixed(2)} / VND {fxVND.toFixed(0)}
                </div>
              )}
            </div>

            {/* Buttons */}
            <div className="flex justify-end gap-3 pt-2">
              {!isPrintMode && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 px-4 text-sm"
                    onClick={handleReset}
                  >
                    Clear
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 px-4 text-sm border-red-500 text-red-600 hover:bg-red-50"
                    onClick={handleDelete}
                    disabled={saving || !s(styleNo).trim()}
                  >
                    Delete
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 px-4 text-sm"
                    onClick={handleExportExcel}
                    disabled={hasInvalidNumericFields}
                  >
                    Export Excel
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 px-4 text-sm"
                    onClick={handleExportPDF}
                    disabled={hasInvalidNumericFields}
                  >
                    Export PDF
                  </Button>
                  <Button
                    type="button"
                    className="h-10 px-6 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={handleSave}
                    disabled={saving || hasInvalidNumericFields}
                  >
                    {saving ? "Saving..." : "Save"}
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search popup overlay */}
      {searchOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-lg shadow-lg p-4 w-full max-w-md text-sm">
            <h2 className="text-base font-semibold mb-2">Search style</h2>

            <div className="flex gap-2 mb-2">
              <Input
                autoFocus
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="Enter style no. (e.g. JN250001) or partial no."
              />
              <Button
                type="button"
                className="px-4"
                onClick={handleSearch}
                disabled={searchLoading}
              >
                {searchLoading ? "Searching..." : "Search"}
              </Button>
            </div>

            {searchError && (
              <p className="text-[11px] text-red-500 mb-1">{searchError}</p>
            )}

            <div className="max-h-48 overflow-auto border rounded-md mt-1">
              {searchResults.length === 0 && !searchError && (
                <p className="text-[11px] text-slate-400 px-3 py-2">
                  Search results will be shown here.
                </p>
              )}
              {searchResults.map((row) => (
                <div
                  key={row.styleNo}
                  className="flex items-center justify-between border-b last:border-b-0 px-3 py-1.5"
                >
                  <div className="text-[11px]">
                    <div className="font-semibold">
                      {row.styleNo}
                      {row.productName || row.productType
                        ? ` / ${row.productName || row.productType}`
                        : ""}
                    </div>
                    <div className="text-slate-500">
                      {row.productType || "-"}
                      {row.devDate ? ` | ${row.devDate}` : ""}
                      {row.currency ? ` | ${row.currency}` : ""}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-3 text-[11px]"
                    onClick={() => handleLoadFromSearch(row.styleNo)}
                  >
                    Load
                  </Button>
                </div>
              ))}
            </div>

            {searchHasMore && (
              <p className="text-[11px] text-orange-600 mt-1">
                Too many results. Only the first batch is shown. Please type a
                longer style number to narrow down.
              </p>
            )}

            <div className="flex justify-end gap-2 mt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSearchOpen(false)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* History popup overlay */}
      {historyOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-lg shadow-lg p-4 w-full max-w-2xl text-sm">
            <h2 className="text-base font-semibold mb-2">
              History - {styleNo.toUpperCase()}
            </h2>

            {historyLoading && (
              <p className="text-[11px] text-slate-500 mb-2">Loading...</p>
            )}

            {historyError && (
              <p className="text-[11px] text-red-500 mb-2">{historyError}</p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-[1.4fr,1.6fr] gap-4 mt-1">
              <div className="border rounded-md max-h-64 overflow-auto">
                {historyItems.length === 0 && !historyLoading && !historyError && (
                  <p className="text-[11px] text-slate-400 px-3 py-2">
                    No history yet. 기존 버전을 저장하려면 스타일을 수정 후 저장하세요.
                  </p>
                )}
                {historyItems.map((item) => (
                  <button
                    key={item.versionNo}
                    type="button"
                    className={`w-full text-left px-3 py-2 border-b last:border-b-0 text-[11px] hover:bg-slate-50 ${
                      selectedHistory?.versionNo === item.versionNo
                        ? "bg-slate-100"
                        : ""
                    }`}
                    onClick={() => setSelectedHistory(item)}
                  >
                    <div className="font-semibold">Version {item.versionNo}</div>
                    <div className="text-slate-500">
                      {new Date(item.createdAt).toLocaleString()}
                    </div>
                    <div className="text-slate-400 mt-0.5">
                      {item.snapshot?.header?.product_type
                        ? item.snapshot.header.product_type
                        : "-"}
                      {item.snapshot?.header?.currency
                        ? ` | ${item.snapshot.header.currency}`
                        : ""}
                    </div>
                  </button>
                ))}
              </div>

              <div className="border rounded-md px-3 py-2 text-[11px] min-h-[120px]">
                {!selectedHistory && (
                  <p className="text-slate-400">
                    왼쪽에서 버전을 선택하면 요약 정보가 여기 표시됩니다.
                  </p>
                )}
                {selectedHistory && (
                  <>
                    <div className="mb-1">
                      <span className="font-semibold">
                        Version {selectedHistory.versionNo}
                      </span>
                      <span className="text-slate-500 ml-1">
                        ({new Date(selectedHistory.createdAt).toLocaleString()})
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      <div>
                        <span className="font-semibold">Product Name:</span>{" "}
                        {selectedHistory.snapshot?.header?.product_type || "-"}
                      </div>
                      <div>
                        <span className="font-semibold">Category:</span>{" "}
                        {selectedHistory.snapshot?.header?.product_category || "-"}
                      </div>
                      <div>
                        <span className="font-semibold">Dev Date:</span>{" "}
                        {selectedHistory.snapshot?.header?.dev_date || "-"}
                      </div>
                      <div>
                        <span className="font-semibold">Currency:</span>{" "}
                        {selectedHistory.snapshot?.header?.currency || "-"}
                      </div>
                      <div>
                        <span className="font-semibold">Developer:</span>{" "}
                        {selectedHistory.snapshot?.header?.developer || "-"}
                      </div>
                      <div>
                        <span className="font-semibold">
                          Materials / Operations:
                        </span>{" "}
                        {(selectedHistory.snapshot?.materials?.length ?? 0) > 0
                          ? `${selectedHistory.snapshot.materials.length} materials`
                          : "0 materials"}
                        {" | "}
                        {(selectedHistory.snapshot?.operations?.length ?? 0) > 0
                          ? `${selectedHistory.snapshot.operations.length} operations`
                          : "0 operations"}
                      </div>
                      <div className="mt-1">
                        <span className="font-semibold">Remarks:</span>{" "}
                        {selectedHistory.snapshot?.header?.remarks || "-"}
                      </div>
                    </div>

                    <div className="mt-3 flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-3 text-[11px]"
                        onClick={() => handleApplyHistoryVersion(selectedHistory)}
                      >
                        이 버전으로 불러오기
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setHistoryOpen(false)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
