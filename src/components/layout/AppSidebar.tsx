"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AppRole, MenuSection } from "@/config/menuConfig";
import { filterMenuByRole } from "@/config/menuConfig";
import Image from "next/image";

interface AppSidebarProps {
  role: AppRole;
}

export function AppSidebar({ role }: AppSidebarProps) {
  const pathname = usePathname();
  const sections: MenuSection[] = filterMenuByRole(role);

  return (
    <aside className="h-screen w-60 border-r bg-white flex flex-col">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-3 border-b">
        <Image
          src="/images/jm_logo.png"
          alt="JM International"
          width={32}
          height={32}
        />
        <div className="leading-tight">
          <p className="text-xs font-semibold">JM International ERP</p>
          <p className="text-[11px] text-slate-500 italic">
            Excellence in Every Detail
          </p>
        </div>
      </div>

      {/* Menu */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 text-sm">
        {sections.map((section) => (
          <div key={section.label} className="mb-4">
            {/* 대분류 헤더 */}
            <div className="mt-3 mb-1 px-2 py-1 rounded-md bg-slate-100">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">
                {section.label}
              </span>
            </div>

            <div className="space-y-1">
              {section.items.map((item) => {
                const active =
                  pathname === item.href ||
                  pathname.startsWith(item.href + "/");

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={[
                      "flex items-center rounded-md px-2 py-1.5 transition-colors",
                      active
                        ? "bg-slate-900 text-white"
                        : "text-slate-700 hover:bg-slate-100",
                    ].join(" ")}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Role Display */}
      <div className="border-t px-3 py-2 text-[11px] text-slate-500">
        Role: <span className="font-semibold">{role}</span>
      </div>
    </aside>
  );
}
