import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export function createSupabaseServerClient() {
  const cookieStore = cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createServerClient(url, anon, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: any) {
        try { cookieStore.set({ name, value, ...options }); } catch {}
      },
      remove(name: string, options: any) {
        try { cookieStore.set({ name, value: "", ...options }); } catch {}
      },
    },
  });
}

export async function getAuthUserOrThrow(supabase: any) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) throw new Error("Unauthorized");
  return data.user;
}
