"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import type { AppRole } from "@/config/menuConfig";
import AppShell from "@/components/layout/AppShell";

export default function RolesPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [role, setRole] = useState<AppRole | null>(null);

  useEffect(() => {
    const load = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/login?redirectTo=/roles");
        return;
      }

      const r =
        ((session.user.user_metadata as any)?.role as AppRole | undefined) ||
        "staff";
      setRole(r);
    };

    load();
  }, [supabase, router]);

  if (!role) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="text-sm text-slate-500">Loading...</div>
      </div>
    );
  }

  return (
    <AppShell
      role={role}
      title="Roles & Permissions"
      description="Manage access levels and permissions."
    >
      <div className="text-sm text-slate-600">
        Roles & Permissions page placeholder.  
        (여기에 나중에 role별 권한 설정 UI를 넣으면 돼.)
      </div>
    </AppShell>
  );
}
