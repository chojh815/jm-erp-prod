"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import SignOutBtn from "@/components/auth/SignOutBtn";

/**
 * HeaderClient – Black Chrome (Option A)
 * - Logo size slightly increased (40px)
 * - Thin shine line for subtle premium look
 * - Home route: /home (prevents login flash)
 */
export default function HeaderClient({ user }: { user: any }) {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <header className="flex items-center justify-between p-3 border-b bg-white">
      <Link
        href="/home"
        prefetch={false}
        className="flex items-center gap-3 select-none group"
        aria-label="Go to Home"
      >
        {/* Black Chrome Logo Badge */}
        <div
          className="relative h-10 w-10 rounded-xl overflow-hidden shadow-[0_6px_18px_rgba(0,0,0,0.18)]"
          aria-hidden="true"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-zinc-950 via-zinc-700 to-zinc-950" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.22),transparent_55%)]" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/35" />
          <div className="absolute inset-0 rounded-xl ring-1 ring-white/10" />
          <div className="absolute inset-0 rounded-xl ring-1 ring-black/35" />

          {/* Thin shine */}
          <div
            className="absolute -inset-x-6 top-0 bottom-0 rotate-12
                       bg-gradient-to-r from-transparent via-white/35 to-transparent
                       opacity-0 group-hover:opacity-100
                       [animation:jmShineThin_2.8s_ease-in-out_infinite]
                       motion-reduce:animate-none"
          />

          <div className="relative z-10 h-full w-full flex items-center justify-center">
            <span className="text-[12px] font-bold tracking-tight text-white drop-shadow-sm">
              JM
            </span>
          </div>
        </div>

        {/* Text */}
        <div className="flex flex-col leading-tight">
          <div className="text-sm font-semibold text-slate-900 group-hover:underline">
            JM ERP
          </div>
          <div className="text-[11px] text-slate-500">
            Excellence in Every Detail
          </div>
        </div>

        <style jsx>{`
          @keyframes jmShineThin {
            0% {
              transform: translateX(-70%) rotate(12deg);
            }
            40% {
              transform: translateX(70%) rotate(12deg);
            }
            100% {
              transform: translateX(70%) rotate(12deg);
            }
          }
        `}</style>
      </Link>

      <div className="flex gap-3 items-center">
        {user ? <SignOutBtn /> : null}
      </div>
    </header>
  );
}
