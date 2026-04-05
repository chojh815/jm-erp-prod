import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      ...(init?.headers || {}),
    },
  });
}
function ok(data: any = {}) { return json({ ok: true, ...data }); }
function bad(message: string, status = 400, extra?: any) { return json({ ok: false, error: message, ...(extra ?? {}) }, { status }); }
function asText(v: any) { return v === null || v === undefined ? "" : String(v).trim(); }
function asDate(v: any): string | null { const s = asText(v); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
function asBool(v: any, fallback = false) { if (typeof v === "boolean") return v; const s = asText(v).toLowerCase(); if (["true","1","yes","y"].includes(s)) return true; if (["false","0","no","n"].includes(s)) return false; return fallback; }

function normalizeResultStatus(v: any) {
  const s = asText(v).toUpperCase();
  if (!s || s === "CONVERTED") return s === "CONVERTED" ? "CONVERTED_TO_ORDER" : "WAITING";
  if (s === "CLOSED" || s === "NO_ORDER") return "CLOSED_NO_ORDER";
  return s;
}
function normalizeProgressStatus(v: any, resultStatus?: any) {
  const s = asText(v).toUpperCase();
  const result = normalizeResultStatus(resultStatus);
  if (["CONVERTED_TO_ORDER", "CLOSED_NO_ORDER"].includes(result) || ["CONVERTED_TO_ORDER", "CLOSED_NO_ORDER"].includes(s)) return "COMPLETED";
  if (["REQUESTED", "IN_PROGRESS", "READY_TO_SEND"].includes(s)) return "DEVELOPING";
  if (s === "SENT") return "SENT";
  if (["WAITING_FEEDBACK", "FEEDBACK_RECEIVED", "REVISE_REQUIRED", "APPROVED", "REJECTED", "FEEDBACK"].includes(s)) return "FEEDBACK";
  if (s === "COMPLETED") return "COMPLETED";
  return "REQUESTED";
}
function computeAlertStatus(row: any) {
  const today = new Date().toISOString().slice(0, 10);
  const resultStatus = normalizeResultStatus(row?.result_status);
  const progress = normalizeProgressStatus(row?.status || row?.progress_status, resultStatus);
  const targetShipDate = asDate(row?.target_ship_date);
  const sentDate = asDate(row?.sent_date);
  const feedbackDate = asDate(row?.feedback_date);
  const nextFollowUpDate = asDate(row?.next_follow_up_date);
  const converted = asBool(row?.is_converted_to_order, false);
  if (converted || resultStatus === "CONVERTED_TO_ORDER" || resultStatus === "CLOSED_NO_ORDER") return "DONE";
  if (!sentDate) {
    if (!targetShipDate) return "ON_TRACK";
    if (targetShipDate < today) return "OVERDUE";
    const soon = new Date(today); soon.setDate(soon.getDate() + 2);
    return targetShipDate <= soon.toISOString().slice(0, 10) ? "DUE_SOON" : "ON_TRACK";
  }
  if ((progress === "SENT" || progress === "FEEDBACK") && !feedbackDate) {
    if (nextFollowUpDate && nextFollowUpDate < today) return "FOLLOW_UP_DUE";
    return "WAITING_FEEDBACK";
  }
  return "ON_TRACK";
}
function monthKey(d: string | null) { return d ? d.slice(0,7) : ""; }

export async function GET(_req: NextRequest) {
  try {
    const { data, error } = await supabaseAdmin
      .from("sample_requests")
      .select("*")
      .eq("is_deleted", false)
      .order("request_date", { ascending: false })
      .limit(2000);

    if (error) return bad(error.message || "Failed to load dashboard data", 500);

    const rows = (data || []).map((r: any) => {
      const result_status = normalizeResultStatus(r.result_status);
      const progress_status = normalizeProgressStatus(r.status || r.progress_status, result_status);
      const alert_status = asText(r.alert_status) || computeAlertStatus({ ...r, result_status, progress_status });
      return { ...r, result_status, progress_status, alert_status };
    });

    const total_requests = rows.length;
    const completedRows = rows.filter((r: any) => r.progress_status === "COMPLETED");
    const convertedRows = rows.filter((r: any) => r.result_status === "CONVERTED_TO_ORDER");
    const waitingRows = rows.filter((r: any) => ["WAITING_FEEDBACK", "FOLLOW_UP_DUE"].includes(r.alert_status));
    const overdueRows = rows.filter((r: any) => r.alert_status === "OVERDUE");

    const leadTimes = completedRows
      .map((r: any) => {
        const start = asDate(r.request_date);
        const end = asDate(r.converted_date) || asDate(r.feedback_date) || asDate(r.sent_date);
        if (!start || !end) return null;
        return Math.max(0, Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 86400000));
      });

    const safeLeadTimes = leadTimes.filter(
      (v): v is number => typeof v === "number" && Number.isFinite(v)
    );

    const kpis = {
      total_requests,
      in_progress: rows.filter((r: any) => r.progress_status !== "COMPLETED").length,
      completed: completedRows.length,
      converted_requests: convertedRows.length,
      conversion_pct: total_requests ? Math.round((convertedRows.length / total_requests) * 10000) / 100 : 0,
      overdue: overdueRows.length,
      waiting_feedback: waitingRows.length,
      avg_lead_time_days: safeLeadTimes.length
        ? Math.round((safeLeadTimes.reduce((a, b) => a + b, 0) / safeLeadTimes.length) * 10) / 10
        : 0,
    };

    const buyerMap = new Map<string, any>();
    for (const r of rows) {
      const key = asText(r.buyer_id) || asText(r.buyer_name) || "UNKNOWN";
      const cur = buyerMap.get(key) || { buyer_name: asText(r.buyer_name) || "—", requests: 0, converted: 0, overdue: 0, waiting: 0 };
      cur.requests += 1;
      if (r.result_status === "CONVERTED_TO_ORDER") cur.converted += 1;
      if (r.alert_status === "OVERDUE") cur.overdue += 1;
      if (["WAITING_FEEDBACK", "FOLLOW_UP_DUE"].includes(r.alert_status)) cur.waiting += 1;
      buyerMap.set(key, cur);
    }
    const buyer_ranking = Array.from(buyerMap.values())
      .map((r: any) => ({ ...r, conversion_pct: r.requests ? Math.round((r.converted / r.requests) * 10000) / 100 : 0 }))
      .sort((a: any, b: any) => b.requests - a.requests || b.converted - a.converted || a.buyer_name.localeCompare(b.buyer_name));

    const requestMonths = new Map<string, number>();
    const convertedMonths = new Map<string, number>();
    for (const r of rows) {
      const mk1 = monthKey(asDate(r.request_date));
      if (mk1) requestMonths.set(mk1, (requestMonths.get(mk1) || 0) + 1);
      const mk2 = monthKey(asDate(r.converted_date));
      if (mk2) convertedMonths.set(mk2, (convertedMonths.get(mk2) || 0) + 1);
    }
    const monthly_requests = Array.from(requestMonths.entries()).sort((a,b) => a[0].localeCompare(b[0])).map(([month, requests]) => ({ month, requests }));
    const monthly_converted = Array.from(convertedMonths.entries()).sort((a,b) => a[0].localeCompare(b[0])).map(([month, converted]) => ({ month, converted }));

    const aging = [
      { bucket: "0-7", count: 0 },
      { bucket: "8-14", count: 0 },
      { bucket: "15-30", count: 0 },
      { bucket: "30+", count: 0 },
    ];
    for (const r of rows.filter((x: any) => x.progress_status !== "COMPLETED")) {
      const requestDate = asDate(r.request_date);
      if (!requestDate) continue;
      const days = Math.max(0, Math.floor((new Date().getTime() - new Date(requestDate).getTime()) / 86400000));
      if (days <= 7) aging[0].count += 1;
      else if (days <= 14) aging[1].count += 1;
      else if (days <= 30) aging[2].count += 1;
      else aging[3].count += 1;
    }

    const alerts = rows
      .filter((r: any) => ["OVERDUE", "WAITING_FEEDBACK", "FOLLOW_UP_DUE"].includes(r.alert_status))
      .sort((a: any, b: any) => {
        const rank = (v: string) => v === "OVERDUE" ? 0 : v === "FOLLOW_UP_DUE" ? 1 : 2;
        return rank(a.alert_status) - rank(b.alert_status) || asText(a.target_ship_date).localeCompare(asText(b.target_ship_date));
      })
      .slice(0, 10)
      .map((r: any) => ({
        id: r.id,
        request_no: r.request_no,
        request_title: r.request_title,
        buyer_name: r.buyer_name,
        alert_status: r.alert_status,
        progress_status: r.progress_status,
        target_ship_date: r.target_ship_date,
        days_open: asDate(r.request_date) ? Math.max(0, Math.floor((new Date().getTime() - new Date(String(r.request_date)).getTime()) / 86400000)) : 0,
      }));

    return ok({ kpis, buyer_ranking, monthly_requests, monthly_converted, aging, alerts });
  } catch (e: any) {
    return bad(e?.message || "Unknown error", 500);
  }
}
