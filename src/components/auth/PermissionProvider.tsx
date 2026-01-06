"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

type MePermissionsResponse = {
  ok: boolean;
  user?: { id: string; email: string | null; name: string | null; role: string };
  permissions?: string[];
  overrides?: { grants: string[]; revokes: string[] };
  error?: string;
};

type PermissionState = {
  loading: boolean;
  ok: boolean;
  role: string | null;
  permissions: Set<string>;
  has: (perm: string | string[]) => boolean;
  refresh: () => Promise<void>;
};

const PermissionContext = createContext<PermissionState | null>(null);

export function PermissionProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [ok, setOk] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [permSet, setPermSet] = useState<Set<string>>(new Set());

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/me/permissions", { cache: "no-store" });
      const json = (await res.json()) as MePermissionsResponse;

      if (!json.ok) {
        setOk(false);
        setRole(null);
        setPermSet(new Set());
      } else {
        setOk(true);
        setRole(json.user?.role ?? null);
        setPermSet(new Set(json.permissions ?? []));
      }
    } catch {
      setOk(false);
      setRole(null);
      setPermSet(new Set());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const has = (perm: string | string[]) => {
    const list = Array.isArray(perm) ? perm : [perm];
    // AND 조건: 모두 있어야 true
    return list.every((p) => permSet.has(p));
  };

  const value = useMemo<PermissionState>(
    () => ({ loading, ok, role, permissions: permSet, has, refresh }),
    [loading, ok, role, permSet]
  );

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function usePermissions() {
  const ctx = useContext(PermissionContext);
  if (!ctx) throw new Error("usePermissions must be used within PermissionProvider");
  return ctx;
}
