"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  MENU_SECTIONS,
  type MenuSection,
  type MenuItem,
} from "@/config/menuConfig";

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

/** ✅ 로딩 중 메뉴를 전부 보여줄지 */
const SHOW_ALL_WHEN_LOADING = true;

type PermissionApiResp = {
  success?: boolean;
  role?: string;
  permissions?: string[];
  perms?: string[];
  data?: {
    role?: string;
    permissions?: string[];
    perms?: string[];
  };
};

function normalizePerms(json: PermissionApiResp | any): string[] {
  const p =
    json?.permissions ??
    json?.perms ??
    json?.data?.permissions ??
    json?.data?.perms ??
    [];
  return Array.isArray(p) ? p.map(String).filter(Boolean) : [];
}

function normalizeRole(json: PermissionApiResp | any): string {
  const r = (json?.role ?? json?.data?.role ?? "viewer")
    .toString()
    .toLowerCase();
  return r || "viewer";
}

function canShowItem(item: MenuItem, permSet: Set<string>, loading: boolean) {
  if (!item.perm) return true;
  if (loading) return SHOW_ALL_WHEN_LOADING;

  if (Array.isArray(item.perm)) {
    return item.perm.some((p) => permSet.has(String(p)));
  }
  return permSet.has(String(item.perm));
}

function filterSections(
  sections: MenuSection[],
  permSet: Set<string>,
  loading: boolean
): MenuSection[] {
  return sections
    .map((sec) => ({
      ...sec,
      items: sec.items.filter((it) => canShowItem(it, permSet, loading)),
    }))
    .filter((sec) => sec.items.length > 0);
}

const SECTION_STYLE: Record<
  string,
  { header: string; dot: string; divider: string }
> = {
  HOME: {
    header: "text-slate-600",
    dot: "bg-slate-400",
    divider: "border-slate-200",
  },
  BASIC: {
    header: "text-sky-800",
    dot: "bg-sky-500",
    divider: "border-sky-200",
  },
  DEVELOPMENT: {
    header: "text-violet-800",
    dot: "bg-violet-500",
    divider: "border-violet-200",
  },
  TRADE: {
    header: "text-emerald-800",
    dot: "bg-emerald-500",
    divider: "border-emerald-200",
  },
  PRODUCTION: {
    header: "text-amber-800",
    dot: "bg-amber-500",
    divider: "border-amber-200",
  },
};

function sectionKeyOf(label: string) {
  return (label || "").toString().trim().toUpperCase();
}

/** 접힘 모드용 약어: Create PO -> C, Invoices & Packing -> I */
function abbrev(label: string) {
  const s = (label ?? "").trim();
  if (!s) return "";
  return s[0].toUpperCase();
}

/** ✅ 헤더(접혀도 로고 유지) */
function SidebarHeader({
  collapsed,
  loading,
  role,
}: {
  collapsed?: boolean;
  loading: boolean;
  role: string;
}) {
  return (
    <div
      className={cx(
        "h-14 border-b flex items-center justify-between",
        collapsed ? "px-2" : "px-4"
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div
          className={cx(
            "w-9 h-9 rounded-md border bg-white shadow-sm",
            "flex items-center justify-center font-bold text-xs"
          )}
          title="JM ERP"
        >
          JM
        </div>

        <div className={cx("min-w-0", collapsed && "hidden")}>
          <div className="font-semibold text-sm leading-4">JM ERP</div>
          <div className="text-[11px] text-slate-500 leading-4">erp.jm-i.com</div>
        </div>
      </div>

      {!collapsed && (
        <div className="text-xs text-slate-500">
          {loading ? "loading..." : role}
        </div>
      )}
    </div>
  );
}

/** ✅ 펼침 모드(기존 섹션 카드) */
function ExpandedMenu({
  pathname,
  sections,
  onNavigate,
}: {
  pathname: string;
  sections: MenuSection[];
  onNavigate?: () => void;
}) {
  const WRAP: Record<string, string> = {
    HOME: "bg-slate-50/70 border-slate-200",
    BASIC: "bg-sky-50/70 border-sky-200",
    DEVELOPMENT: "bg-violet-50/70 border-violet-200",
    TRADE: "bg-emerald-50/70 border-emerald-200",
    PRODUCTION: "bg-amber-50/70 border-amber-200",
  };

  return (
    <nav className="flex-1 overflow-auto p-3 space-y-4">
      {sections.map((sec) => {
        const key = sectionKeyOf(sec.label);
        const style = SECTION_STYLE[key] ?? SECTION_STYLE["HOME"];
        const wrap = WRAP[key] ?? WRAP["HOME"];

        return (
          <div key={sec.label} className={cx("rounded-xl border shadow-sm px-2 py-2", wrap)}>
            <div
              className={cx(
                "px-2 py-1 flex items-center gap-2",
                "text-[11px] font-semibold uppercase tracking-wide",
                style.header
              )}
            >
              <span className={cx("h-2 w-2 rounded-full", style.dot)} />
              <span>{sec.label}</span>
            </div>

            <div className="mt-2 space-y-1">
              {sec.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    className={cx(
                      "block rounded-md px-3 py-2 text-sm transition",
                      active
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-700 hover:bg-white/70"
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

/** ✅ 접힘 모드(컴팩트 리스트) */
function CollapsedMenu({
  pathname,
  sections,
  onNavigate,
}: {
  pathname: string;
  sections: MenuSection[];
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex-1 overflow-auto px-2 py-3">
      <div className="space-y-2">
        {sections.map((sec) => {
          const key = sectionKeyOf(sec.label);
          const style = SECTION_STYLE[key] ?? SECTION_STYLE["HOME"];

          return (
            <div key={sec.label} className="space-y-1">
              {/* 섹션 구분선 + 점 (카드 X) */}
              <div
                className={cx(
                  "flex items-center justify-center",
                  "py-1",
                  "border-t",
                  style.divider
                )}
                title={sec.label}
              >
                <span className={cx("h-2 w-2 rounded-full", style.dot)} />
              </div>

              {/* 아이템을 얇은 버튼 리스트로 */}
              <div className="space-y-1">
                {sec.items.map((item) => {
                  const active = isActive(pathname, item.href);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onNavigate}
                      title={item.label}
                      className={cx(
                        "relative flex items-center justify-center",
                        "h-9 rounded-md border text-sm font-semibold transition",
                        active
                          ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                      )}
                    >
                      {/* active left bar 느낌을 아주 얇게 */}
                      <span
                        className={cx(
                          "absolute left-0 top-0 h-full w-[3px] rounded-r",
                          active ? "bg-white/80" : "opacity-0"
                        )}
                      />
                      {abbrev(item.label)}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

function SidebarInner({
  pathname,
  sections,
  role,
  loading,
  onNavigate,
  collapsed,
}: {
  pathname: string;
  sections: MenuSection[];
  role: string;
  loading: boolean;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  return (
    <div className="h-full w-full bg-white flex flex-col">
      <SidebarHeader collapsed={collapsed} loading={loading} role={role} />

      {/* ✅ collapsed면 컴팩트 리스트, 아니면 기존 카드 */}
      {collapsed ? (
        <CollapsedMenu
          pathname={pathname}
          sections={sections}
          onNavigate={onNavigate}
        />
      ) : (
        <ExpandedMenu
          pathname={pathname}
          sections={sections}
          onNavigate={onNavigate}
        />
      )}

      {!collapsed && (
        <div className="border-t p-3 text-xs text-slate-500">
          <div>© JM International</div>
        </div>
      )}
    </div>
  );
}

export default function AppSidebar() {
  const pathname = usePathname();

  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string>("viewer");
  const [permissions, setPermissions] = useState<string[]>([]);

  // 모바일 오버레이
  const [mobileOpen, setMobileOpen] = useState(false);

  // 데스크탑 접기 토글 + 저장
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      const v = localStorage.getItem("sidebar_collapsed");
      if (v === "1") setCollapsed(true);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("sidebar_collapsed", collapsed ? "1" : "0");
    } catch {}
  }, [collapsed]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const res = await fetch("/api/me/permissions", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });

        if (!res.ok) {
          if (!mounted) return;
          setRole("viewer");
          setPermissions([]);
          setLoading(false);
          return;
        }

        const json: PermissionApiResp = await res.json();
        if (!mounted) return;

        setRole(normalizeRole(json));
        setPermissions(normalizePerms(json));
        setLoading(false);
      } catch {
        if (!mounted) return;
        setRole("viewer");
        setPermissions([]);
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const permSet = useMemo(() => new Set(permissions), [permissions]);
  const sections = useMemo(
    () => filterSections(MENU_SECTIONS, permSet, loading),
    [permSet, loading]
  );

  return (
    <>
      {/* ✅ 모바일: 햄버거 */}
      <button
        type="button"
        className="lg:hidden fixed left-3 top-3 z-50 rounded-md border bg-white/90 backdrop-blur px-3 py-2 text-sm shadow"
        onClick={() => setMobileOpen(true)}
        aria-label="Open sidebar"
      >
        ☰
      </button>

      {/* ✅ 모바일 오버레이(항상 펼침형으로 보여주기) */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-[280px] bg-white shadow-2xl border-r">
            <button
              type="button"
              className="absolute right-2 top-2 rounded-md border bg-white px-2 py-1 text-sm shadow"
              onClick={() => setMobileOpen(false)}
              aria-label="Close sidebar"
            >
              ✕
            </button>

            <SidebarInner
              pathname={pathname}
              sections={sections}
              role={role}
              loading={loading}
              onNavigate={() => setMobileOpen(false)}
              collapsed={false} // ✅ 모바일은 무조건 펼침형
            />
          </div>
        </div>
      )}

      {/* ✅ 데스크탑: 접기 토글 + collapsed에 따라 폭 변화 */}
      <aside
        className={cx(
          "hidden lg:flex h-screen border-r bg-white flex-col transition-[width] duration-200",
          collapsed ? "w-16" : "w-60"
        )}
      >
        {/* 토글 버튼 */}
        <div className={cx("p-2", collapsed ? "px-2" : "px-3")}>
          <button
            type="button"
            className={cx(
              "w-full rounded-md border bg-white text-xs shadow hover:bg-slate-50 py-1"
            )}
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label="Toggle sidebar"
          >
            {collapsed ? "▶" : "◀"}
          </button>
        </div>

        <SidebarInner
          pathname={pathname}
          sections={sections}
          role={role}
          loading={loading}
          collapsed={collapsed}
        />
      </aside>
    </>
  );
}
