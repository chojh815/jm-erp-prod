import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mask(v?: string | null) {
  if (!v) return null;
  const s = String(v);
  if (s.length <= 8) return "***";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function projectRefFromUrl(url?: string | null) {
  if (!url) return null;
  try {
    const u = new URL(url);
    // <ref>.supabase.co
    const host = u.hostname || "";
    const first = host.split(".")[0];
    return first || null;
  } catch {
    // if url isn't a full URL, fallback
    const s = String(url);
    const m = s.match(/https?:\/\/(.*?)\.supabase\.co/i);
    return m?.[1] ?? null;
  }
}

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null;

  const payload = {
    ok: true,
    serverTime: new Date().toISOString(),

    // Supabase (public)
    supabase: {
      url: supabaseUrl,
      projectRef: projectRefFromUrl(supabaseUrl),
      anonKeyMasked: mask(anonKey),
    },

    // Vercel build context (if available)
    vercel: {
      env: process.env.VERCEL_ENV ?? null,
      gitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      gitCommitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE ?? null,
      gitBranch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    },
  };

  return NextResponse.json(payload, {
    headers: {
      "cache-control": "no-store, max-age=0",
    },
  });
}
