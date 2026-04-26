"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ImagePlus, Plus, Printer, Save, Trash2, X } from "lucide-react";

import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  PRODUCTION_ORDER_PROCESS_OPTIONS,
  calculateLineAmount,
  calculateOrderSubtotal,
  createEmptyProductionOrderLine,
  createEmptyReferenceImage,
  fmtCny,
  isoToday,
  type ProductionOrderDetail,
  type ProductionOrderHeaderInput,
  type ProductionOrderLineInput,
  type ProductionOrderReferenceImage,
  type ProductionOrderVendor,
} from "@/lib/productionOrders";

type Props = {
  orderId?: string;
};

function initialHeader(): ProductionOrderHeaderInput {
  const today = isoToday();
  return {
    order_date: today,
    vendor_id: null,
    vendor_name: "",
    supplier_contact: "",
    delivery_date: today,
    buyer_po_ref: "",
    work_sheet_ref: "",
    payment_terms: "",
    delivery_address: "",
    reference_images: [
      createEmptyReferenceImage("Front"),
      createEmptyReferenceImage("Back"),
      createEmptyReferenceImage("Detail"),
      createEmptyReferenceImage("Color"),
    ],
    currency: "CNY",
    material_supplied_by_jm: false,
    special_instructions: "",
    notes: "",
    prepared_by: "",
    approved_by: "",
    supplier_confirmation: "",
    status: "DRAFT",
  };
}

const inputCls =
  "h-9 w-full rounded-md border border-slate-300 px-2.5 text-sm outline-none focus:border-slate-900";
const selectCls =
  "h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-slate-900";

function normalizeReferenceImagesForForm(
  rows: ProductionOrderReferenceImage[] | null | undefined
) {
  const base = [
    createEmptyReferenceImage("Front"),
    createEmptyReferenceImage("Back"),
    createEmptyReferenceImage("Detail"),
    createEmptyReferenceImage("Color"),
  ];
  const source = Array.isArray(rows) ? rows : [];
  return base.map((item, index) => ({
    ...item,
    ...(source[index] || {}),
  }));
}

export default function ProductionOrderForm({ orderId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isEdit = Boolean(orderId);

  const [loading, setLoading] = React.useState(isEdit);
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [uploadingSlot, setUploadingSlot] = React.useState<number | null>(null);
  const [message, setMessage] = React.useState("");
  const [messageTone, setMessageTone] = React.useState<"success" | "error">("success");
  const [vendors, setVendors] = React.useState<ProductionOrderVendor[]>([]);
  const [header, setHeader] = React.useState<ProductionOrderHeaderInput>(initialHeader());
  const [lines, setLines] = React.useState<ProductionOrderLineInput[]>([
    createEmptyProductionOrderLine(),
  ]);
  const fileInputRefs = React.useRef<Array<HTMLInputElement | null>>([]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadVendors() {
      try {
        const res = await fetch("/api/work-sheets/vendors?limit=500", {
          cache: "no-store",
        });
        const json = await res.json().catch(() => null);
        if (!cancelled && res.ok && json?.success) {
          setVendors(Array.isArray(json.rows) ? json.rows : []);
        }
      } catch {
        if (!cancelled) setVendors([]);
      }
    }

    loadVendors();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!orderId) return;
    let cancelled = false;

    async function loadDetail() {
      try {
        setLoading(true);
        const res = await fetch(`/api/production/purchase-orders/${orderId}`, {
          cache: "no-store",
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          throw new Error(json?.error || "Failed to load production order");
        }
        if (cancelled) return;

        const detail = json as ProductionOrderDetail & { success: true };
        setHeader({
          order_no: detail.header.order_no,
          order_date: detail.header.order_date,
          vendor_id: detail.header.vendor_id || null,
          vendor_name: detail.header.vendor_name || "",
          supplier_contact: detail.header.supplier_contact || "",
          delivery_date: detail.header.delivery_date || "",
          buyer_po_ref: detail.header.buyer_po_ref || "",
          work_sheet_ref: detail.header.work_sheet_ref || "",
          payment_terms: detail.header.payment_terms || "",
          delivery_address: detail.header.delivery_address || "",
          reference_images: normalizeReferenceImagesForForm(detail.header.reference_images),
          currency: detail.header.currency || "CNY",
          material_supplied_by_jm: Boolean(detail.header.material_supplied_by_jm),
          special_instructions: detail.header.special_instructions || "",
          notes: detail.header.notes || "",
          prepared_by: detail.header.prepared_by || "",
          approved_by: detail.header.approved_by || "",
          supplier_confirmation: detail.header.supplier_confirmation || "",
          status: detail.header.status,
        });
        setLines(
          detail.lines.length
            ? detail.lines.map((line) => ({
                id: line.id,
                process_type: line.process_type,
                description: line.description || "",
                qty: Number(line.qty || 0),
                unit: line.unit || "PCS",
                unit_price: Number(line.unit_price || 0),
                remarks: line.remarks || "",
              }))
            : [createEmptyProductionOrderLine()]
        );
      } catch (e: any) {
        if (!cancelled) {
          setMessage(e?.message || "Failed to load production order");
          setMessageTone("error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadDetail();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  React.useEffect(() => {
    if (isEdit) return;

    const buyerPoRef = searchParams.get("buyerPoRef") ?? "";
    const workSheetRef = searchParams.get("workSheetRef") ?? "";
    const lineDescription = searchParams.get("lineDescription") ?? "";

    if (!buyerPoRef && !workSheetRef && !lineDescription) return;

    setHeader((prev) => ({
      ...prev,
      buyer_po_ref: prev.buyer_po_ref || buyerPoRef,
      work_sheet_ref: prev.work_sheet_ref || workSheetRef,
    }));

    if (lineDescription) {
      setLines((prev) => {
        if (
          prev.length === 1 &&
          !prev[0]?.description &&
          Number(prev[0]?.qty || 0) === 0 &&
          Number(prev[0]?.unit_price || 0) === 0 &&
          !prev[0]?.remarks
        ) {
          return [{ ...prev[0], description: lineDescription }];
        }
        return prev;
      });
    }
  }, [isEdit, searchParams]);

  const subtotal = React.useMemo(() => calculateOrderSubtotal(lines), [lines]);

  function patchHeader<K extends keyof ProductionOrderHeaderInput>(
    key: K,
    value: ProductionOrderHeaderInput[K]
  ) {
    setHeader((prev) => ({ ...prev, [key]: value }));
  }

  function patchLine(index: number, patch: Partial<ProductionOrderLineInput>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function patchReferenceImage(
    index: number,
    patch: Partial<ProductionOrderReferenceImage>
  ) {
    setHeader((prev) => ({
      ...prev,
      reference_images: (prev.reference_images || []).map((image, i) =>
        i === index ? { ...image, ...patch } : image
      ),
    }));
  }

  function openReferenceImagePicker(index: number) {
    fileInputRefs.current[index]?.click();
  }

  function clearReferenceImage(index: number) {
    patchReferenceImage(index, { url: "", path: "" });
    const input = fileInputRefs.current[index];
    if (input) input.value = "";
  }

  async function uploadReferenceImage(index: number, file: File | null) {
    if (!file) return;

    try {
      setUploadingSlot(index);
      setMessage("");

      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/production/purchase-orders/reference-images", {
        method: "POST",
        body: form,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success || !json?.file?.url) {
        throw new Error(json?.error || "Failed to upload image");
      }

      patchReferenceImage(index, {
        url: json.file.url,
        path: json.file.path || "",
      });
    } catch (e: any) {
      setMessage(e?.message || "Failed to upload image");
      setMessageTone("error");
    } finally {
      setUploadingSlot((prev) => (prev === index ? null : prev));
      const input = fileInputRefs.current[index];
      if (input) input.value = "";
    }
  }

  function addLine() {
    setLines((prev) => [...prev, createEmptyProductionOrderLine()]);
  }

  function removeLine(index: number) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  function handleVendorChange(vendorId: string) {
    const vendor = vendors.find((row) => row.id === vendorId) || null;
    patchHeader("vendor_id", vendorId || null);
    patchHeader("vendor_name", vendor?.company_name || "");
    patchHeader("currency", "CNY");
  }

  async function handleSave() {
    try {
      setSaving(true);
      setMessage("");

      const payload = {
        header: {
          ...header,
          reference_images: (header.reference_images || []).filter((item) => item.url.trim()),
          currency: "CNY",
        },
        lines,
      };

      const res = await fetch(
        isEdit
          ? `/api/production/purchase-orders/${orderId}`
          : "/api/production/purchase-orders",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Failed to save production order");
      }

      setMessage(isEdit ? "Production order updated." : "Production order created.");
      setMessageTone("success");

      if (!isEdit && json?.header?.id) {
        router.replace(`/production/purchase-orders/${json.header.id}`);
      }
    } catch (e: any) {
      setMessage(e?.message || "Failed to save production order");
      setMessageTone("error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!orderId || deleting) return;
    const okDelete = window.confirm(
      "Delete this production order?\n\nIt will be removed from the list."
    );
    if (!okDelete) return;

    try {
      setDeleting(true);
      setMessage("");

      const res = await fetch(`/api/production/purchase-orders/${orderId}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Failed to delete production order");
      }

      router.replace("/production/purchase-orders");
    } catch (e: any) {
      setMessage(e?.message || "Failed to delete production order");
      setMessageTone("error");
    } finally {
      setDeleting(false);
    }
  }

  function openPrintPage() {
    if (!orderId) return;
    window.open(`/production/purchase-orders/${orderId}/print`, "_blank", "noopener,noreferrer");
  }

  return (
    <AppShell
      role="admin"
      title={isEdit ? "Production Order" : "New Production Order"}
      description="中英双语生产发注单 / Bilingual production order form"
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">
              生产订单 / Production Order
            </div>
            <div className="text-xs text-slate-500">
              CNY only. Printable vendor-facing production order form.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/production/purchase-orders">Back to List</Link>
            </Button>
            {isEdit ? (
              <Button variant="outline" onClick={handleDelete} disabled={deleting || saving || loading}>
                <Trash2 className="h-4 w-4" />
                {deleting ? "Deleting..." : "Delete"}
              </Button>
            ) : null}
            {isEdit ? (
              <Button variant="outline" onClick={openPrintPage}>
                <Printer className="h-4 w-4" />
                Print / PDF
              </Button>
            ) : null}
            <Button onClick={handleSave} disabled={saving || loading}>
              <Save className="h-4 w-4" />
              {saving ? "Saving..." : "Save Order"}
            </Button>
          </div>
        </div>

        {message ? (
          <div
            className={[
              "rounded-md border px-4 py-3 text-sm",
              messageTone === "success"
                ? "border-green-200 bg-green-50 text-green-700"
                : "border-red-200 bg-red-50 text-red-700",
            ].join(" ")}
          >
            {message}
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Header / 基本信息</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label>订单号 / Order No</Label>
              <Input value={header.order_no || "Auto on save"} readOnly />
            </div>
            <div className="space-y-1.5">
              <Label>日期 / Date</Label>
              <Input
                type="date"
                value={header.order_date}
                onChange={(e) => patchHeader("order_date", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>状态 / Status</Label>
              <select
                className={selectCls}
                value={header.status}
                onChange={(e) => patchHeader("status", e.target.value as any)}
              >
                <option value="DRAFT">草稿 / Draft</option>
                <option value="CONFIRMED">确认 / Confirmed</option>
                <option value="CANCELLED">取消 / Cancelled</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>货币 / Currency</Label>
              <Input value="CNY" readOnly />
            </div>

            <div className="space-y-1.5 xl:col-span-2">
              <Label>供应商 / 加工厂 / Supplier / Processor</Label>
              <select
                className={selectCls}
                value={header.vendor_id || ""}
                onChange={(e) => handleVendorChange(e.target.value)}
              >
                <option value="">Select supplier / processor</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.company_name || vendor.code || vendor.id}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label>联系人 / Contact</Label>
              <Input
                value={header.supplier_contact}
                onChange={(e) => patchHeader("supplier_contact", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>交期 / Delivery Date</Label>
              <Input
                type="date"
                value={header.delivery_date}
                onChange={(e) => patchHeader("delivery_date", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>客户PO参考 / Buyer PO Ref</Label>
              <Input
                value={header.buyer_po_ref}
                onChange={(e) => patchHeader("buyer_po_ref", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Work Sheet参考 / Work Sheet Ref</Label>
              <Input
                value={header.work_sheet_ref}
                onChange={(e) => patchHeader("work_sheet_ref", e.target.value)}
              />
            </div>

            <div className="space-y-1.5 xl:col-span-2">
              <Label>付款条件 / Payment Terms</Label>
              <Input
                value={header.payment_terms}
                onChange={(e) => patchHeader("payment_terms", e.target.value)}
                placeholder="例如 / e.g. 30 days"
              />
            </div>
            <div className="space-y-1.5 xl:col-span-2">
              <Label>交货地址 / Delivery Address</Label>
              <Input
                value={header.delivery_address}
                onChange={(e) => patchHeader("delivery_address", e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>参考图片 / Reference Images</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
              Upload up to 4 reference images. These will appear below the supplier/reference block and above the line table on the printable form.
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {(header.reference_images || []).map((image, index) => (
                <div key={index} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Slot {index + 1}
                  </div>
                  <div className="mb-3 flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50">
                    {image.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={image.url}
                        alt={image.caption || `Reference ${index + 1}`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="px-3 text-center text-xs text-slate-400">
                        Image preview
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label>Caption</Label>
                      <Input
                        value={image.caption}
                        onChange={(e) =>
                          patchReferenceImage(index, { caption: e.target.value })
                        }
                        placeholder="Front / Back / Detail / Color"
                      />
                    </div>
                    <input
                      ref={(node) => {
                        fileInputRefs.current[index] = node;
                      }}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) =>
                        uploadReferenceImage(index, e.target.files?.[0] || null)
                      }
                    />
                    <div className="space-y-2">
                      <Label>Image File</Label>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => openReferenceImagePicker(index)}
                          disabled={uploadingSlot === index}
                        >
                          <ImagePlus className="h-4 w-4" />
                          {uploadingSlot === index
                            ? "Uploading..."
                            : image.url
                              ? "Change Image"
                              : "Upload Image"}
                        </Button>
                        {image.url ? (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => clearReferenceImage(index)}
                            disabled={uploadingSlot === index}
                          >
                            <X className="h-4 w-4" />
                            Remove
                          </Button>
                        ) : null}
                      </div>
                      <div className="text-xs text-slate-500">
                        JPG, PNG, WEBP etc. Choose a file and it will upload automatically.
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Lines / 发注明细</CardTitle>
            <Button type="button" variant="outline" onClick={addLine}>
              <Plus className="h-4 w-4" />
              Add Line
            </Button>
          </CardHeader>
          <CardContent className="space-y-4 overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
                  <th className="px-2 py-2">#</th>
                  <th className="px-2 py-2">工序 / Process</th>
                  <th className="px-2 py-2">说明 / Description</th>
                  <th className="px-2 py-2">数量 / Qty</th>
                  <th className="px-2 py-2">单位 / Unit</th>
                  <th className="px-2 py-2">单价 / Unit Price</th>
                  <th className="px-2 py-2">金额 / Amount</th>
                  <th className="px-2 py-2">备注 / Remarks</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={line.id || index} className="border-b border-slate-100 align-top">
                    <td className="px-2 py-2 text-sm text-slate-500">{index + 1}</td>
                    <td className="px-2 py-2">
                      <select
                        className={selectCls}
                        value={line.process_type}
                        onChange={(e) => patchLine(index, { process_type: e.target.value })}
                      >
                        {PRODUCTION_ORDER_PROCESS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        value={line.description}
                        onChange={(e) => patchLine(index, { description: e.target.value })}
                        placeholder="Describe ordered work / material"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        type="number"
                        step="0.01"
                        value={line.qty}
                        onChange={(e) => patchLine(index, { qty: Number(e.target.value) })}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        value={line.unit}
                        onChange={(e) => patchLine(index, { unit: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        type="number"
                        step="0.0001"
                        value={line.unit_price}
                        onChange={(e) =>
                          patchLine(index, { unit_price: Number(e.target.value) })
                        }
                      />
                    </td>
                    <td className="px-2 py-2 text-sm font-medium text-slate-900">
                      {fmtCny(calculateLineAmount(line))}
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        value={line.remarks}
                        onChange={(e) => patchLine(index, { remarks: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeLine(index)}
                        disabled={lines.length === 1}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex justify-end">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                <div className="text-slate-500">总金额 / Total Amount</div>
                <div className="mt-1 text-lg font-semibold text-slate-950">{fmtCny(subtotal)}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notes / 附加信息</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>特别说明 / Special Instructions</Label>
              <Textarea
                value={header.special_instructions}
                onChange={(e) => patchHeader("special_instructions", e.target.value)}
                rows={5}
              />
            </div>
            <div className="space-y-1.5">
              <Label>备注 / Notes</Label>
              <Textarea
                value={header.notes}
                onChange={(e) => patchHeader("notes", e.target.value)}
                rows={5}
              />
            </div>
            <div className="space-y-1.5">
              <Label>制单 / Prepared By</Label>
              <Input
                value={header.prepared_by}
                onChange={(e) => patchHeader("prepared_by", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>批准 / Approved By</Label>
              <Input
                value={header.approved_by}
                onChange={(e) => patchHeader("approved_by", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>供应商确认 / Supplier Confirmation</Label>
              <Input
                value={header.supplier_confirmation}
                onChange={(e) => patchHeader("supplier_confirmation", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>JM供料 / Material Supplied By JM</Label>
              <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={header.material_supplied_by_jm}
                  onChange={(e) =>
                    patchHeader("material_supplied_by_jm", e.target.checked)
                  }
                />
                <span>本订单由JM提供材料 / JM supplies materials for this order</span>
              </label>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
