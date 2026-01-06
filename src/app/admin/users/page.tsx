// src/app/admin/users/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { MENU_SECTIONS } from "@/config/menuConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type UserProfileRow = {
  user_id: string;
  email: string | null;
  name: string | null;
  role: string | null;
  is_active: boolean | null;
};

type OverrideRow = {
  user_id: string;
  perm_key: string;
  allowed: boolean;
  updated_at?: string | null;
};

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

function getAllPermissionKeysFromMenu(): string[] {
  const keys: string[] = [];
  for (const sec of MENU_SECTIONS) {
    for (const it of sec.items) {
      const p: any = (it as any).perm;
      if (!p) continue;
      if (Array.isArray(p)) p.forEach((x) => keys.push(String(x)));
      else keys.push(String(p));
    }
  }
  return uniq(keys).sort();
}

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

/**
 * 상태:
 * - "default": 오버라이드 없음 (role 기본값 그대로)
 * - "allow":   allowed=true  (개인 추가 +)
 * - "deny":    allowed=false (개인 차단 -)
 */
type OverrideState = "default" | "allow" | "deny";

export default function AdminUsersPage() {
  const allPermKeys = useMemo(() => getAllPermissionKeysFromMenu(), []);
  const [q, setQ] = useState("");

  const [users, setUsers] = useState<UserProfileRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const selectedUser = useMemo(
    () => users.find((u) => u.user_id === selectedUserId) || null,
    [users, selectedUserId]
  );

  const [rolePerms, setRolePerms] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map()); // perm_key -> allowed
  const [loadingPerms, setLoadingPerms] = useState(false);

  // UI에서 바로 반영하기 위한 로컬 dirty 상태(perm_key -> state)
  const [localState, setLocalState] = useState<Map<string, OverrideState>>(new Map());
  const [saving, setSaving] = useState(false);

  const filteredUsers = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return users;
    return users.filter((u) => {
      const hay = `${u.email ?? ""} ${u.name ?? ""} ${u.role ?? ""}`.toLowerCase();
      return hay.includes(qq);
    });
  }, [users, q]);

  // 1) 유저 목록 로드
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setLoadingUsers(true);

        // ✅ user_profiles는 supabaseAdmin으로 관리할 거라, 서버 API가 있으면 그걸 쓰는게 정석.
        // 지금은 간단히 "admin API 하나 더 만들지 않고" roles/permissions 작업 계속하려고,
        // 이미 존재할 가능성이 큰 /api/admin/users/list 가 없을 수 있으니,
        // 아래는 "임시"로 /api/admin/users/list 를 기대하지 않고,
        // user_profiles가 공개되지 않았으면 실패할 수 있음.
        //
        // ✅ 안전하게 가려면 다음 턴에 /api/admin/users/list 도 만들어주면 된다.
        //
        const res = await fetch("/api/admin/users/list", { cache: "no-store", credentials: "include" });
        if (!res.ok) {
          // 최소 안내용
          if (!mounted) return;
          setUsers([]);
          setSelectedUserId("");
          setLoadingUsers(false);
          return;
        }

        const json = await res.json();
        if (!mounted) return;

        const rows = (json?.users ?? json?.data ?? []) as UserProfileRow[];
        setUsers(Array.isArray(rows) ? rows : []);
        setSelectedUserId(Array.isArray(rows) && rows.length ? rows[0].user_id : "");
        setLoadingUsers(false);
      } catch {
        if (!mounted) return;
        setUsers([]);
        setSelectedUserId("");
        setLoadingUsers(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  // 2) 선택 유저 바뀌면: role 기본 perms + 개인 overrides 로드
  useEffect(() => {
    if (!selectedUserId || !selectedUser?.role) return;

    let mounted = true;

    (async () => {
      try {
        setLoadingPerms(true);
        setLocalState(new Map()); // 유저 바뀌면 dirty 초기화

        // (A) role 기본 perms
        const role = String(selectedUser.role || "viewer").toLowerCase();
        const rRes = await fetch(`/api/admin/roles/permissions?role=${encodeURIComponent(role)}`, {
          cache: "no-store",
          credentials: "include",
        });

        const rJson = rRes.ok ? await rRes.json() : null;
        const rp: string[] = Array.isArray(rJson?.permissions) ? rJson.permissions : [];
        const roleSet = new Set(rp.map(String));
        if (!mounted) return;
        setRolePerms(roleSet);

        // (B) user overrides
        const oRes = await fetch(
          `/api/admin/users/permission-overrides?user_id=${encodeURIComponent(selectedUserId)}`,
          { cache: "no-store", credentials: "include" }
        );
        const oJson = oRes.ok ? await oRes.json() : null;
        const ov: OverrideRow[] = Array.isArray(oJson?.overrides) ? oJson.overrides : [];
        const map = new Map<string, boolean>();
        for (const r of ov) map.set(String(r.perm_key), Boolean(r.allowed));

        if (!mounted) return;
        setOverrides(map);

        setLoadingPerms(false);
      } catch {
        if (!mounted) return;
        setRolePerms(new Set());
        setOverrides(new Map());
        setLoadingPerms(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [selectedUserId, selectedUser?.role]);

  function getEffectiveAllowed(perm: string): boolean {
    // 개인 override가 있으면 우선
    if (localState.has(perm)) {
      const st = localState.get(perm)!;
      if (st === "allow") return true;
      if (st === "deny") return false;
      // default면 아래로
    } else if (overrides.has(perm)) {
      return Boolean(overrides.get(perm));
    }

    // 없으면 role 기본
    return rolePerms.has(perm);
  }

  function getCurrentState(perm: string): OverrideState {
    if (localState.has(perm)) return localState.get(perm)!;
    if (!overrides.has(perm)) return "default";
    return overrides.get(perm) ? "allow" : "deny";
  }

  function cycleState(perm: string) {
    // default -> allow -> deny -> default
    const cur = getCurrentState(perm);
    const next: OverrideState =
      cur === "default" ? "allow" : cur === "allow" ? "deny" : "default";

    const m = new Map(localState);
    m.set(perm, next);
    setLocalState(m);
  }

  async function saveChanges() {
    if (!selectedUserId) return;
    setSaving(true);

    try {
      // localState만 저장 대상으로 처리
      const entries = Array.from(localState.entries());

      for (const [perm_key, st] of entries) {
        if (st === "default") {
          // override 삭제
          await fetch(
            `/api/admin/users/permission-overrides?user_id=${encodeURIComponent(
              selectedUserId
            )}&perm_key=${encodeURIComponent(perm_key)}`,
            { method: "DELETE", credentials: "include" }
          );
        } else {
          await fetch("/api/admin/users/permission-overrides", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              user_id: selectedUserId,
              perm_key,
              allowed: st === "allow",
            }),
          });
        }
      }

      // 저장 후 다시 로드(서버 값 기준으로 정리)
      const oRes = await fetch(
        `/api/admin/users/permission-overrides?user_id=${encodeURIComponent(selectedUserId)}`,
        { cache: "no-store", credentials: "include" }
      );
      const oJson = oRes.ok ? await oRes.json() : null;
      const ov: OverrideRow[] = Array.isArray(oJson?.overrides) ? oJson.overrides : [];
      const map = new Map<string, boolean>();
      for (const r of ov) map.set(String(r.perm_key), Boolean(r.allowed));
      setOverrides(map);
      setLocalState(new Map());
    } finally {
      setSaving(false);
    }
  }

  const permSearch = useMemo(() => q.trim().toLowerCase(), [q]);
  const filteredPerms = useMemo(() => {
    if (!permSearch) return allPermKeys;
    return allPermKeys.filter((k) => k.toLowerCase().includes(permSearch));
  }, [allPermKeys, permSearch]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-2xl font-semibold">ERP Users</div>
          <div className="text-sm text-slate-500">
            Admin only: manage user permission overrides (+ / -)
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Users list */}
        <div className="col-span-4 border rounded-lg bg-white">
          <div className="p-3 border-b">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search users or permissions..."
            />
          </div>

          <div className="max-h-[70vh] overflow-auto p-2 space-y-1">
            {loadingUsers ? (
              <div className="p-3 text-sm text-slate-500">Loading users...</div>
            ) : filteredUsers.length === 0 ? (
              <div className="p-3 text-sm text-slate-500">
                No users. (If this is empty, create /api/admin/users/list next.)
              </div>
            ) : (
              filteredUsers.map((u) => {
                const active = u.user_id === selectedUserId;
                return (
                  <button
                    key={u.user_id}
                    className={cx(
                      "w-full text-left rounded-md px-3 py-2 border transition",
                      active ? "bg-slate-900 text-white" : "bg-white hover:bg-slate-50"
                    )}
                    onClick={() => setSelectedUserId(u.user_id)}
                  >
                    <div className="text-sm font-medium">{u.email || "(no email)"}</div>
                    <div className={cx("text-xs", active ? "text-white/80" : "text-slate-500")}>
                      {u.name || "-"} · role: {u.role || "viewer"} ·{" "}
                      {u.is_active === false ? "inactive" : "active"}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Overrides */}
        <div className="col-span-8 border rounded-lg bg-white">
          <div className="p-4 border-b flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold">Permission Overrides</div>
              <div className="text-sm text-slate-500">
                User: <span className="font-medium">{selectedUser?.email || "-"}</span>{" "}
                · role: <span className="font-medium">{selectedUser?.role || "viewer"}</span>
              </div>
            </div>

            <Button onClick={saveChanges} disabled={saving || localState.size === 0}>
              {saving ? "Saving..." : `Save (${localState.size})`}
            </Button>
          </div>

          <div className="p-4">
            <div className="text-xs text-slate-500 mb-3">
              Click a permission to cycle: <b>Default</b> → <b>+ Allow</b> → <b>- Deny</b> → Default
            </div>

            {loadingPerms ? (
              <div className="text-sm text-slate-500">Loading permissions...</div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {filteredPerms.map((perm) => {
                  const st = getCurrentState(perm);
                  const effective = getEffectiveAllowed(perm);

                  const badge =
                    st === "default"
                      ? rolePerms.has(perm)
                        ? "Default(ON)"
                        : "Default(OFF)"
                      : st === "allow"
                      ? "+ Allow"
                      : "- Deny";

                  return (
                    <button
                      key={perm}
                      className={cx(
                        "border rounded-md px-3 py-2 text-left hover:bg-slate-50 transition",
                        st === "allow" && "border-green-500",
                        st === "deny" && "border-red-500"
                      )}
                      onClick={() => cycleState(perm)}
                      title="Click to cycle override state"
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium">{perm}</div>
                        <div
                          className={cx(
                            "text-xs px-2 py-0.5 rounded",
                            st === "default" && "bg-slate-100 text-slate-700",
                            st === "allow" && "bg-green-100 text-green-700",
                            st === "deny" && "bg-red-100 text-red-700"
                          )}
                        >
                          {badge}
                        </div>
                      </div>

                      <div className="mt-1 text-xs text-slate-500">
                        Effective:{" "}
                        <span className={effective ? "text-green-700" : "text-red-700"}>
                          {effective ? "ALLOWED" : "DENIED"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-4 text-xs text-slate-500">
              * Permission list is auto-generated from <b>menuConfig.ts</b>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
