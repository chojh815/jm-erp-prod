// src/components/layout/HeaderClient.tsx
"use client";
import { usePathname } from "next/navigation";
import SignOutBtn from "@/components/auth/SignOutBtn";

export default function HeaderClient({ user }: { user: any }) {
  const pathname = usePathname();
  if (pathname === "/login") return null; // ✅ 로그인 페이지에서 헤더 숨김

  return (
    <header className="flex justify-between p-3 border-b">
      <div>JM ERP</div>
      <div className="flex gap-3 items-center">
        {user ? <SignOutBtn /> : null}
      </div>
    </header>
  );
}
