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
  const { loading, status, has } = usePermissions();

  const needs = React.useMemo(() => normalizeNeed(need), [need]);
  const allow = React.useMemo(() => {
    if (status !== "authenticated") return false;
    return needs.some((p) => has(p));
  }, [status, needs, has]);

  const didRedirectRef = React.useRef(false);

  React.useEffect(() => {
    const block = options?.blockWhileLoading ?? true;
    if (block && loading) return;
    if (didRedirectRef.current) return;

    if (status === "unauthenticated") {
      didRedirectRef.current = true;
      router.replace(
        options?.loginRedirectTo ??
          `/login?redirectTo=${encodeURIComponent(location.pathname)}`
      );
      return;
    }

    if (status === "authenticated" && !allow) {
      didRedirectRef.current = true;
      router.replace(options?.denyRedirectTo ?? "/home");
      return;
    }
  }, [loading, status, allow, router, options?.blockWhileLoading, options?.loginRedirectTo, options?.denyRedirectTo]);

  const hide = options?.hideChildrenUntilAllowed ?? true;
  if (hide && (loading || !allow)) return null;

  return <>{children}</>;
}
