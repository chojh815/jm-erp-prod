"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SignOutBtn() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const onSignOut = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/auth/signout", { method: "POST" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Sign out failed (${res.status})`);
      }
      // 세션 쿠키 삭제 후 클라이언트 상태 갱신
      router.push("/login");
      router.refresh();
    } catch (e: any) {
      alert(e?.message ?? "Sign out failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={onSignOut}
      disabled={loading}
      className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
      aria-label="Sign out"
    >
      {loading ? "Signing out..." : "Sign out"}
    </button>
  );
}
