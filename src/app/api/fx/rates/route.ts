import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function bad(error: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error, ...(extra || {}) }, { status });
}

function isCode(v: string) {
  return /^[A-Z]{3}$/.test(v);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const requestedDate = (searchParams.get("date") || "").trim();
    const base = (searchParams.get("base") || "USD").trim().toUpperCase();
    const quoteParam = (searchParams.get("quote") || searchParams.get("quotes") || "").trim().toUpperCase();

    if (!requestedDate) return bad("Missing date", 400);
    if (!isCode(base)) return bad("Invalid base currency", 400);

    const quotes = quoteParam
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

    if (!quotes.length) return bad("Missing quote currency", 400);
    if (quotes.some((q) => !isCode(q))) return bad("Invalid quote currency", 400);

    if (quotes.length === 1 && quotes[0] === base) {
      return NextResponse.json({
        ok: true,
        rate: 1,
        rates: { [base]: 1 },
        as_of: requestedDate,
        source: "fixed_same_currency",
        base,
      });
    }

    const cached: Record<string, { rate: number; as_of: string; source: string }> = {};
    const missing = new Set<string>(quotes.filter((q) => q !== base));

    // exact cache
    const { data: exactRows, error: exactErr } = await supabaseAdmin
      .from("fx_rates_history")
      .select("rate_date,quote_currency,rate,source")
      .eq("base_currency", base)
      .in("quote_currency", Array.from(missing))
      .eq("rate_date", requestedDate);

    if (exactErr) return bad(exactErr.message, 500);

    for (const r of exactRows || []) {
      cached[r.quote_currency] = {
        rate: Number(r.rate),
        as_of: String(r.rate_date),
        source: String(r.source || "cache"),
      };
      missing.delete(r.quote_currency);
    }

    // nearest previous cached rate if exact missing
    if (missing.size) {
      for (const quote of Array.from(missing)) {
        const { data: prevRows, error: prevErr } = await supabaseAdmin
          .from("fx_rates_history")
          .select("rate_date,rate,source")
          .eq("base_currency", base)
          .eq("quote_currency", quote)
          .lte("rate_date", requestedDate)
          .order("rate_date", { ascending: false })
          .limit(1);

        if (prevErr) return bad(prevErr.message, 500);
        if (prevRows?.length) {
          const r = prevRows[0];
          cached[quote] = {
            rate: Number(r.rate),
            as_of: String(r.rate_date),
            source: String(r.source || "cache"),
          };
          missing.delete(quote);
        }
      }
    }

    // fetch remaining from Frankfurter
    if (missing.size) {
      const url = new URL("https://api.frankfurter.dev/v2/rates");
      url.searchParams.set("date", requestedDate);
      url.searchParams.set("base", base);
      url.searchParams.set("quotes", Array.from(missing).join(","));

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
      });

      if (!res.ok) {
        return bad(`FX provider failed (${res.status})`, 502);
      }

      const json = await res.json();
      const apiDate = String(json?.date || requestedDate);
      const rates = (json?.rates || {}) as Record<string, number>;

      const upsertRows = [];
      for (const quote of Array.from(missing)) {
        const rate = Number(rates?.[quote]);
        if (!Number.isFinite(rate) || rate <= 0) continue;

        cached[quote] = {
          rate,
          as_of: apiDate,
          source: "frankfurter",
        };

        upsertRows.push({
          rate_date: apiDate,
          base_currency: base,
          quote_currency: quote,
          rate,
          source: "frankfurter",
        });
      }

      if (upsertRows.length) {
        const { error: upsertErr } = await supabaseAdmin
          .from("fx_rates_history")
          .upsert(upsertRows, {
            onConflict: "rate_date,base_currency,quote_currency,source",
            ignoreDuplicates: false,
          });

        if (upsertErr) return bad(upsertErr.message, 500);
      }
    }

    const responseRates: Record<string, number> = {};
    for (const q of quotes) {
      if (q === base) responseRates[q] = 1;
      else if (cached[q]) responseRates[q] = cached[q].rate;
    }

    if (quotes.length === 1) {
      const q = quotes[0];
      if (q !== base && !cached[q]) return bad("Rate not found", 404);
      return NextResponse.json({
        ok: true,
        rate: q === base ? 1 : cached[q].rate,
        as_of: q === base ? requestedDate : cached[q].as_of,
        source: q === base ? "fixed_same_currency" : cached[q].source,
        base,
        quote: q,
      });
    }

    return NextResponse.json({
      ok: true,
      rates: responseRates,
      as_of_map: Object.fromEntries(
        quotes.map((q) => [q, q === base ? requestedDate : (cached[q]?.as_of || null)])
      ),
      source_map: Object.fromEntries(
        quotes.map((q) => [q, q === base ? "fixed_same_currency" : (cached[q]?.source || null)])
      ),
      base,
    });
  } catch (e: any) {
    return bad(e?.message || String(e), 500);
  }
}
