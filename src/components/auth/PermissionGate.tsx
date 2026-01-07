// src/components/auth/PermissionGate.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";

type Need = string | string[];

export interface PermissionGateOptions {
  loginRedirectTo?: string;
  denyRedirectTo?: string;
  /**
   * default true: 로딩중이면 아무것도 안보이고 대기
   */
  blockWhileLoading?: boolean;
  /**
   * default true: 허용되기 전엔 children 렌더링 숨김
   */
  hideChildrenUntilAllowed?: boolean;
}

function normalizeNeed(need: Need): string[] {
  return Array.isArray(need) ? need : [need];
}

export default function PermissionGate({
  need,
  options,
  children,
}: {
  need: Need;
  options?: PermissionGateOptions;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { loading, has } = usePermissions(); // ✅ status 제거

  const needs = React.useMemo(() => normalizeNeed(need), [need]);

  // ✅ status 없이, 권한 보유 여부만으로 판단
  const allow = React.useMemo(() => {
    return needs.some((p) => has(p));
  }, [needs, has]);

  const didRedirectRef = React.useRef(false);

  React.useEffect(() => {
    const block = options?.blockWhileLoading ?? true;
    if (block && loading) return;
    if (didRedirectRef.current) return;

    // ✅ loading이 끝났는데 허용 안되면 deny로 보냄
    if (!allow) {
      didRedirectRef.current = true;
      router.replace(options?.denyRedirectTo ?? "/home");
      return;
    }
  }, [loading, allow, router, options?.blockWhileLoading, options?.denyRedirectTo]);

  const hide = options?.hideChildrenUntilAllowed ?? true;
  if (hide && (loading || !allow)) return null;

  return <>{children}</>;
}
