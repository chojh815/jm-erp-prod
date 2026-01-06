// src/app/roles/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { MENU_SECTIONS } from "@/config/menuConfig";

type AppRole = "admin" | "manager" | "staff" | "viewer";

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function uniqSorted(xs: string[]) {
  return Array.from(new Set(xs)).sort((a, b) => a.localeCompare(b));
}

function collectAllPermsFromMenu(): string[] {
  const perms: string[] = [];
  for (const sec of MENU_SECTIONS) {
    for (const it of sec.items) {
      const p: any = (it as any).perm;
      if (!p) continue;
      if (Array.isArray(p)) perms.push(...p.map(String));
      else perms.push(String(p));
    }
  }
  return uniqSorted(perms.filter(Boolean));
}

async function apiGetRole(role: AppRole) {
  const res = await fetch(`/api/admin/roles/permissions?role=${role}`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.success) {
    throw new Error(json?.error ?? "Failed to load role permissions");
  }
  return (json.permissions ?? []) as string[];
}

async function apiSaveRole(role: AppRole, permissions: string[]) {
  const res = await fetch(`/api/admin/roles/permissions`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, permissions }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.success) {
    throw new Error(json?.error ?? "Failed to save role permissions");
  }
  return (json.permissions ?? permissions) as string[];
}

export default function RolesPage() {
  const roles: AppRole[] = ["admin", "manager", "staff", "viewer"];

  const allPerms = useMemo(() => collectAllPermsFromMenu(), []);
  const [selectedRole, setSelectedRole] = useState<AppRole>("manager");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const visiblePerms = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allPerms;
    return allPerms.filter((p) => p.toLowerCase().includes(q));
  }, [allPerms, search]);

  const selectedCount = checked.size;

  // role 변경시 불러오기
  useEffect(() => {
    let mounted = true;
    setLoading(true);

    apiGetRole(selectedRole)
      .then((perms) => {
        if (!mounted) return;
        setChecked(new Set(perms));
        setLoading(false);
      })
      .catch(() => {
        if (!mounted) return;
        setChecked(new Set()); // 없으면 빈 값
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [selectedRole]);

  function togglePerm(p: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  function selectAllVisible() {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const p of visiblePerms) next.add(p);
      return next;
    });
  }

  function clearAll() {
    setChecked(new Set());
  }

  async function onSave() {
    try {
      setSaving(true);
      const perms = Array.from(checked);
      const saved = await apiSaveRole(selectedRole, perms);
      setChecked(new Set(saved));
      alert("Saved!");
    } catch (e: any) {
      alert(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6">
      <div className="mb-2">
        <div className="text-2xl font-semibold">Roles & Permissions</div>
        <div className="text-sm text-slate-500">Manage access levels and permissions.</div>
      </div>

      <div className="mt-6 grid grid-cols-12 gap-6">
        {/* Left: Roles */}
        <div className="col-span-12 md:col-span-3">
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="font-semibold mb-3">Roles</div>

            <div className="space-y-2">
              {roles.map((r) => {
                const active = r === selectedRole;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setSelectedRole(r)}
                    className={cx(
                      "w-full text-left rounded-lg px-3 py-2 text-sm border",
                      active
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white text-slate-800 hover:bg-slate-50"
                    )}
                  >
                    {r}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 pt-4 border-t flex items-center justify-between text-sm">
              <div className="text-slate-500">Selected</div>
              <div className="font-semibold">{selectedCount}</div>
            </div>

            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className={cx(
                "mt-4 w-full rounded-lg px-3 py-2 text-sm font-semibold",
                saving ? "bg-slate-300 text-slate-600" : "bg-slate-900 text-white hover:bg-slate-800"
              )}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>

        {/* Right: Permissions */}
        <div className="col-span-12 md:col-span-9">
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold">Permissions</div>
                <div className="text-sm text-slate-500">Role: <span className="font-semibold text-slate-700">{selectedRole}</span></div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search permissions..."
                  className="h-9 w-[260px] rounded-md border px-3 text-sm"
                />
                <button
                  type="button"
                  onClick={selectAllVisible}
                  className="h-9 rounded-md border px-3 text-sm hover:bg-slate-50"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={clearAll}
                  className="h-9 rounded-md border px-3 text-sm hover:bg-slate-50"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="mt-4 border-t pt-4">
              {loading ? (
                <div className="text-sm text-slate-500">Loading...</div>
              ) : visiblePerms.length === 0 ? (
                <div className="text-sm text-slate-500">No permissions found.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {visiblePerms.map((p) => {
                    const on = checked.has(p);
                    return (
                      <label
                        key={p}
                        className={cx(
                          "flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer",
                          on ? "bg-slate-50" : "bg-white"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => togglePerm(p)}
                        />
                        <span className="truncate" title={p}>{p}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-4 text-xs text-slate-500">
              * Permission list is auto-generated from <code className="px-1 py-0.5 rounded bg-slate-100">menuConfig.ts</code>.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
