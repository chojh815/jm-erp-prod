"use client";

import type { ReactNode } from "react";
import type { AppRole } from "@/config/menuConfig";
import { AppSidebar } from "./AppSidebar";

interface AppShellProps {
  role: AppRole;
  children: ReactNode;
  title?: string;
  description?: string;
}

/**
 * 공통 레이아웃: 좌측 사이드바 + 상단 헤더 + 본문
 */
export default function AppShell({
  role,
  children,
  title,
  description,
}: AppShellProps) {
  return (
    <div className="min-h-screen flex bg-slate-100">
      <AppSidebar role={role} />

      <div className="flex-1 flex flex-col">
        {/* Top header */}
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

        {/* Page content */}
        <main className="flex-1">
          <div className="max-w-6xl mx-auto px-6 py-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
