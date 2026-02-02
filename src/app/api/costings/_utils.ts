import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export function getSupabaseServerClient() {
  const cookieStore = cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: any) {
      },
      remove(name: string, options: any) {
      },
    },
  });
}

export async function requireUser() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    return { supabase, user: null as any };
  }
  return { supabase, user: data.user };
}

export function asNumber(x: any, def = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : def;
}

export function coalesceText(x: any, def = "") {
  if (x === null || x === undefined) return def;
  return String(x);
}

// TEMP FX mapping (base currency = USD).
// Later we will replace this with real FX table + history (your planned FX module).
// Value means: 1 unit of <currency> equals how many USD.
export function guessFxRateToUsd(currency?: string | null): number {
  const c = (currency || "USD").toUpperCase();
  switch (c) {
    case "USD":
      return 1;
    case "CNY":
      return 0.45; // sample default
    case "KRW":
      return 0.45 / 610; // derived sample
    case "VND":
      return 0.45 / 11228; // derived sample
    default:
      return 1; // fallback
  }
}
