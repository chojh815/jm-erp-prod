"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ProformaFromPoPage() {
  const [poNo, setPoNo] = useState("");
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    if (!poNo.trim()) {
      alert("PO No를 입력하세요.");
      return;
    }

    try {
      setLoading(true);

      // 👉 API route 호출 (JSX ❌, API에서 PDF 생성)
      const res = await fetch(
        `/api/proforma/from-po?poNo=${encodeURIComponent(poNo)}`,
        { method: "POST" }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Failed to generate Proforma Invoice");
      }

      // 👉 PDF 새 탭으로 열기
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, "_blank");
    } catch (e: any) {
      console.error(e);
      alert(e.message || "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-xl">
      <h1 className="text-xl font-semibold mb-4">
        Create Proforma Invoice from PO
      </h1>

      <div className="flex gap-2">
        <Input
          placeholder="PO No (ex: PO-250001)"
          value={poNo}
          onChange={(e) => setPoNo(e.target.value)}
        />

        <Button onClick={handleGenerate} disabled={loading}>
          {loading ? "Generating..." : "Generate PI"}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground mt-3">
        입력한 PO No 기준으로 Proforma Invoice PDF를 생성합니다.
      </p>
    </div>
  );
}
