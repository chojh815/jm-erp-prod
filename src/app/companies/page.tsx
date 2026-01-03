"use client";

import React, {
  useMemo,
  useState,
  useEffect,
  useRef,
} from "react";

import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectValue,
  SelectItem,
} from "@/components/ui/select";

export type CompanyType = "our_company" | "buyer" | "factory" | "supplier";
export type ShippingOriginCode =
  | "KR_SEOUL"
  | "CN_QINGDAO"
  | "CN_JIAOZHOU"
  | "VN_BACNINH";

const ORIGIN_LABEL: Record<ShippingOriginCode, string> = {
  KR_SEOUL: "Korea – Seoul (HQ)",
  CN_QINGDAO: "China – Qingdao",
  CN_JIAOZHOU: "China – Jiaozhou",
  VN_BACNINH: "Vietnam – Bac Ninh",
};

export interface CompanySite {
  id: string;
  siteName: string;
  originCode: ShippingOriginCode;
  country: string;
  city?: string;
  address1?: string;
  address2?: string;
  phone?: string;
  taxId?: string;
  bankName?: string;
  bankAccount?: string;
  accountHolderName?: string;
  swift?: string;
  currency?: string;
  exporterOfRecord?: boolean;
  originCountry?: string;
  isDefault?: boolean;
  // ★ 새 필드
  airPortLoading?: string;
  seaPortLoading?: string;
}

interface CompanyFormState {
  companyType: CompanyType;
  companyName: string;
  code?: string;
  country?: string;
  email?: string;
  phone?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zip?: string;
  taxId?: string;

  bankName?: string;
  bankAccount?: string;
  accountHolderName?: string;
  swift?: string;
  currency?: string;

  // Buyer
  buyerPaymentTerm?: string;
  buyerDefaultIncoterm?: string;
  buyerDefaultShipMode?: string;
  buyerBrands: string[]; // ★ 여러 개
  buyerDepts: string[]; // ★ 여러 개
  buyerConsignee?: string;
  buyerNotifyParty?: string;
  buyerFinalDestination?: string;
  apContactName?: string;
  apEmail?: string;
  apPhone?: string;

  // Factory
  originMark?: string;
  factoryAirPort?: string;
  factorySeaPort?: string;

  memo?: string;
  isActive: boolean;

  preferredOrigins: ShippingOriginCode[];

  // our_company only
  sites: CompanySite[];
}

interface DbCompanyListRow {
  id: string;
  code: string | null;
  name: string;
  company_type: string | null;
  country: string | null;
}

const defaultSite = (partial?: Partial<CompanySite>): CompanySite => ({
  id: crypto.randomUUID(),
  siteName: "",
  originCode: "KR_SEOUL",
  country: "Korea",
  city: "Seoul",
  exporterOfRecord: true,
  originCountry: "Korea",
  isDefault: true,
  currency: "USD",
  airPortLoading: "",
  seaPortLoading: "",
  ...partial,
});

const initialState: CompanyFormState = {
  companyType: "our_company",
  companyName: "",
  isActive: true,
  preferredOrigins: [],
  buyerPaymentTerm: "",
  buyerDefaultIncoterm: "FOB",
  buyerDefaultShipMode: "SEA",
  buyerBrands: [""], // ★ 기본 한 줄
  buyerDepts: [""], // ★ 기본 한 줄
  apContactName: "",
  apEmail: "",
  apPhone: "",
  buyerConsignee: "",
  buyerNotifyParty: "",
  buyerFinalDestination: "",
  originMark: "",
  factoryAirPort: "",
  factorySeaPort: "",
  sites: [
    defaultSite({
      siteName: "HQ",
      originCode: "KR_SEOUL",
      currency: "USD",
      airPortLoading: "ICN (Incheon International Airport)",
      seaPortLoading: "Busan Port",
    }),
    defaultSite({
      id: crypto.randomUUID(),
      siteName: "Qingdao",
      originCode: "CN_QINGDAO",
      country: "China",
      city: "Qingdao",
      originCountry: "China",
      isDefault: false,
      exporterOfRecord: true,
      currency: "CNY",
      airPortLoading: "TAO (Qingdao Jiaodong Int’l Airport)",
      seaPortLoading: "Port of Qingdao",
    }),
    defaultSite({
      id: crypto.randomUUID(),
      siteName: "Jiaozhou",
      originCode: "CN_JIAOZHOU",
      country: "China",
      city: "Jiaozhou",
      originCountry: "China",
      isDefault: false,
      exporterOfRecord: false,
      currency: "CNY",
      airPortLoading: "",
      seaPortLoading: "Port of Qingdao (via Jiaozhou)",
    }),
    defaultSite({
      id: crypto.randomUUID(),
      siteName: "Bac Ninh",
      originCode: "VN_BACNINH",
      country: "Vietnam",
      city: "Bac Ninh",
      originCountry: "Vietnam",
      isDefault: false,
      exporterOfRecord: true,
      currency: "VND",
      airPortLoading: "HAN (Noi Bai International Airport)",
      seaPortLoading: "Port of Hai Phong (HPH)",
    }),
  ],
};

export default function CompaniesPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [role, setRole] = useState<AppRole | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [searchKeyword, setSearchKeyword] = useState("");
  const [companies, setCompanies] = useState<DbCompanyListRow[]>([]);
  const [listLoading, setListLoading] = useState(false);

  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);

  const [form, setForm] = useState<CompanyFormState>(initialState);
  const [saveMsg, setSaveMsg] = useState<string>("");

  const codeInputRef = useRef<HTMLInputElement>(null);
  const [codeError, setCodeError] = useState<string>("");
  const [codeSuggestion, setCodeSuggestion] = useState<string>("");

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // ------- Auth & 초기 리스트 -------
  useEffect(() => {
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        window.location.href = "/login?redirectTo=/companies";
        return;
      }

      const meta = (session.user.user_metadata || {}) as any;
      const r: AppRole = meta.role || "viewer";
      setRole(r);
      setAuthLoading(false);

      if (r === "viewer") {
        alert("You do not have permission to manage companies.");
        window.location.href = "/";
        return;
      }

      await loadCompanyList("");
    };

    init();
  }, [supabase]);

  // ------- 리스트 로딩 / 검색 -------
  const loadCompanyList = async (keyword: string) => {
    setListLoading(true);
    try {
      let query = supabase
        .from("companies")
        .select("id, code, name, company_type, country")
        .order("name", { ascending: true });

      const trimmed = keyword.trim();
      if (trimmed) {
        const like = `%${trimmed}%`;
        query = query.or(
          `code.ilike.${like},name.ilike.${like},company_type.ilike.${like},country.ilike.${like}`
        );
      }

      const { data, error } = await query;

      if (error) {
        console.error("loadCompanyList error:", error);
        alert("Failed to load company list.");
        return;
      }

      setCompanies((data as DbCompanyListRow[]) || []);
    } finally {
      setListLoading(false);
    }
  };

  const handleSearch = async () => {
    await loadCompanyList(searchKeyword);
  };

  const handleClearSearch = async () => {
    setSearchKeyword("");
    await loadCompanyList("");
  };

  // ------- 폼 유틸 -------
  const handleChange = (key: keyof CompanyFormState, value: any) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const togglePreferredOrigin = (oc: ShippingOriginCode) => {
    setForm((prev) => {
      const exists = prev.preferredOrigins.includes(oc);
      return {
        ...prev,
        preferredOrigins: exists
          ? prev.preferredOrigins.filter((x) => x !== oc)
          : [...prev.preferredOrigins, oc],
      };
    });
  };

  const upsertSite = (id: string, patch: Partial<CompanySite>) => {
    setForm((prev) => ({
      ...prev,
      sites: prev.sites.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  };

  const addSite = () =>
    setForm((prev) => ({
      ...prev,
      sites: [
        ...prev.sites,
        defaultSite({
          siteName: "New Site",
          isDefault: false,
          exporterOfRecord: false,
        }),
      ],
    }));

  const removeSite = (id: string) =>
    setForm((prev) => ({
      ...prev,
      sites: prev.sites.filter((s) => s.id !== id),
    }));

  const setDefaultSite = (id: string) =>
    setForm((prev) => ({
      ...prev,
      sites: prev.sites.map((s) => ({
        ...s,
        isDefault: s.id === id,
      })),
    }));

  const onNew = () => {
    setForm(initialState);
    setEditingCompanyId(null);
    setCodeError("");
    setCodeSuggestion("");
    setSaveMsg("");
  };

  // ------- Buyer Brand / Dept 유틸 -------
  const updateBuyerBrand = (index: number, value: string) => {
    setForm((prev) => {
      const arr = [...prev.buyerBrands];
      arr[index] = value;
      return { ...prev, buyerBrands: arr };
    });
  };

  const addBuyerBrand = () => {
    setForm((prev) => ({
      ...prev,
      buyerBrands: [...prev.buyerBrands, ""],
    }));
  };

  const removeBuyerBrand = (index: number) => {
    setForm((prev) => {
      const arr = prev.buyerBrands.filter((_, i) => i !== index);
      return { ...prev, buyerBrands: arr.length ? arr : [""] };
    });
  };

  const updateBuyerDept = (index: number, value: string) => {
    setForm((prev) => {
      const arr = [...prev.buyerDepts];
      arr[index] = value;
      return { ...prev, buyerDepts: arr };
    });
  };

  const addBuyerDept = () => {
    setForm((prev) => ({
      ...prev,
      buyerDepts: [...prev.buyerDepts, ""],
    }));
  };

  const removeBuyerDept = (index: number) => {
    setForm((prev) => {
      const arr = prev.buyerDepts.filter((_, i) => i !== index);
      return { ...prev, buyerDepts: arr.length ? arr : [""] };
    });
  };

  // ------- 회사 상세 로딩 -------
  const loadCompanyDetail = async (companyId: string) => {
    try {
      const { data, error } = await supabase
        .from("companies")
        .select("*")
        .eq("id", companyId)
        .maybeSingle();

      if (error) {
        console.error("loadCompanyDetail error:", error);
        alert("Failed to load company details.");
        return;
      }
      if (!data) return;

      // sites
      let sites: CompanySite[] = initialState.sites;
      if (data.company_type === "our_company") {
        const { data: siteRows, error: siteErr } = await supabase
          .from("company_sites")
          .select(
            "id, site_name, origin_code, country, city, address1, address2, phone, tax_id, bank_name, bank_account, account_holder_name, swift, currency, exporter_of_record, origin_country, is_default, air_port_loading, sea_port_loading"
          )
          .eq("company_id", companyId)
          .order("id", { ascending: true });

        if (siteErr) {
          console.error("loadCompanyDetail sites error:", siteErr);
        } else if (siteRows && siteRows.length > 0) {
          sites = siteRows.map((s: any) => ({
            id: String(s.id ?? crypto.randomUUID()),
            siteName: s.site_name ?? "",
            originCode: (s.origin_code || "KR_SEOUL") as ShippingOriginCode,
            country: s.country ?? "",
            city: s.city ?? "",
            address1: s.address1 ?? "",
            address2: s.address2 ?? "",
            phone: s.phone ?? "",
            taxId: s.tax_id ?? "",
            bankName: s.bank_name ?? "",
            bankAccount: s.bank_account ?? "",
            accountHolderName: s.account_holder_name ?? "",
            swift: s.swift ?? "",
            currency: s.currency ?? "",
            exporterOfRecord: !!s.exporter_of_record,
            originCountry: s.origin_country ?? "",
            isDefault: !!s.is_default,
            airPortLoading: s.air_port_loading ?? "",
            seaPortLoading: s.sea_port_loading ?? "",
          }));
        }
      }

      // buyerBrands / buyerDepts 문자열 → 배열
      const brandStr: string = data.buyer_brand || "";
      const deptStr: string = data.buyer_dept || "";
      const buyerBrands =
        brandStr
          .split(",")
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 0) || [];
      const buyerDepts =
        deptStr
          .split(",")
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 0) || [];

      setForm({
        companyType: (data.company_type || "our_company") as CompanyType,
        companyName: data.company_name || data.name || "",
        code: data.code || "",
        country: data.country || "",
        email: data.email || "",
        phone: data.phone || "",
        address1: data.address1 || "",
        address2: data.address2 || "",
        city: data.city || "",
        state: data.state || "",
        zip: data.zip || "",
        taxId: data.tax_id || "",
        bankName: data.bank_name || "",
        bankAccount: data.bank_account || "",
        accountHolderName: data.account_holder_name || "",
        swift: data.swift || "",
        currency: data.currency || "",
        buyerPaymentTerm: data.buyer_payment_term || "",
        buyerDefaultIncoterm: data.buyer_default_incoterm || "FOB",
        buyerDefaultShipMode: data.buyer_default_ship_mode || "SEA",
        buyerBrands: buyerBrands.length ? buyerBrands : [""],
        buyerDepts: buyerDepts.length ? buyerDepts : [""],
        apContactName: data.ap_contact_name || "",
        apEmail: data.ap_email || "",
        apPhone: data.ap_phone || "",
        buyerConsignee: data.buyer_consignee || "",
        buyerNotifyParty: data.buyer_notify_party || "",
        buyerFinalDestination: data.buyer_final_destination || "",
        originMark: data.origin_mark || "",
        factoryAirPort: data.factory_air_port || "",
        factorySeaPort: data.factory_sea_port || "",
        memo: data.memo || "",
        isActive: typeof data.is_active === "boolean" ? data.is_active : true,
        preferredOrigins:
          (data.preferred_origins as ShippingOriginCode[]) || [],
        sites,
      });

      setEditingCompanyId(companyId);
      setCodeError("");
      setCodeSuggestion("");
      setSaveMsg("");
    } catch (err) {
      console.error("loadCompanyDetail unexpected error:", err);
    }
  };

  // ------- 코드 관련 UX -------
  const title = useMemo(() => {
    switch (form.companyType) {
      case "our_company":
        return "🏢 Our Company – Registration (with Shipping Sites)";
      case "buyer":
        return "🛍️ Buyer Registration";
      case "factory":
        return "🏭 Factory Registration";
      case "supplier":
        return "📦 Supplier Registration";
      default:
        return "Company Registration";
    }
  }, [form.companyType]);

  function suggestUniqueCode(base?: string | null) {
    const raw = (base || "").trim();
    if (!raw) return "";
    const m = raw.match(/^(.*?)-(\d+)$/);
    if (m) {
      const head = m[1];
      const n = parseInt(m[2] || "0", 10) + 1;
      return `${head}-${n}`;
    }
    return `${raw}-1`;
  }

  const checkCodeUniqueness = async (code: string) => {
    setCodeError("");
    setCodeSuggestion("");
    const trimmed = (code || "").trim();
    if (!trimmed) return;

    try {
      const r = await fetch(
        `/api/companies/check-code?code=${encodeURIComponent(trimmed)}`,
        {
          method: "GET",
        }
      );
      const j = await r.json();
      if (j?.ok && j.available === false && j.existing) {
        setCodeError(
          `This code is already used by "${j.existing.company_name}". Please choose a different code.`
        );
        setCodeSuggestion(suggestUniqueCode(trimmed));
      }
    } catch (e) {
      console.warn("code check failed:", e);
    }
  };

  // ------- 저장 (/api/companies 사용) -------
  const onSave = async () => {
    setSaveMsg("");
    setCodeError("");
    setCodeSuggestion("");

    if (!form.companyName?.trim()) {
      alert("Company name is required.");
      return;
    }

    setIsSaving(true);
    try {
      const rawSites = Array.isArray(form.sites) ? form.sites : [];
      const sitesForSave =
        form.companyType === "our_company"
          ? rawSites
              .filter((s) => (s.siteName || "").trim().length > 0)
              .map((s) => ({
                siteName: s.siteName.trim(),
                originCode: s.originCode,
                country: s.country,
                city: s.city || null,
                address1: s.address1 || null,
                address2: s.address2 || null,
                phone: s.phone || null,
                taxId: s.taxId || null,
                bankName: s.bankName || null,
                bankAccount: s.bankAccount || null,
                accountHolderName: s.accountHolderName || null,
                swift: s.swift || null,
                currency: s.currency || null,
                exporterOfRecord: !!s.exporterOfRecord,
                originCountry: s.originCountry || null,
                isDefault: !!s.isDefault,
                airPortLoading: s.airPortLoading || null,
                seaPortLoading: s.seaPortLoading || null,
              }))
          : [];

      // 배열 → 문자열 (콤마 구분)
      const buyerBrandStr = (form.buyerBrands || [])
        .map((b) => b.trim())
        .filter((b) => b.length > 0)
        .join(", ");
      const buyerDeptStr = (form.buyerDepts || [])
        .map((d) => d.trim())
        .filter((d) => d.length > 0)
        .join(", ");

      const payload = {
        companyId: editingCompanyId,
        companyType: form.companyType,
        companyName: form.companyName,
        code: form.code || null,
        country: form.country || null,
        email: form.email || null,
        phone: form.phone || null,
        address1: form.address1 || null,
        address2: form.address2 || null,
        city: form.city || null,
        state: form.state || null,
        zip: form.zip || null,
        taxId: form.taxId || null,

        bankName: form.bankName || null,
        bankAccount: form.bankAccount || null,
        accountHolderName: form.accountHolderName || null,
        swift: form.swift || null,
        currency: form.currency || null,

        buyerPaymentTerm: form.buyerPaymentTerm || null,
        buyerDefaultIncoterm: form.buyerDefaultIncoterm || null,
        buyerDefaultShipMode: form.buyerDefaultShipMode || null,
        buyerBrand: buyerBrandStr || null, // ★ 배열 저장
        buyerDept: buyerDeptStr || null, // ★ 배열 저장
        apContactName: form.apContactName || null,
        apEmail: form.apEmail || null,
        apPhone: form.apPhone || null,

        buyerConsignee: form.buyerConsignee || null,
        buyerNotifyParty: form.buyerNotifyParty || null,
        buyerFinalDestination: form.buyerFinalDestination || null,

        originMark: form.originMark || null,
        factoryAirPort: form.factoryAirPort || null,
        factorySeaPort: form.factorySeaPort || null,

        isActive: form.isActive,
        preferredOrigins: form.preferredOrigins || [],
        memo: form.memo || null,

        sites: sitesForSave,
      };

      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();

      if (!res.ok) {
        if (res.status === 409 && json?.field === "code") {
          const ex = json.existing;
          setCodeError(
            `This code is already used by "${ex?.company_name}". Please choose a different code.`
          );
          setCodeSuggestion(suggestUniqueCode(form.code));
          requestAnimationFrame(() => {
            codeInputRef.current?.focus();
            codeInputRef.current?.select();
          });
        } else {
          alert(json?.message || "Failed to save.");
        }
        return;
      }

      setSaveMsg("Saved successfully.");
      alert("Saved successfully.");

      await loadCompanyList(searchKeyword || "");
    } catch (err: any) {
      console.error(err);
      alert(err?.message || "Unexpected error");
    } finally {
      setIsSaving(false);
    }
  };

  // ------- 삭제 -------
  const onDelete = async () => {
    if (!editingCompanyId) {
      alert("Select a company from the list to delete.");
      return;
    }

    if (
      !window.confirm(
        "Delete this company and related sites? This cannot be undone."
      )
    ) {
      return;
    }

    try {
      setIsDeleting(true);

      await supabase
        .from("company_sites")
        .delete()
        .eq("company_id", editingCompanyId);

      const { error } = await supabase
        .from("companies")
        .delete()
        .eq("id", editingCompanyId);

      if (error) {
        console.error("delete company error:", error);
        alert("Failed to delete company.");
        return;
      }

      alert("Company deleted.");
      onNew();
      await loadCompanyList(searchKeyword || "");
    } catch (err) {
      console.error("delete company unexpected error:", err);
      alert("Unexpected error while deleting.");
    } finally {
      setIsDeleting(false);
    }
  };

  // ------- 베트남 자동값 제안 -------
  useEffect(() => {
    const isVN =
      (form.country || "").toLowerCase().includes("vietnam") ||
      (form.country || "").toLowerCase().includes("viet nam");
    if (form.companyType === "factory" && isVN) {
      if (!form.originMark)
        setForm((p) => ({
          ...p,
          originMark: "Made in Vietnam",
        }));
      if (!form.factoryAirPort)
        setForm((p) => ({
          ...p,
          factoryAirPort: "Noi Bai International Airport (HAN)",
        }));
      if (!form.factorySeaPort)
        setForm((p) => ({
          ...p,
          factorySeaPort: "Port of Hai Phong (HPH)",
        }));
    }
  }, [form.companyType, form.country]);

  if (authLoading || !role) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-sm text-slate-500">Loading...</div>
      </div>
    );
  }

  return (
    <AppShell
      role={role}
      title="Companies"
      description="Register and manage buyers, factories, suppliers, and JM internal entities."
    >
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 좌측: 검색 + 리스트 */}
          <Card className="shadow-sm md:col-span-1">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Company Search</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="company-search">Keyword</Label>
                <Input
                  id="company-search"
                  placeholder="Search by code, name, type, country..."
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSearch();
                  }}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClearSearch}
                  disabled={listLoading}
                  className="flex-1"
                >
                  Clear
                </Button>
                <Button
                  type="button"
                  onClick={handleSearch}
                  disabled={listLoading}
                  className="flex-1"
                >
                  {listLoading ? "Searching..." : "Search"}
                </Button>
              </div>

              <Separator className="my-2" />

              <div className="text-xs text-slate-500 mb-1 flex justify-between">
                <span>Company List</span>
                <span>Total: {companies.length}</span>
              </div>

              <div className="border rounded-md max-h-[430px] overflow-auto text-xs">
                <table className="w-full">
                  <thead className="bg-slate-50 sticky top-0 z-10">
                    <tr className="text-left">
                      <th className="px-2 py-1 w-20">Code</th>
                      <th className="px-2 py-1">Name</th>
                      <th className="px-2 py-1 w-20">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companies.length === 0 && !listLoading && (
                      <tr>
                        <td
                          colSpan={3}
                          className="px-3 py-4 text-center text-slate-400"
                        >
                          No companies.
                        </td>
                      </tr>
                    )}
                    {companies.map((c) => (
                      <tr
                        key={c.id}
                        className={`cursor-pointer border-b hover:bg-slate-50 ${
                          editingCompanyId === c.id ? "bg-sky-50" : ""
                        }`}
                        onClick={() => loadCompanyDetail(c.id)}
                      >
                        <td className="px-2 py-1 font-medium">
                          {c.code || "-"}
                        </td>
                        <td className="px-2 py-1">{c.name}</td>
                        <td className="px-2 py-1">
                          {c.company_type || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {listLoading && (
                  <div className="py-3 text-center text-slate-400">
                    Searching...
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* 우측: 메인 폼 */}
          <div className="md:col-span-2">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-2xl">
                  {editingCompanyId ? `${title} (Edit)` : title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* 상단 3컬럼: Type / Name / Code */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label>Company Type</Label>
                    <Select
                      value={form.companyType}
                      onValueChange={(v: CompanyType) =>
                        handleChange("companyType", v)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent className="z-50">
                        <SelectItem value="our_company">
                          Our Company (JM-I)
                        </SelectItem>
                        <SelectItem value="buyer">Buyer</SelectItem>
                        <SelectItem value="factory">Factory</SelectItem>
                        <SelectItem value="supplier">Supplier</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Company Name</Label>
                    <Input
                      value={form.companyName}
                      onChange={(e) =>
                        handleChange("companyName", e.target.value)
                      }
                      placeholder="e.g., JM International"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Code</Label>
                    <Input
                      ref={codeInputRef}
                      value={form.code ?? ""}
                      onChange={(e) => {
                        setCodeError("");
                        setCodeSuggestion("");
                        handleChange("code", e.target.value);
                      }}
                      onBlur={(e) => checkCodeUniqueness(e.target.value)}
                      placeholder="Internal short code (unique)"
                      aria-invalid={!!codeError}
                      className={
                        codeError
                          ? "border-destructive focus-visible:ring-destructive"
                          : ""
                      }
                    />
                    {codeError && (
                      <div className="text-sm text-destructive">
                        {codeError}
                        {codeSuggestion && (
                          <button
                            type="button"
                            onClick={() => {
                              const next = codeSuggestion;
                              handleChange("code", next);
                              setCodeError("");
                              setCodeSuggestion("");
                              requestAnimationFrame(() => {
                                codeInputRef.current?.focus();
                                codeInputRef.current?.select();
                              });
                              checkCodeUniqueness(next);
                            }}
                            className="ml-2 underline"
                            title="Apply suggested unique code"
                          >
                            Use suggestion: <strong>{codeSuggestion}</strong>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <Separator className="my-6" />

                {/* 기본 정보 3컬럼 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-3">
                    <Label>Country</Label>
                    <Input
                      value={form.country ?? ""}
                      onChange={(e) =>
                        handleChange("country", e.target.value)
                      }
                      placeholder="Country"
                    />

                    <Label>City</Label>
                    <Input
                      value={form.city ?? ""}
                      onChange={(e) => handleChange("city", e.target.value)}
                      placeholder="City"
                    />

                    <Label>Address 1</Label>
                    <Input
                      value={form.address1 ?? ""}
                      onChange={(e) =>
                        handleChange("address1", e.target.value)
                      }
                      placeholder="Street, district"
                    />

                    <Label>Address 2</Label>
                    <Input
                      value={form.address2 ?? ""}
                      onChange={(e) =>
                        handleChange("address2", e.target.value)
                      }
                      placeholder="Suite, building"
                    />
                  </div>

                  <div className="space-y-3">
                    <Label>Phone</Label>
                    <Input
                      value={form.phone ?? ""}
                      onChange={(e) => handleChange("phone", e.target.value)}
                      placeholder="+82-..."
                    />

                    <Label>Email</Label>
                    <Input
                      value={form.email ?? ""}
                      onChange={(e) => handleChange("email", e.target.value)}
                      placeholder="info@jm-i.com"
                    />

                    <Label>Tax ID</Label>
                    <Input
                      value={form.taxId ?? ""}
                      onChange={(e) => handleChange("taxId", e.target.value)}
                      placeholder="Business reg / VAT"
                    />

                    <div className="flex items-center justify-between py-2">
                      <div className="space-y-1">
                        <Label>Active</Label>
                        <p className="text-xs text-muted-foreground">
                          Enable/disable this company
                        </p>
                      </div>
                      <Switch
                        checked={form.isActive}
                        onCheckedChange={(v) => handleChange("isActive", v)}
                      />
                    </div>
                  </div>

                  {/* 오른쪽: Non-buyer = Bank, Buyer = Terms + Consignee/Notify/Dest */}
                  {form.companyType !== "buyer" ? (
                    <div className="space-y-3">
                      <Label>Bank Name</Label>
                      <Input
                        value={form.bankName ?? ""}
                        onChange={(e) =>
                          handleChange("bankName", e.target.value)
                        }
                        placeholder="Bank"
                      />

                      <Label>Bank Account</Label>
                      <Input
                        value={form.bankAccount ?? ""}
                        onChange={(e) =>
                          handleChange("bankAccount", e.target.value)
                        }
                        placeholder="123-456-..."
                      />

                      <Label>Account Holder Name</Label>
                      <Input
                        value={form.accountHolderName ?? ""}
                        onChange={(e) =>
                          handleChange("accountHolderName", e.target.value)
                        }
                        placeholder="e.g., JM International Co., Ltd."
                      />

                      <Label>SWIFT</Label>
                      <Input
                        value={form.swift ?? ""}
                        onChange={(e) =>
                          handleChange("swift", e.target.value)
                        }
                        placeholder="HNBNKRSE"
                      />

                      <Label>Currency</Label>
                      <Input
                        value={form.currency ?? ""}
                        onChange={(e) =>
                          handleChange("currency", e.target.value)
                        }
                        placeholder="USD / KRW / CNY / VND"
                      />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <Label>Payment Term (Buyer)</Label>
                      <Input
                        value={form.buyerPaymentTerm ?? ""}
                        onChange={(e) =>
                          handleChange("buyerPaymentTerm", e.target.value)
                        }
                        placeholder="e.g., Net 30 / TT 30%/70%"
                      />

                      <Label>Default Incoterm</Label>
                      <Select
                        value={form.buyerDefaultIncoterm ?? "FOB"}
                        onValueChange={(v) =>
                          handleChange("buyerDefaultIncoterm", v)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="z-50">
                          <SelectItem value="FOB">FOB</SelectItem>
                          <SelectItem value="FCA">FCA</SelectItem>
                          <SelectItem value="EXW">EXW</SelectItem>
                          <SelectItem value="CIF">CIF</SelectItem>
                        </SelectContent>
                      </Select>

                      <Label>Default Ship Mode</Label>
                      <Select
                        value={form.buyerDefaultShipMode ?? "SEA"}
                        onValueChange={(v) =>
                          handleChange("buyerDefaultShipMode", v)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="z-50">
                          <SelectItem value="SEA">SEA</SelectItem>
                          <SelectItem value="AIR">AIR</SelectItem>
                          <SelectItem value="COURIER">COURIER</SelectItem>
                        </SelectContent>
                      </Select>

                      {/* Buyer Brands 여러 개 */}
                      <div className="space-y-1">
                        <Label>Buyer Brands</Label>
                        <div className="border rounded-md max-h-32 overflow-auto">
                          {form.buyerBrands.map((b, idx) => (
                            <div
                              key={idx}
                              className="flex items-center gap-2 px-2 py-1 border-b last:border-0"
                            >
                              <Input
                                className="h-8"
                                value={b}
                                onChange={(e) =>
                                  updateBuyerBrand(idx, e.target.value)
                                }
                                placeholder="e.g., RED BEAUTY / Lucky Brand"
                              />
                              <Button
                                size="icon"
                                variant="ghost"
                                type="button"
                                className="h-7 w-7 text-xs"
                                onClick={() => removeBuyerBrand(idx)}
                              >
                                ✕
                              </Button>
                            </div>
                          ))}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          type="button"
                          onClick={addBuyerBrand}
                          className="mt-1"
                        >
                          + Add Brand
                        </Button>
                      </div>

                      {/* Buyer Depts 여러 개 */}
                      <div className="space-y-1">
                        <Label>Buyer Departments</Label>
                        <div className="border rounded-md max-h-32 overflow-auto">
                          {form.buyerDepts.map((d, idx) => (
                            <div
                              key={idx}
                              className="flex items-center gap-2 px-2 py-1 border-b last:border-0"
                            >
                              <Input
                                className="h-8"
                                value={d}
                                onChange={(e) =>
                                  updateBuyerDept(idx, e.target.value)
                                }
                                placeholder="e.g., Beauty / Accessories"
                              />
                              <Button
                                size="icon"
                                variant="ghost"
                                type="button"
                                className="h-7 w-7 text-xs"
                                onClick={() => removeBuyerDept(idx)}
                              >
                                ✕
                              </Button>
                            </div>
                          ))}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          type="button"
                          onClick={addBuyerDept}
                          className="mt-1"
                        >
                          + Add Dept
                        </Button>
                      </div>

                      <Label>AP Contact Name</Label>
                      <Input
                        value={form.apContactName ?? ""}
                        onChange={(e) =>
                          handleChange("apContactName", e.target.value)
                        }
                        placeholder="e.g., Jane Doe"
                      />

                      <Label>AP Email</Label>
                      <Input
                        value={form.apEmail ?? ""}
                        onChange={(e) =>
                          handleChange("apEmail", e.target.value)
                        }
                        placeholder="ap@buyer.com"
                      />

                      <Label>AP Phone</Label>
                      <Input
                        value={form.apPhone ?? ""}
                        onChange={(e) =>
                          handleChange("apPhone", e.target.value)
                        }
                        placeholder="+1-..."
                      />
                    </div>
                  )}
                </div>

                <Separator className="my-6" />

                {/* 중간 섹션 */}
                {form.companyType === "our_company" ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-lg">
                        Shipping Sites (Exporter/Origin per site)
                      </h3>
                      <Button variant="secondary" onClick={addSite}>
                        Add Site
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                      {form.sites.map((s) => (
                        <Card key={s.id} className="border">
                          <CardContent className="pt-6">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              <div className="space-y-2">
                                <Label>Site Name</Label>
                                <Input
                                  value={s.siteName}
                                  onChange={(e) =>
                                    upsertSite(s.id, {
                                      siteName: e.target.value,
                                    })
                                  }
                                  placeholder="e.g., HQ / Qingdao / Bac Ninh"
                                />

                                <Label>Origin Code</Label>
                                <Select
                                  value={s.originCode}
                                  onValueChange={(v: ShippingOriginCode) =>
                                    upsertSite(s.id, {
                                      originCode: v,
                                    })
                                  }
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent className="z-50">
                                    <SelectItem value="KR_SEOUL">
                                      Korea – Seoul (HQ)
                                    </SelectItem>
                                    <SelectItem value="CN_QINGDAO">
                                      China – Qingdao
                                    </SelectItem>
                                    <SelectItem value="CN_JIAOZHOU">
                                      China – Jiaozhou
                                    </SelectItem>
                                    <SelectItem value="VN_BACNINH">
                                      Vietnam – Bac Ninh
                                    </SelectItem>
                                  </SelectContent>
                                </Select>

                                <div className="flex items-center gap-2 pt-2">
                                  <Switch
                                    checked={!!s.isDefault}
                                    onCheckedChange={() =>
                                      setDefaultSite(s.id)
                                    }
                                  />
                                  <span className="text-sm">
                                    Default shipping site
                                  </span>
                                </div>
                              </div>

                              <div className="space-y-2">
                                <Label>Country</Label>
                                <Input
                                  value={s.country}
                                  onChange={(e) =>
                                    upsertSite(s.id, {
                                      country: e.target.value,
                                    })
                                  }
                                />
                                <Label>City</Label>
                                <Input
                                  value={s.city ?? ""}
                                  onChange={(e) =>
                                    upsertSite(s.id, {
                                      city: e.target.value,
                                    })
                                  }
                                />
                                <Label>Address 1</Label>
                                <Input
                                  value={s.address1 ?? ""}
                                  onChange={(e) =>
                                    upsertSite(s.id, {
                                      address1: e.target.value,
                                    })
                                  }
                                />
                                <Label>Address 2</Label>
                                <Input
                                  value={s.address2 ?? ""}
                                  onChange={(e) =>
                                    upsertSite(s.id, {
                                      address2: e.target.value,
                                    })
                                  }
                                />
                              </div>

                              <div className="space-y-2">
                                <Label>Phone</Label>
                                <Input
                                  value={s.phone ?? ""}
                                  onChange={(e) =>
                                    upsertSite(s.id, {
                                      phone: e.target.value,
                                    })
                                  }
                                />
                                <Label>Tax ID</Label>
                                <Input
                                  value={s.taxId ?? ""}
                                  onChange={(e) =>
                                    upsertSite(s.id, {
                                      taxId: e.target.value,
                                    })
                                  }
                                />

                                <div className="flex items-center gap-2 pt-2">
                                  <Switch
                                    checked={!!s.exporterOfRecord}
                                    onCheckedChange={(v) =>
                                      upsertSite(s.id, {
                                        exporterOfRecord: v,
                                      })
                                    }
                                  />
                                </div>
                                <Label>Origin Country (FTA)</Label>
                                <Input
                                  value={s.originCountry ?? ""}
                                  onChange={(e) =>
                                    upsertSite(s.id, {
                                      originCountry: e.target.value,
                                    })
                                  }
                                  placeholder="Korea / Vietnam / China"
                                />
                              </div>
                            </div>

                            <Separator className="my-4" />

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              <div className="space-y-2">
                                <Label>Air Port of Loading</Label>
                                <Input
                                  value={s.airPortLoading ?? ""}
                                  onChange={(e) =>
                                    upsertSite(s.id, {
                                      airPortLoading: e.target.value,
                                    })
                                  }
                                  placeholder="e.g., ICN, TAO, HAN"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>Sea Port of Loading</Label>
                                <Input
                                  value={s.seaPortLoading ?? ""}
                                  onChange={(e) =>
                                    upsertSite(s.id, {
                                      seaPortLoading: e.target.value,
                                    })
                                  }
                                  placeholder="e.g., Busan, Qingdao, Hai Phong"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>Bank Name</Label>
                                <Input
                                  value={s.bankName ?? ""}
                                  onChange={(e) =>
                                    upsertSite(s.id, {
                                      bankName: e.target.value,
                                    })
                                  }
                                />
                                <Label>Bank Account</Label>
                                <Input
                                  value={s.bankAccount ?? ""}
                                  onChange={(e) =>
                                    upsertSite(s.id, {
                                      bankAccount: e.target.value,
                                    })
                                  }
                                />
                                <Label>Account Holder</Label>
                                <Input
                                  value={s.accountHolderName ?? ""}
                                  onChange={(e) =>
                                    upsertSite(s.id, {
                                      accountHolderName: e.target.value,
                                    })
                                  }
                                />
                                <Label>SWIFT</Label>
                                <Input
                                  value={s.swift ?? ""}
                                  onChange={(e) =>
                                    upsertSite(s.id, {
                                      swift: e.target.value,
                                    })
                                  }
                                />
                                <Label>Currency</Label>
                                <Input
                                  value={s.currency ?? ""}
                                  onChange={(e) =>
                                    upsertSite(s.id, {
                                      currency: e.target.value,
                                    })
                                  }
                                  placeholder="USD / KRW / CNY / VND"
                                />
                              </div>
                            </div>

                            <div className="flex justify-end gap-2 pt-4">
                              <Button
                                variant="destructive"
                                onClick={() => removeSite(s.id)}
                              >
                                Remove
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                ) : form.companyType === "factory" ? (
                  <div className="space-y-3">
                    <h3 className="font-semibold text-lg">
                      Factory Shipping Details
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Air/Sea 출발지와 원산지 표기를 관리합니다. (베트남일 경우 자동 제안)
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="space-y-2">
                        <Label>Origin Mark</Label>
                        <Select
                          value={form.originMark ?? ""}
                          onValueChange={(v) => handleChange("originMark", v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select origin mark" />
                          </SelectTrigger>
                          <SelectContent className="z-50">
                            <SelectItem value="Made in Korea">
                              Made in Korea
                            </SelectItem>
                            <SelectItem value="Made in China">
                              Made in China
                            </SelectItem>
                            <SelectItem value="Made in Vietnam">
                              Made in Vietnam
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Air Port (출발 공항)</Label>
                        <Input
                          value={form.factoryAirPort ?? ""}
                          onChange={(e) =>
                            handleChange("factoryAirPort", e.target.value)
                          }
                          placeholder="e.g., Noi Bai International Airport (HAN)"
                        />
                        <p className="text-xs text-muted-foreground">
                          베트남 공장인 경우 기본: HAN (Noi Bai)
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label>Sea Port (출발 항만)</Label>
                        <Input
                          value={form.factorySeaPort ?? ""}
                          onChange={(e) =>
                            handleChange("factorySeaPort", e.target.value)
                          }
                          placeholder="e.g., Port of Hai Phong (HPH)"
                        />
                        <p className="text-xs text-muted-foreground">
                          베트남 공장인 경우 기본: HPH (Hai Phong)
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <h3 className="font-semibold text-lg">
                      Preferred Shipping Origin(s)
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Select acceptable origins.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                      {(Object.keys(ORIGIN_LABEL) as ShippingOriginCode[]).map(
                        (oc) => (
                          <label
                            key={oc}
                            className="flex items-center gap-2 border rounded-xl px-3 py-2 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={form.preferredOrigins.includes(oc)}
                              onChange={() => togglePreferredOrigin(oc)}
                            />
                            <span className="text-sm">{ORIGIN_LABEL[oc]}</span>
                          </label>
                        )
                      )}
                    </div>
                  </div>
                )}

                <Separator className="my-6" />

                {/* Buyer 전용 Consignee/Notify/Final Destination */}
                {form.companyType === "buyer" && (
                  <div className="space-y-3 mb-6">
                    <h3 className="font-semibold text-lg">
                      Consignee / Notify Party / Final Destination
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>Consignee</Label>
                        <Textarea
                          value={form.buyerConsignee ?? ""}
                          onChange={(e) =>
                            handleChange("buyerConsignee", e.target.value)
                          }
                          placeholder="Consignee name and address"
                          className="h-24"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Notify Party</Label>
                        <Textarea
                          value={form.buyerNotifyParty ?? ""}
                          onChange={(e) =>
                            handleChange("buyerNotifyParty", e.target.value)
                          }
                          placeholder="Notify party name and address"
                          className="h-24"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Final Destination</Label>
                        <Textarea
                          value={form.buyerFinalDestination ?? ""}
                          onChange={(e) =>
                            handleChange(
                              "buyerFinalDestination",
                              e.target.value
                            )
                          }
                          placeholder="e.g., Los Angeles, CA / New York, NY"
                          className="h-24"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Memo + 버튼 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="md:col-span-2">
                    <Label>Memo</Label>
                    <Textarea
                      value={form.memo ?? ""}
                      onChange={(e) => handleChange("memo", e.target.value)}
                      placeholder="Notes, internal remarks..."
                      className="h-24"
                    />
                  </div>
                  <div className="flex items-end justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={onNew}
                      disabled={isSaving}
                    >
                      New
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={onDelete}
                      disabled={!editingCompanyId || isDeleting}
                    >
                      {isDeleting ? "Deleting..." : "Delete"}
                    </Button>
                    <Button onClick={onSave} disabled={isSaving}>
                      {isSaving ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </div>

                {saveMsg && (
                  <div className="mt-3 text-sm text-green-600">{saveMsg}</div>
                )}

                {/* 하단 요약 */}
                <div className="mt-6 rounded-xl bg-muted/40 p-4 text-sm">
                  <div className="font-medium mb-2">Summary</div>
                  {form.companyType === "our_company" ? (
                    <ul className="list-disc pl-5 space-y-1">
                      <li>
                        <span className="font-medium">Default Site:</span>{" "}
                        {form.sites.find((s) => s.isDefault)?.siteName || "—"}
                      </li>
                      <li>
                        <span className="font-medium">Sites Count:</span>{" "}
                        {form.sites.length}
                      </li>
                      <li>
                        <span className="font-medium">EOR Sites:</span>{" "}
                        {form.sites.filter((s) => s.exporterOfRecord).length}
                      </li>
                    </ul>
                  ) : form.companyType === "factory" ? (
                    <ul className="list-disc pl-5 space-y-1">
                      <li>
                        <span className="font-medium">Origin Mark:</span>{" "}
                        {form.originMark || "—"}
                      </li>
                      <li>
                        <span className="font-medium">Air Port:</span>{" "}
                        {form.factoryAirPort || "—"}
                      </li>
                      <li>
                        <span className="font-medium">Sea Port:</span>{" "}
                        {form.factorySeaPort || "—"}
                      </li>
                    </ul>
                  ) : (
                    <ul className="list-disc pl-5 space-y-1">
                      <li>
                        <span className="font-medium">Preferred Origins:</span>{" "}
                        {form.preferredOrigins.length
                          ? form.preferredOrigins
                              .map((o) => ORIGIN_LABEL[o])
                              .join(", ")
                          : "—"}
                      </li>
                      {form.companyType === "buyer" && (
                        <>
                          <li>
                            <span className="font-medium">
                              Default Incoterm:
                            </span>{" "}
                            {form.buyerDefaultIncoterm || "—"}
                          </li>
                          <li>
                            <span className="font-medium">
                              Default Ship Mode:
                            </span>{" "}
                            {form.buyerDefaultShipMode || "—"}
                          </li>
                          <li>
                            <span className="font-medium">
                              Brands / Depts:
                            </span>{" "}
                            {[
                              ...form.buyerBrands
                                .map((b) => b.trim())
                                .filter((b) => b),
                              ...form.buyerDepts
                                .map((d) => d.trim())
                                .filter((d) => d),
                            ].join(", ") || "—"}
                          </li>
                          <li>
                            <span className="font-medium">
                              Final Destination:
                            </span>{" "}
                            {form.buyerFinalDestination || "—"}
                          </li>
                        </>
                      )}
                    </ul>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
