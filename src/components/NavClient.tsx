"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type Item = { href: string; label: string };

export default function NavClient({ items }: { items: Item[] }) {
  const pathname = usePathname() || "/";

  return (
    <>
      {/* Desktop */}
      <nav className="hidden md:flex items-center gap-1">
        {items.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "px-3 py-2 rounded-lg text-sm transition border",
                active
                  ? "bg-black text-white border-black"
                  : "bg-white hover:bg-muted border-border text-foreground"
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Mobile */}
      <div className="md:hidden flex gap-2 pb-3">
        {items.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "px-3 py-2 rounded-lg text-sm transition border",
                active
                  ? "bg-black text-white border-black"
                  : "bg-white hover:bg-muted border-border text-foreground"
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </>
  );
}
