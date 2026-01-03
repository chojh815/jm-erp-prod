"use client";

import type { ReactNode } from "react";
import type { AppRole } from "@/config/menuConfig";
import { AppSidebar } from "./AppSidebar";

interface AppShellProps {
  /**
   * 예전 코드 호환용 (role)
   * - 일부 페이지가 <AppShell role={...}> 로 사용
   */
  role?: AppRole;

  /**
   * 신규/다른 페이지 호환용 (currentRole)
   * - 일부 페이지가 <AppShell currentRole={...}> 로 사용
   */
  currentRole?: AppRole;

  children: ReactNode;
  title?: string;
  description?: string;
}

/**
 * 공통 레이아웃: 좌측 사이드바 + 상단 헤더 + 본문
 */
export default function AppShell({
  role,
  currentRole,
  children,
  title,
  description,
}: AppShellProps) {
  // ✅ role 결정: currentRole 우선, 없으면 role, 둘 다 없으면 안전 기본값
  // 프로젝트에서 AppRole에 ADMIN 같은 값이 없다면,
  // 아래 fallback을 프로젝트에 존재하는 기본 role로 바꿔주세요.
  const resolvedRole = (currentRole ?? role ?? ("ADMIN" as AppRole));

  return (
    <div className="min-h-screen flex bg-slate-100">
      <AppSidebar role={resolvedRole} />

      <div className="flex-1 flex flex-col">
        {/* Top header */}
        <header className="border-b bg-white">
          <div className="max-w-6xl mx-auto px-6 py-3">
            {title && (
              <h1 className="text-lg font-semibold leading-tight">{title}</h1>
            )}
            {description && (
              <p className="text-xs text-slate-500 mt-0.5">{description}</p>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1">
          <div className="max-w-6xl mx-auto px-6 py-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
