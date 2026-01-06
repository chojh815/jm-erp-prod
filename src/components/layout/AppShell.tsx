"use client";

import type { ReactNode } from "react";
import type { AppRole } from "@/config/menuConfig";
import AppSidebar from "@/components/layout/AppSidebar";
import { PermissionsProvider } from "@/hooks/usePermissions";

interface AppShellProps {
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
   * ⚠️ 주의
   * - Sidebar는 기존처럼 role 기반(menuConfig)으로 유지
   * - 실제 권한 판단(Allow/Deny)은 usePermissions()에서 permissions 배열 기준
   */
  const resolvedRole = (currentRole ?? role ?? ("viewer" as AppRole));

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
