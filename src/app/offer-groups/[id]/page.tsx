"use client";

import * as React from "react";
import { useRouter, useParams } from "next/navigation";

import AppShell from "@/components/layout/AppShell";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Header = {
  id: string;
  buyer_name?: string | null;
  buyer_code?: string | null;
  currency?: string | null;
  status?: string | null;
  title?: string | null;
  memo?: string | null;
};

type Item = {
  id: string;
  costing_id?: string | null;
  style_no?: string | null;
  image_url?: string | null;
  material_summary?: string | null;
  size_summary?: string | null;
  remark?: string | null;
  sort_no?: number | null;
};

type Pkg = {
  id?: string;
  item_id: string;
  package_type: string;
  currency?: string | null;
  fob_price: number | string;
  moq: number | string;
};

type CostingPick = {
  id: string;
  style_no?: string | null;
  stage?: string | null;
  version_no?: number | null;
  status?: string | null;
  currency?: string | null;
  total_cost_usd?: number | null;
  updated_at?: string | null;
};

const DEFAULT_PACKAGE_TYPES = ["3PC/PKG", "4PC/PKG", "6PC/PKG", "10PC/PKG", "12PC/PKG"];

function n(v: any, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

export default function OfferGroupDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = String((params as any)?.id || "");

  const [loading, setLoading] = React.useState(false);
  const [header, setHeader] = React.useState<Header | null>(null);
  const [items, setItems] = React.useState<Item[]>([]);
  const [packages, setPackages] = React.useState<Pkg[]>([]);

  const [newStyle, setNewStyle] = React.useState("");
  const [newImageUrl, setNewImageUrl] = React.useState("");

  // Add from Costings (search by style)
  const [pickOpen, setPickOpen] = React.useState(false);
  const [pickQ, setPickQ] = React.useState("");
  const [pickLoading, setPickLoading] = React.useState(false);
  const [pickRows, setPickRows] = React.useState<CostingPick[]>([]);

  const packageTypes = React.useMemo(() => {
    const fromDb = Array.from(new Set((packages || []).map((p) => p.package_type))).filter(Boolean);
    const merged = Array.from(new Set([...DEFAULT_PACKAGE_TYPES, ...fromDb]));
    return merged;
  }, [packages]);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/offer-groups/${id}`, { cache: "no-store" });
      const j = await r.json();
      if (!j?.success) throw new Error(j?.error || "Failed");
      setHeader(j.header);
      setItems(j.items || []);
      setPackages((j.packages || []).map((p: any) => ({ ...p, fob_price: p.fob_price ?? 0, moq: p.moq ?? 0 })));
    } catch (e: any) {
      alert(e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function getPkg(item_id: string, package_type: string): Pkg {
    const found = packages.find((p) => p.item_id === item_id && p.package_type === package_type && (p as any).is_deleted !== true);
    if (found) return found;
    return { item_id, package_type, currency: header?.currency ?? "USD", fob_price: "", moq: "" };
  }

  function setPkg(item_id: string, package_type: string, patch: Partial<Pkg>) {
    setPackages((prev) => {
      const next = [...prev];
      const idx = next.findIndex((p) => p.item_id === item_id && p.package_type === package_type);
      if (idx >= 0) next[idx] = { ...next[idx], ...patch };
      else next.push({ item_id, package_type, currency: header?.currency ?? "USD", fob_price: "", moq: "", ...patch } as Pkg);
      return next;
    });
  }

  async function saveHeader() {
    if (!header) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/offer-groups/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buyer_name: header.buyer_name ?? null,
          buyer_code: header.buyer_code ?? null,
          currency: header.currency ?? "USD",
          status: header.status ?? "DRAFT",
          title: header.title ?? null,
          memo: header.memo ?? null,
        }),
      });
      const j = await r.json();
      if (!j?.success) throw new Error(j?.error || "Failed");
      setHeader(j.row);
      alert("Saved");
    } catch (e: any) {
      alert(e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function addItem() {
    if (!newStyle.trim()) return alert("style no is required");
    setLoading(true);
    try {
      const r = await fetch(`/api/offer-groups/${id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              style_no: newStyle.trim(),
              image_url: newImageUrl.trim() || null,
              material_summary: null,
              size_summary: null,
              remark: null,
            },
          ],
        }),
      });
      const j = await r.json();
      if (!j?.success) throw new Error(j?.error || "Failed");
      setNewStyle("");
      setNewImageUrl("");
      await load();
    } catch (e: any) {
      alert(e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function searchCostings(q: string) {
    setPickLoading(true);
    try {
      const r = await fetch(`/api/costings/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      const j = await r.json();
      if (!j?.success) throw new Error(j?.error || "Failed");
      setPickRows(j.rows || []);
    } catch (e: any) {
      alert(e?.message || "Failed");
    } finally {
      setPickLoading(false);
    }
  }

  async function addFromCosting(costing_id: string) {
    if (!costing_id) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/offer-groups/${id}/items/from-costing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ costing_id }),
      });
      const j = await r.json();
      if (!j?.success) throw new Error(j?.error || "Failed");
      setPickOpen(false);
      setPickQ("");
      setPickRows([]);
      await load();
    } catch (e: any) {
      alert(e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function removeItem(item_id: string) {
    if (!confirm("Delete this item?")) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/offer-groups/${id}/items`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id }),
      });
      const j = await r.json();
      if (!j?.success) throw new Error(j?.error || "Failed");
      await load();
    } catch (e: any) {
      alert(e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function saveItemsAndPackages() {
    setLoading(true);
    try {
      const r = await fetch(`/api/offer-groups/${id}/items`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items,
          packages: packages.map((p) => ({
            item_id: p.item_id,
            package_type: p.package_type,
            currency: header?.currency ?? "USD",
            fob_price: n(p.fob_price, 0),
            moq: n(p.moq, 0),
          })),
        }),
      });
      const j = await r.json();
      if (!j?.success) throw new Error(j?.error || "Failed");
      alert("Saved");
      await load();
    } catch (e: any) {
      alert(e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }

  function exportXlsx() {
    window.open(`/api/offer-groups/${id}/export/xlsx`, "_blank");
  }

  if (!header) {
    return (
      <AppShell>
        <div className="p-6">{loading ? "Loading..." : "No data"}</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-semibold">Offer Group</div>
            <div className="text-sm text-muted-foreground">{header.id}</div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push("/offer-groups")}>Back</Button>
            <Button variant="outline" onClick={exportXlsx}>Export XLSX</Button>
            <Button onClick={saveHeader} disabled={loading}>Save Header</Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Header</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Buyer Name</div>
                <Input value={header.buyer_name ?? ""} onChange={(e) => setHeader({ ...header, buyer_name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Buyer Code</div>
                <Input value={header.buyer_code ?? ""} onChange={(e) => setHeader({ ...header, buyer_code: e.target.value })} />
              </div>
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Currency</div>
                <Input value={header.currency ?? "USD"} onChange={(e) => setHeader({ ...header, currency: e.target.value })} />
              </div>
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Status</div>
                <Input value={header.status ?? "DRAFT"} onChange={(e) => setHeader({ ...header, status: e.target.value })} />
                <div className="text-xs text-muted-foreground mt-1">
                  <Badge variant="secondary">{header.status ?? "DRAFT"}</Badge>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Title</div>
                <Input value={header.title ?? ""} onChange={(e) => setHeader({ ...header, title: e.target.value })} />
              </div>
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Memo</div>
                <Textarea value={header.memo ?? ""} onChange={(e) => setHeader({ ...header, memo: e.target.value })} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Add Style</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Style No</div>
                <Input value={newStyle} onChange={(e) => setNewStyle(e.target.value)} placeholder="e.g. JB14626" />
              </div>
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Image URL (optional)</div>
                <Input value={newImageUrl} onChange={(e) => setNewImageUrl(e.target.value)} placeholder="https://..." />
              </div>
              <div className="flex items-end gap-2">
                <Button variant="outline" onClick={() => setPickOpen(true)} disabled={loading}>Pick from Costings</Button>
                <Button onClick={addItem} disabled={loading}>Add Manual</Button>
              </div>
            </div>
            <div className="text-xs text-muted-foreground mt-2">
              Tip: "Pick from Costings" searches by style no and adds the selected costing as an item (with auto-filled info when possible).
            </div>
          </CardContent>
        </Card>

        {pickOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-3xl rounded-xl bg-white p-4 shadow-lg">
              <div className="flex items-center justify-between">
                <div className="text-lg font-semibold">Pick from Costings</div>
                <Button variant="outline" onClick={() => setPickOpen(false)}>Close</Button>
              </div>
              <div className="mt-3 flex gap-2">
                <Input
                  value={pickQ}
                  onChange={(e) => setPickQ(e.target.value)}
                  placeholder="Search style no... (e.g. JB14626)"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") searchCostings(pickQ.trim());
                  }}
                />
                <Button
                  onClick={() => searchCostings(pickQ.trim())}
                  disabled={pickLoading}
                >
                  {pickLoading ? "Searching..." : "Search"}
                </Button>
              </div>

              <div className="mt-3 overflow-auto max-h-[60vh]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[160px]">Style</TableHead>
                      <TableHead className="w-[120px]">Stage</TableHead>
                      <TableHead className="w-[80px]">Ver</TableHead>
                      <TableHead className="w-[120px]">Status</TableHead>
                      <TableHead className="w-[120px]">Total USD</TableHead>
                      <TableHead className="w-[140px]">Updated</TableHead>
                      <TableHead className="w-[110px]">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pickRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-sm text-muted-foreground">
                          {pickLoading ? "" : "No results"}
                        </TableCell>
                      </TableRow>
                    ) : (
                      pickRows.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">{r.style_no ?? ""}</TableCell>
                          <TableCell>{r.stage ?? ""}</TableCell>
                          <TableCell>{(r.version_no ?? "") as any}</TableCell>
                          <TableCell>{r.status ?? ""}</TableCell>
                          <TableCell>{r.total_cost_usd ?? ""}</TableCell>
                          <TableCell>{r.updated_at ? String(r.updated_at).slice(0, 10) : ""}</TableCell>
                          <TableCell>
                            <Button onClick={() => addFromCosting(r.id)} disabled={loading}>Add</Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Items</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm text-muted-foreground">
                Package columns: {packageTypes.join(", ")}
              </div>
              <Button onClick={saveItemsAndPackages} disabled={loading}>Save Items</Button>
            </div>

            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[60px]">No</TableHead>
                    <TableHead className="w-[140px]">Style</TableHead>
                    <TableHead className="w-[240px]">Image URL</TableHead>
                    <TableHead className="w-[200px]">Material</TableHead>
                    <TableHead className="w-[140px]">Size</TableHead>
                    <TableHead className="w-[240px]">Remark</TableHead>
                    {packageTypes.map((pt) => (
                      <React.Fragment key={pt}>
                        <TableHead className="w-[120px]">{pt} FOB</TableHead>
                        <TableHead className="w-[120px]">{pt} MOQ</TableHead>
                      </React.Fragment>
                    ))}
                    <TableHead className="w-[90px]">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it, idx) => (
                    <TableRow key={it.id}>
                      <TableCell>
                        <Input
                          value={String(it.sort_no ?? idx + 1)}
                          onChange={(e) => {
                            const v = n(e.target.value, idx + 1);
                            setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, sort_no: v } : x)));
                          }}
                        />
                      </TableCell>

                      <TableCell>
                        <Input
                          value={it.style_no ?? ""}
                          onChange={(e) => setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, style_no: e.target.value } : x)))}
                        />
                      </TableCell>

                      <TableCell>
                        <Input
                          value={it.image_url ?? ""}
                          onChange={(e) => setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, image_url: e.target.value } : x)))}
                        />
                      </TableCell>

                      <TableCell>
                        <Input
                          value={it.material_summary ?? ""}
                          onChange={(e) => setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, material_summary: e.target.value } : x)))}
                          placeholder="e.g. Brass / CZ"
                        />
                      </TableCell>

                      <TableCell>
                        <Input
                          value={it.size_summary ?? ""}
                          onChange={(e) => setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, size_summary: e.target.value } : x)))}
                          placeholder="e.g. 12mm"
                        />
                      </TableCell>

                      <TableCell>
                        <Input
                          value={it.remark ?? ""}
                          onChange={(e) => setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, remark: e.target.value } : x)))}
                          placeholder="e.g. sample request"
                        />
                      </TableCell>

                      {packageTypes.map((pt) => {
                        const p = getPkg(it.id, pt);
                        return (
                          <React.Fragment key={pt}>
                            <TableCell>
                              <Input
                                value={String(p.fob_price ?? "")}
                                onChange={(e) => setPkg(it.id, pt, { fob_price: e.target.value })}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                value={String(p.moq ?? "")}
                                onChange={(e) => setPkg(it.id, pt, { moq: e.target.value })}
                              />
                            </TableCell>
                          </React.Fragment>
                        );
                      })}

                      <TableCell>
                        <Button variant="destructive" onClick={() => removeItem(it.id)} disabled={loading}>
                          Del
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}

                  {items.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7 + packageTypes.length * 2} className="text-center text-muted-foreground">
                        No items
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="text-xs text-muted-foreground mt-3">
              Tip: Change sort_no to reorder rows, then click Save Items.
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
