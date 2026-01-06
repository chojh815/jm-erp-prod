// src/hooks/usePermissions.tsx
"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

type PermissionApiResp = {
  ok?: boolean;
  success?: boolean;

  // old format
  role?: string;
  permissions?: string[];
  perms?: string[];

  // new format
  user?: {
    id?: string;
    email?: string | null;
    name?: string | null;
    role?: string;
  };
  overrides?: any;

  data?: {
    role?: string;
    permissions?: string[];
    perms?: string[];
    user?: { role?: string };
  };

  error?: string;
};

function normalizePerms(json: PermissionApiResp | any): string[] {
  const p =
    json?.permissions ??
    json?.perms ??
    json?.user?.permissions ?? // (혹시 미래 확장)
    json?.data?.permissions ??
    json?.data?.perms ??
    [];
  return Array.isArray(p) ? p.map(String).filter(Boolean) : [];
}

function normalizeRole(json: PermissionApiResp | any): string {
  const r =
    json?.role ??
    json?.user?.role ??
    json?.data?.role ??
    json?.data?.user?.role ??
    "viewer";
  const s = String(r ?? "viewer").toLowerCase();
  return s || "viewer";
}

export type PermArg = string | string[];

type PermissionsState = {
  loading: boolean;
  role: string;
  permissions: string[];
  permSet: Set<string>;
  has: (perm?: PermArg) => boolean;
  refresh: () => Promise<void>;
};

const PermissionsCtx = createContext<PermissionsState | null>(null);

async function fetchMePermissions(): Promise<PermissionApiResp> {
  const res = await fetch("/api/me/permissions", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });

  // 401/403/500 등도 json 파싱 시도
  const json = await res.json().catch(() => ({}));
  return json;
}

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState("viewer");
  const [permissions, setPermissions] = useState<string[]>([]);

  const refresh = async () => {
    setLoading(true);
    try {
      const json = await fetchMePermissions();
      setRole(normalizeRole(json));
      setPermissions(normalizePerms(json));
    } catch {
      setRole("viewer");
      setPermissions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const permSet = useMemo(() => new Set(permissions), [permissions]);

  const has = (perm?: PermArg) => {
    if (!perm) return true;
    if (Array.isArray(perm)) return perm.some((p) => permSet.has(String(p)));
    return permSet.has(String(perm));
  };

  const value: PermissionsState = {
    loading,
    role,
    permissions,
    permSet,
    has,
    refresh,
  };

  return <PermissionsCtx.Provider value={value}>{children}</PermissionsCtx.Provider>;
}

export function usePermissions() {
  const ctx = useContext(PermissionsCtx);
  if (!ctx) {
    // Provider 없이 호출해도 죽지 않게 “최소 안전값”
    const emptySet = new Set<string>();
    return {
      loading: false,
      role: "viewer",
      permissions: [] as string[],
      permSet: emptySet,
      has: (_perm?: PermArg) => false,
      refresh: async () => {},
    };
  }
  return ctx;
}
