// FIXED VERSION
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  const { data: rows, error } = await supabaseAdmin
    .from("sample_requests")
    .select("*");

  if (error) {
    return NextResponse.json({ ok: false, error: error.message });
  }

  const safeRows = rows || [];

  const inProgressRows = safeRows.filter(r => r.progress_status !== "COMPLETED");
  const completedRows = safeRows.filter(r => r.progress_status === "COMPLETED");
  const convertedRows = safeRows.filter(r => r.result_status === "CONVERTED_TO_ORDER");
  const overdueRows = safeRows.filter(r => r.alert_status === "OVERDUE");
  const waitingRows = safeRows.filter(r =>
    ["WAITING_FEEDBACK", "FOLLOW_UP_DUE"].includes(r.alert_status)
  );

  const leadTimes = safeRows.map(r => {
    if (!r.request_date || !r.feedback_date) return null;
    const start = new Date(r.request_date).getTime();
    const end = new Date(r.feedback_date).getTime();
    if (!start || !end) return null;
    return (end - start) / (1000 * 60 * 60 * 24);
  });

  const safeLeadTimes = (leadTimes ?? []).filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v)
  );

  const kpis = {
    total_requests: safeRows.length,
    in_progress: inProgressRows.length,
    completed: completedRows.length,
    converted_requests: convertedRows.length,
    conversion_pct: safeRows.length
      ? (convertedRows.length / safeRows.length) * 100
      : 0,
    overdue: overdueRows.length,
    waiting_feedback: waitingRows.length,
    avg_lead_time_days: safeLeadTimes.length
      ? Math.round(
          (safeLeadTimes.reduce((a, b) => a + b, 0) / safeLeadTimes.length) * 10
        ) / 10
      : 0,
  };

  return NextResponse.json({ ok: true, kpis });
}
