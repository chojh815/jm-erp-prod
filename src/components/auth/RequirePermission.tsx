"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";

type Props = {
  perm: string | string[];
  redirectTo?: string;
  alertMessage?: string;
  children: React.ReactNode;
};

export default function RequirePermission({
  perm,
  redirectTo = "/home",
  alertMessage = "You do not have permission.",
  children,
}: Props) {
  const router = useRouter();
  const { loading, has } = usePermissions();

  const allowed =
    Array.isArray(perm) ? perm.some((p) => has(p)) : has(perm);

  useEffect(() => {
    if (loading) return;
    if (!allowed) {
      alert(alertMessage);
      router.replace(redirectTo);
    }
  }, [loading, allowed, alertMessage, redirectTo, router]);

  if (loading) return null;
  if (!allowed) return null;

  return <>{children}</>;
}
