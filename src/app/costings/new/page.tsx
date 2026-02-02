"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * /costings/new
 * - IMPORTANT: DO NOT create any DB record on page load.
 * - Create (insert) happens ONLY when user clicks "Save & Open".
 */
export default function NewCostingPage() {
  const router = useRouter();

  const [err, setErr] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const [styleNo, setStyleNo] = React.useState("");
  const [stage, setStage] = React.useState<"SAMPLE" | "BULK">("SAMPLE");
  const [baseCurrency, setBaseCurrency] = React.useState<"CNY" | "USD">("CNY");

  const canSave = styleNo.trim().length > 0 && !saving;

  async function saveAndOpen() {
    if (!canSave) return;
    setErr(null);
    setSaving(true);
    try {
      const res = await fetch("/api/costings/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          style_no: styleNo.trim(),
          stage,
          base_currency: baseCurrency,
        }),
      });

      const j = await res.json().catch(() => ({} as any));
      if (!res.ok || !j?.success || !j?.id) {
        throw new Error(j?.error || j?.message || `Create failed (HTTP ${res.status})`);
      }

      router.replace(`/costings/${j.id}`);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to create Costing");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="text-3xl font-semibold">Costing</div>
          <div className="text-sm text-muted-foreground">
            New (no auto-save). Save 버튼을 눌렀을 때만 DB에 생성됩니다.
          </div>
        </div>
        <Button variant="secondary" onClick={() => router.push("/costings")}>
          Open List
        </Button>
      </div>

      {err ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <div className="font-semibold mb-1">Create failed</div>
          <div className="whitespace-pre-wrap">{err}</div>
        </div>
      ) : null}

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>New Costing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">Style No</div>
              <Input
                value={styleNo}
                onChange={(e) => setStyleNo(e.target.value)}
                placeholder="e.g. JK260001"
              />
              <div className="text-xs text-muted-foreground">
                * 입력 후 <span className="font-medium">Save & Open</span>을 눌러야 생성됩니다.
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">Base Currency</div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={baseCurrency === "CNY" ? "default" : "secondary"}
                  onClick={() => setBaseCurrency("CNY")}
                >
                  CNY
                </Button>
                <Button
                  type="button"
                  variant={baseCurrency === "USD" ? "default" : "secondary"}
                  onClick={() => setBaseCurrency("USD")}
                >
                  USD
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Stage</div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={stage === "SAMPLE" ? "default" : "secondary"}
                onClick={() => setStage("SAMPLE")}
              >
                SAMPLE
              </Button>
              <Button
                type="button"
                variant={stage === "BULK" ? "default" : "secondary"}
                onClick={() => setStage("BULK")}
              >
                BULK
              </Button>
              <Badge variant="outline" className="ml-2 self-center">
                Create on Save
              </Badge>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={saveAndOpen} disabled={!canSave}>
              {saving ? "Saving..." : "Save & Open"}
            </Button>
            <Button variant="secondary" onClick={() => router.push("/costings")} disabled={saving}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
