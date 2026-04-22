"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import ExcelJS from "exceljs";
import { getCompanyStampByOrigin } from "@/lib/companyStamp";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";

type Role = AppRole;

type ProformaListItem = {
  id: string;
  invoiceNo: string;
  poNo?: string | null;
  buyerName?: string | null;
  currency?: string | null;
  createdAt?: string | null;
  subtotal?: number | null;
};

function fmtMoney(currency: string | null | undefined, v: number | null | undefined) {
  const n = Number(v ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  const cur = (currency ?? "").toString().trim() || "USD";
  return `${cur} ${safe.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(v?: string | null) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

function safeText(v: any) {
  return (v ?? "").toString().trim();
}

function firstNonEmpty(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== null && v !== undefined && safeText(v) !== "") return v;
  }
  return null;
}

function escapeIlikePattern(v: string) {
  return v.replace(/[%_]/g, (m) => `\\${m}`);
}

function buildAddress(obj: any) {
  return [
    firstNonEmpty(obj, ["address1", "addr1", "street_address"]),
    firstNonEmpty(obj, ["address2", "addr2"]),
    firstNonEmpty(obj, ["city"]),
    firstNonEmpty(obj, ["state", "province"]),
    firstNonEmpty(obj, ["zip", "postal_code"]),
    firstNonEmpty(obj, ["country"]),
  ]
    .map(safeText)
    .filter(Boolean)
    .join("\n");
}

function cooTextFromOrigin(originCode: string, site: any) {
  const explicit = safeText(firstNonEmpty(site, ["coo_text", "cooText"]));
  if (explicit) return explicit;
  const country = safeText(firstNonEmpty(site, ["origin_country", "country", "coo_country"]));
  if (country) return `MADE IN ${country}`;
  const code = safeText(originCode).toUpperCase();
  if (!code) return "-";
  if (code.startsWith("CN") || code.includes("CHINA") || code.includes("QINGDAO")) return "MADE IN CHINA";
  if (code.startsWith("VN") || code.includes("VIETNAM") || code.includes("BACNINH")) return "MADE IN VIETNAM";
  if (code.startsWith("KR") || code.includes("KOREA")) return "MADE IN KOREA";
  return `MADE IN ${code.replace(/_/g, " ")}`;
}

async function fetchJSON(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error || data?.message || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

export default function ProformaListPage() {
  const router = useRouter();
  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);
  const role = "admin" as Role; // AppShell 내부에서 role 활용(현재 프로젝트 방식 유지)

  const [q, setQ] = React.useState("");
  const [items, setItems] = React.useState<ProformaListItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [exportingId, setExportingId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (q.trim()) qs.set("q", q.trim());
      const url = `/api/proforma/list?${qs.toString()}`;
      const json = await fetchJSON(url);
      const list: ProformaListItem[] = Array.isArray(json?.items) ? json.items : [];
      setItems(list);
    } catch (e: any) {
      setItems([]);
      setError(e?.message || "Failed to load proforma list");
    } finally {
      setLoading(false);
    }
  }, [q]);

  React.useEffect(() => {
    // 첫 진입 시 자동 로드
    load();
  }, [load]);

  const onSearch = React.useCallback(() => {
    load();
  }, [load]);

  const onReset = React.useCallback(() => {
    setQ("");
    // reset 후 즉시 전체 로드
    setTimeout(() => load(), 0);
  }, [load]);

  const openPO = (poNo?: string | null) => {
    // ✅ Open PO uses PO No (not UUID). PO Samples route resolves po_no -> header id internally.

    if (!poNo) return;
    // 기존 PO 상세/샘플 화면 규칙에 맞춰 필요시 경로만 조정
    router.push(`/po/${encodeURIComponent(poNo)}/samples`);
  };

  const openPDF = (id: string) => {
    // ✅ PDF는 /api/proforma/[id]/pdf 라우트를 사용
    const url = `/api/proforma/${encodeURIComponent(id)}/pdf`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  async function loadBuyerCompanyById(companyId: string) {
    const { data, error } = await supabase
      .from("companies")
      .select("*")
      .eq("id", companyId)
      .maybeSingle();
    if (!error) return data;
    console.warn("Failed to load buyer company:", error);
    return null;
  }

  async function loadBuyerCompanyByName(companyName: string) {
    const name = safeText(companyName);
    if (!name) return null;
    const pattern = `%${escapeIlikePattern(name)}%`;

    const { data, error } = await supabase
      .from("companies")
      .select("*")
      .ilike("company_name", pattern)
      .limit(1);
    if (!error && Array.isArray(data) && data.length > 0) return data[0];

    const fallback = await supabase
      .from("companies")
      .select("*")
      .ilike("name", pattern)
      .limit(1);
    if (!fallback.error && Array.isArray(fallback.data) && fallback.data.length > 0) return fallback.data[0];

    console.warn("Failed to load buyer company by name:", error || fallback.error);
    return null;
  }

  async function loadSiteByOrigin(originCode: string) {
    const code = safeText(originCode);
    if (!code) return null;
    const { data, error } = await supabase
      .from("company_sites")
      .select("*")
      .eq("origin_code", code)
      .limit(1);
    if (!error && Array.isArray(data) && data.length > 0) return data[0];
    console.warn("Failed to load company site:", error);
    return null;
  }

  const exportExcel = async (it: ProformaListItem) => {
    try {
      setExportingId(it.id);
      const detail = await fetchJSON(`/api/proforma/detail?invoiceNo=${encodeURIComponent(it.invoiceNo)}`);
      const header = detail?.header || {};
      const lines = Array.isArray(detail?.lines) ? detail.lines : [];

      const invoiceNo = safeText(firstNonEmpty(header, ["invoiceNo", "invoice_no"])) || it.invoiceNo;
      const poNo = safeText(firstNonEmpty(header, ["poNo", "po_no"])) || safeText(it.poNo);
      const buyerName = safeText(firstNonEmpty(header, ["buyerName", "buyer_name"])) || safeText(it.buyerName);
      const buyerCompanyId = firstNonEmpty(header, ["buyerCompanyId", "buyer_company_id", "buyerId", "buyer_id"]);
      let buyerCompany: any | null = null;
      if (buyerCompanyId) buyerCompany = await loadBuyerCompanyById(String(buyerCompanyId));
      if (!buyerCompany && buyerName) buyerCompany = await loadBuyerCompanyByName(buyerName);

      const currency = safeText(firstNonEmpty(header, ["currency"])) || safeText(it.currency) || "USD";
      const dateValue = firstNonEmpty(header, ["issue_date", "createdAt", "created_at"]) || it.createdAt;
      const dateText = dateValue ? String(dateValue).slice(0, 10) : "-";
      const paymentTerm =
        safeText(firstNonEmpty(header, ["paymentTerm", "payment_term"])) ||
        safeText(buyerCompany?.buyer_payment_term) ||
        "-";
      const incoterm =
        safeText(firstNonEmpty(header, ["incoterm"])) ||
        safeText(buyerCompany?.buyer_default_incoterm) ||
        "-";
      const shipMode =
        safeText(firstNonEmpty(header, ["shipMode", "ship_mode"])) ||
        safeText(buyerCompany?.buyer_default_ship_mode) ||
        "-";
      const consignee =
        safeText(firstNonEmpty(header, ["consignee_text", "consigneeText", "consignee"])) ||
        safeText(buyerCompany?.buyer_consignee) ||
        buyerName ||
        "-";
      const notifyParty =
        safeText(firstNonEmpty(header, ["notify_party_text", "notifyPartyText", "notify_party"])) ||
        safeText(buyerCompany?.buyer_notify_party) ||
        consignee;
      const finalDestination =
        safeText(firstNonEmpty(header, ["finalDestination", "final_destination"])) ||
        safeText(buyerCompany?.buyer_final_destination) ||
        "-";
      const originCode =
        safeText(firstNonEmpty(header, ["shippingOriginCode", "shipping_origin_code"])) ||
        safeText(firstNonEmpty(header, ["originCode", "origin_code"])) ||
        safeText(buyerCompany?.origin_mark) ||
        "";
      const site = await loadSiteByOrigin(originCode);
      const shipperName =
        safeText(firstNonEmpty(header, ["shipper_name", "exporter_name"])) ||
        safeText(firstNonEmpty(site, ["shipper_name", "site_name", "name", "legal_name"])) ||
        "JM INTERNATIONAL CO.,LTD";
      const shipperAddress =
        safeText(firstNonEmpty(header, ["shipper_address", "exporter_address", "shipper_addr"])) ||
        safeText(firstNonEmpty(site, ["shipper_address"])) ||
        buildAddress(site);
      const shipModeUpper = safeText(shipMode).toUpperCase();
      const portOfLoading =
        safeText(firstNonEmpty(header, ["portOfLoading", "port_of_loading"])) ||
        (shipModeUpper === "AIR"
          ? safeText(firstNonEmpty(site, ["air_port_loading", "factory_air_port"]))
          : safeText(firstNonEmpty(site, ["sea_port_loading", "factory_sea_port"]))) ||
        safeText(firstNonEmpty(site, ["sea_port_loading", "air_port_loading", "factory_sea_port", "factory_air_port"])) ||
        "-";
      const cooText =
        safeText(firstNonEmpty(header, ["coo_text", "cooText"])) ||
        cooTextFromOrigin(originCode, site);

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "JM ERP";
      workbook.created = new Date();
      const sheet = workbook.addWorksheet("Proforma Invoice", {
        pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
        views: [{ showGridLines: false }],
      });

      sheet.columns = [
        { width: 14 }, { width: 18 }, { width: 24 }, { width: 14 },
        { width: 12 }, { width: 10 }, { width: 14 }, { width: 16 },
      ];

      const border = { style: "thin", color: { argb: "FF000000" } } as const;
      const lightBorder = { style: "thin", color: { argb: "FF999999" } } as const;
      const headerFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF3F7" } } as const;

      const boxRange = (from: string, to: string) => {
        const fromCell = sheet.getCell(from);
        const toCell = sheet.getCell(to);
        for (let rowNo = Number(fromCell.row); rowNo <= Number(toCell.row); rowNo++) {
          for (let colNo = Number(fromCell.col); colNo <= Number(toCell.col); colNo++) {
            const cell = sheet.getCell(rowNo, colNo);
            cell.border = { top: border, left: border, bottom: border, right: border };
            cell.alignment = { vertical: "top", wrapText: true };
          }
        }
      };

      sheet.mergeCells("A1:H1");
      sheet.getCell("A1").value = "Proforma Invoice";
      sheet.getCell("A1").font = { bold: true, size: 18 };
      sheet.getCell("A1").alignment = { horizontal: "center" };
      sheet.getRow(1).height = 28;

      sheet.mergeCells("A2:D2");
      sheet.mergeCells("E2:H2");
      sheet.mergeCells("A3:D3");
      sheet.mergeCells("E3:H3");
      sheet.getCell("A2").value = `Buyer: ${buyerName || "-"}`;
      sheet.getCell("E2").value = `Invoice No: ${invoiceNo}`;
      sheet.getCell("A3").value = `PO No: ${poNo || "-"}`;
      sheet.getCell("E3").value = `Date: ${dateText}`;
      sheet.getCell("E2").alignment = { horizontal: "right" };
      sheet.getCell("E3").alignment = { horizontal: "right" };

      sheet.mergeCells("A5:D5");
      sheet.mergeCells("E5:H5");
      sheet.mergeCells("A6:D7");
      sheet.mergeCells("E6:H7");
      sheet.getCell("A5").value = "Shipper / Exporter";
      sheet.getCell("E5").value = "Invoice & Terms";
      sheet.getCell("A6").value = [shipperName, shipperAddress].filter(Boolean).join("\n");
      sheet.getCell("E6").value = `Terms: ${paymentTerm}\nIncoterm: ${incoterm}\nShip Mode: ${shipMode}`;
      boxRange("A5", "H7");

      sheet.mergeCells("A9:D9");
      sheet.mergeCells("E9:H9");
      sheet.mergeCells("A10:D12");
      sheet.mergeCells("E10:H12");
      sheet.getCell("A9").value = "Consignee";
      sheet.getCell("E9").value = "Notify Party";
      sheet.getCell("A10").value = consignee;
      sheet.getCell("E10").value = notifyParty;
      boxRange("A9", "H12");

      sheet.mergeCells("A14:D14");
      sheet.mergeCells("E14:H14");
      sheet.mergeCells("A15:D15");
      sheet.mergeCells("E15:H15");
      sheet.getCell("A14").value = "Port of Loading";
      sheet.getCell("E14").value = "Final Destination";
      sheet.getCell("A15").value = portOfLoading;
      sheet.getCell("E15").value = finalDestination;
      boxRange("A14", "H15");

      sheet.mergeCells("A17:H17");
      sheet.mergeCells("A18:H19");
      sheet.getCell("A17").value = "COO / Certification";
      sheet.getCell("A18").value = `${cooText}\nWE CERTIFY THERE IS NO WOOD PACKING MATERIAL USED IN THIS SHIPMENT.`;
      boxRange("A17", "H19");

      for (const addr of ["A5", "E5", "A9", "E9", "A14", "E14", "A17"]) {
        sheet.getCell(addr).font = { bold: true };
        sheet.getCell(addr).fill = headerFill;
      }

      const tableStart = 21;
      const headerRow = sheet.getRow(tableStart);
      headerRow.values = ["PO #", "Buyer Style", "Description", "HS Code", "Qty", "UOM", "Unit Price", "Amount"];
      headerRow.eachCell((cell) => {
        cell.fill = headerFill;
        cell.font = { bold: true };
        cell.border = { top: lightBorder, left: lightBorder, bottom: lightBorder, right: lightBorder };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      });

      lines.forEach((l: any, idx: number) => {
        const qty = Number(l?.qty ?? 0);
        const unitPrice = Number(l?.unit_price ?? l?.unitPrice ?? 0);
        const amount = Number(l?.amount ?? qty * unitPrice);
        const row = sheet.getRow(tableStart + idx + 1);
        row.values = [
          poNo,
          safeText(l?.buyer_style_no || l?.buyerStyleNo),
          safeText(l?.description),
          safeText(l?.hs_code),
          qty || "",
          safeText(l?.uom),
          unitPrice,
          amount,
        ];
        row.eachCell((cell, colNumber) => {
          cell.border = { top: lightBorder, left: lightBorder, bottom: lightBorder, right: lightBorder };
          cell.alignment = { vertical: "middle", wrapText: true };
          if ([5, 7, 8].includes(colNumber)) cell.alignment = { horizontal: "right", vertical: "middle", wrapText: true };
          if (colNumber === 5) cell.numFmt = "#,##0";
          if ([7, 8].includes(colNumber)) cell.numFmt = "#,##0.00";
        });
      });

      const subtotal = lines.reduce((sum: number, l: any) => {
        const qty = Number(l?.qty ?? 0);
        const unitPrice = Number(l?.unit_price ?? l?.unitPrice ?? 0);
        return sum + Number(l?.amount ?? qty * unitPrice);
      }, 0);

      const subtotalRowNo = tableStart + lines.length + 2;
      sheet.mergeCells(`A${subtotalRowNo}:G${subtotalRowNo}`);
      sheet.getCell(`A${subtotalRowNo}`).value = "Subtotal";
      sheet.getCell(`A${subtotalRowNo}`).font = { bold: true };
      sheet.getCell(`A${subtotalRowNo}`).alignment = { horizontal: "right" };
      sheet.getCell(`H${subtotalRowNo}`).value = subtotal;
      sheet.getCell(`H${subtotalRowNo}`).font = { bold: true };
      sheet.getCell(`H${subtotalRowNo}`).numFmt = `"${currency} "#,##0.00`;

      const signRowNo = subtotalRowNo + 4;
      sheet.mergeCells(`F${signRowNo}:H${signRowNo}`);
      sheet.getCell(`F${signRowNo}`).value = "Signed by";
      sheet.getCell(`F${signRowNo}`).alignment = { horizontal: "center" };

      const stamp = getCompanyStampByOrigin(originCode);
      try {
        const stampRes = await fetch(stamp.publicPath);
        const stampBuffer = await stampRes.arrayBuffer();
        const imageId = workbook.addImage({
          buffer: stampBuffer as any,
          extension: stamp.format === "JPEG" ? "jpeg" : "png",
        });
        sheet.addImage(imageId, {
          tl: { col: 5.65, row: signRowNo },
          ext: { width: stamp.boxW * 3.5, height: stamp.boxH * 3.5 },
        });
      } catch (e) {
        console.warn("Failed to add proforma stamp to Excel:", e);
      }

      sheet.mergeCells(`F${signRowNo + 8}:H${signRowNo + 8}`);
      sheet.getCell(`F${signRowNo + 8}`).value = stamp.companyName;
      sheet.getCell(`F${signRowNo + 8}`).alignment = { horizontal: "center" };

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoiceNo || "proforma"}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e?.message || "Failed to export Excel.");
    } finally {
      setExportingId(null);
    }
  };

  return (
    <AppShell
      role={role}
      title="Proforma Invoices"
      description="Search and open Proforma Invoices created from Purchase Orders."
    >
      <div className="p-4 space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Proforma Invoices</CardTitle>
              <div className="text-sm text-muted-foreground mt-1">
                Search and open Proforma Invoices created from Purchase Orders.
              </div>
            </div>
            <Button variant="ghost" onClick={() => router.push("/po/create")}>
              Go to PO Create
            </Button>
          </CardHeader>

          <CardContent className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by Invoice No, PO No, Buyer..."
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSearch();
                }}
              />
              <div className="flex gap-2">
                <Button onClick={onSearch} disabled={loading}>
                  Search
                </Button>
                <Button variant="outline" onClick={onReset} disabled={loading}>
                  Reset
                </Button>
              </div>
            </div>

            {error ? (
              <div className="text-sm text-red-600">{error}</div>
            ) : null}

            <div className="overflow-x-auto border rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="p-3 font-medium">Invoice No</th>
                    <th className="p-3 font-medium">PO No</th>
                    <th className="p-3 font-medium">Buyer</th>
                    <th className="p-3 font-medium">Created At</th>
                    <th className="p-3 font-medium text-right">Subtotal</th>
                    <th className="p-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td className="p-3" colSpan={6}>
                        Loading...
                      </td>
                    </tr>
                  ) : items.length === 0 ? (
                    <tr>
                      <td className="p-3 text-muted-foreground" colSpan={6}>
                        No Proforma Invoice found.
                      </td>
                    </tr>
                  ) : (
                    items.map((it) => (
                      <tr key={it.id} className="border-t">
                        <td className="p-3 whitespace-nowrap">{it.invoiceNo}</td>
                        <td className="p-3 whitespace-nowrap">{it.poNo ?? ""}</td>
                        <td className="p-3">{it.buyerName ?? ""}</td>
                        <td className="p-3 whitespace-nowrap">{fmtDate(it.createdAt)}</td>
                        <td className="p-3 text-right whitespace-nowrap">
                          {fmtMoney(it.currency, it.subtotal)}
                        </td>
                        <td className="p-3 text-right whitespace-nowrap">
                          <div className="inline-flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openPO(it.poNo)}
                              disabled={!it.poNo}
                            >
                              PO (Samples)
                            </Button>
                            <Button size="sm" onClick={() => openPDF(it.id)}>
                              PDF
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => exportExcel(it)}
                              disabled={exportingId === it.id}
                            >
                              {exportingId === it.id ? "Making..." : "Excel"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
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
