"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type MePermissionsResponse = {
  success: boolean;
  email?: string;
  role?: string;
  permissions?: string[];
  error?: string;
};

type PermissionInput = string | string[] | undefined;

type PermissionsContextValue = {
  loading: boolean;
  error: string | null;
  email: string | null;
  role: string | null;
  permissions: string[];
  has: (perm?: PermissionInput) => boolean;
  refresh: () => Promise<void>;
};

const PermissionsContext = createContext<PermissionsContextValue | null>(null);

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/me/permissions", {
        method: "GET",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });

      // 401/403 등도 json일 수 있어서 일단 파싱 시도
      let data: MePermissionsResponse | null = null;
      try {
        data = (await res.json()) as MePermissionsResponse;
      } catch {
        data = null;
      }

      if (!res.ok || !data?.success) {
        const msg = data?.error || `Failed to load permissions (${res.status})`;
        setEmail(null);
        setRole(null);
        setPermissions([]);
        setError(msg);
        return;
      }

      setEmail(data.email ?? null);
      setRole(data.role ?? null);
      setPermissions(Array.isArray(data.permissions) ? data.permissions : []);
    } catch (e: any) {
      setEmail(null);
      setRole(null);
      setPermissions([]);
      setError(e?.message || "Failed to load permissions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const has = useCallback(
    (perm?: PermissionInput) => {
      // perm이 없으면: 모두에게 허용 (메뉴/버튼 공통 원칙)
      if (!perm) return true;

      // admin이면: 기본적으로 전부 허용 (원치 않으면 이 줄 삭제)
      if (role === "admin") return true;

      // permissions 리스트가 없으면 false
      if (!permissions || permissions.length === 0) return false;

      // perm이 string이면 포함 체크
      if (typeof perm === "string") return permissions.includes(perm);

      // perm이 string[]이면 OR 로 처리 (배열 중 하나라도 있으면 true)
      if (Array.isArray(perm)) return perm.some((p) => permissions.includes(p));

      return false;
    },
    [permissions, role]
  );

  const value = useMemo<PermissionsContextValue>(
    () => ({
      loading,
      error,
      email,
      role,
      permissions,
      has,
      refresh: load,
    }),
    [loading, error, email, role, permissions, has, load]
  );

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) {
    throw new Error("usePermissions must be used within <PermissionsProvider />");
  }
  return ctx;
}
