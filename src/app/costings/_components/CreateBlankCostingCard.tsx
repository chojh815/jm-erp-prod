// src/app/costings/_components/CreateBlankCostingCard.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function CreateBlankCostingCard() {
  const router = useRouter();

  const [styleNo, setStyleNo] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  async function onCreate() {
    const s = styleNo.trim();
    if (!s) {
      setMsg("Style No is required.");
      return;
    }
    if (!window.confirm("Do you want to create this blank costing?")) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/costings/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ style_no: s, currency: "CNY", stage: "SAMPLE" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) {
        setMsg(j?.error || "Failed to create costing.");
        return;
      }
      router.push(`/costings/${j.id}?mode=edit`);
    } catch (e: any) {
      setMsg(e?.message || "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create blank Costing (CNY base)</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex gap-2 items-center">
          <Input
            value={styleNo}
            onChange={(e) => setStyleNo(e.target.value)}
            placeholder="style no (e.g., JK260001)"
          />
          <Button onClick={onCreate} disabled={busy}>
            {busy ? "Creating..." : "Create"}
          </Button>
        </div>
        {msg ? <div className="text-sm text-red-600">{msg}</div> : null}
        <div className="text-xs text-muted-foreground">
          This creates a blank Costing header (status DRAFT) and opens the detail page for input.
        </div>
      </CardContent>
    </Card>
  );
}
