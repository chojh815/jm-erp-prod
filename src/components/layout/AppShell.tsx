"use client";

import type { ReactNode } from "react";
import type { AppRole } from "@/config/menuConfig";
import AppSidebar from "@/components/layout/AppSidebar";
import { PermissionsProvider } from "@/hooks/usePermissions";

interface AppShellProps {
  /**
   * (Legacy/Optional) page에서 직접 role을 넘겨줄 때만 사용
   * - 안 넘기면 Sidebar는 /api/me/permissions에서 받은 실제 role을 표시
   */
  role?: AppRole;
  currentRole?: AppRole;

  children: ReactNode;
  title?: string;
  description?: string;
}

export default function AppShell({
  role,
  currentRole,
  children,
  title,
  description,
}: AppShellProps) {
  /**
   * ✅ 핵심 수정
   * 이전: role/currentRole이 없으면 "viewer"를 강제로 넣어서
   *       Sidebar 헤더에 roleProp(viewer)이 우선되어 "viewer"로 보이는 문제가 있었음.
   *
   * 이제: role을 '넘겨준 경우에만' Sidebar에 전달하고,
   *      기본은 PermissionsProvider가 fetch한 실제 role을 Sidebar에서 표시하도록 둔다.
   */
  const resolvedRole = currentRole ?? role; // undefined 가능

  return (
    <PermissionsProvider>
      <div className="min-h-screen flex bg-slate-100">
        <AppSidebar role={resolvedRole} />

        <div className="flex-1 flex flex-col">
          <header className="border-b bg-white">
            <div className="max-w-6xl mx-auto px-6 py-3">
              {title && (
                <h1 className="text-lg font-semibold leading-tight">
                  {title}
                </h1>
              )}
              {description && (
                <p className="text-xs text-slate-500 mt-0.5">
                  {description}
                </p>
              )}
            </div>
          </header>

          <main className="flex-1">
            <div className="max-w-6xl mx-auto px-6 py-6">
              {children}
            </div>
          </main>
        </div>
      </div>
    </PermissionsProvider>
  );
}
