// src/components/layout/Header.tsx
import HeaderClient from "./HeaderClient";

export default async function Header() {
  const { createSupabaseServerClient } = await import("@/lib/supabaseServer");
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <HeaderClient user={user} />;
}
