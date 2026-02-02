"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";

type Item = { style_no: string; name?: string | null };

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function StyleAutocompleteInput(props: {
  value: string;
  onChangeValue: (v: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { value, onChangeValue, placeholder, className, disabled } = props;

  const [q, setQ] = React.useState(value || "");
  const [items, setItems] = React.useState<Item[]>([]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [highlight, setHighlight] = React.useState(-1);

  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    setQ(value || "");
  }, [value]);

  // Close when clicking outside
  React.useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as any)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  const doSearch = React.useMemo(() => {
    let t: any;
    return (text: string) => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const query = (text || "").trim();
        if (!query) {
          setItems([]);
          setOpen(false);
          return;
        }
        setLoading(true);
        try {
          const r = await fetch(`/api/styles/search?q=${encodeURIComponent(query)}`, { cache: "no-store" });
          const j = await r.json();
          const list: Item[] = (j?.items || []).map((x: any) => ({
            style_no: String(x.style_no || "").toUpperCase(),
            name: x.name ?? null,
          }));
          setItems(list);
          setOpen(true);
          setHighlight(list.length ? 0 : -1);
        } catch {
          setItems([]);
          setOpen(false);
        } finally {
          setLoading(false);
        }
      }, 120);
    };
  }, []);

  function commit(v: string) {
    const up = (v || "").toUpperCase();
    onChangeValue(up);
    setQ(up);
    setOpen(false);
    setHighlight(-1);
    // keep focus on input for fast data entry
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <Input
        ref={inputRef}
        value={q}
        disabled={disabled}
        placeholder={placeholder || "Type to search (e.g. JK260001)"}
        onFocus={() => {
          if (items.length) setOpen(true);
          if (q.trim()) doSearch(q);
        }}
        onChange={(e) => {
          const v = e.target.value;
          setQ(v);
          doSearch(v);
        }}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            setOpen(true);
            return;
          }
          if (!open) return;

          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => {
              const n = items.length;
              if (!n) return -1;
              return (h + 1 + n) % n;
            });
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => {
              const n = items.length;
              if (!n) return -1;
              return (h - 1 + n) % n;
            });
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (highlight >= 0 && highlight < items.length) commit(items[highlight].style_no);
            else commit(q);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
          }
        }}
        onBlur={() => {
          // ✅ DO NOT immediately close on blur:
          // clicking an item causes blur first; close is handled by document mousedown/outside.
          // This is the main fix for "need to click long time".
          window.setTimeout(() => {
            if (!wrapRef.current) return;
            const active = document.activeElement;
            if (active && wrapRef.current.contains(active)) return;
            // If user didn't click a suggestion, close.
            setOpen(false);
          }, 120);
        }}
      />

      {open ? (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-background shadow-sm">
          {loading ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">Searching...</div>
          ) : items.length ? (
            <ul className="max-h-56 overflow-auto py-1">
              {items.map((it, idx) => (
                <li
                  key={`${it.style_no}-${idx}`}
                  className={cn(
                    "cursor-pointer select-none px-3 py-2 text-sm hover:bg-accent",
                    idx === highlight && "bg-accent"
                  )}
                  // ✅ FIX: use onMouseDown to commit BEFORE blur closes dropdown
                  onMouseDown={(e) => {
                    e.preventDefault(); // keep focus, prevent blur closing first
                    e.stopPropagation();
                    commit(it.style_no);
                  }}
                  onMouseEnter={() => setHighlight(idx)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{it.style_no}</span>
                    {it.name ? <span className="truncate text-xs text-muted-foreground">{it.name}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-3 py-2 text-xs text-muted-foreground">No results</div>
          )}

          <div className="border-t px-3 py-1 text-[11px] text-muted-foreground">
            Tip: ↑↓ 선택, Enter 확정
          </div>
        </div>
      ) : null}
    </div>
  );
}
