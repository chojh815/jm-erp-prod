"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Mode } from "../api/ask-erp/provider";
import type { TraceDocument } from "../api/ask-erp/trace";

const copy = {
  en: {
    intro: "Find shipments, invoices, and packing lists linked to a purchase order.",
    model: "Search mode", direct: "Direct PO lookup", question: "PO number or question",
    placeholder: "Which shipment contains PO 4500100101?", submit: "Search", busy: "Searching…",
    empty: "No linked records found.", po: "Open PO", status: "Status", source: "Linked by",
    shipment: "Shipments", invoice: "Invoices", packing: "Packing Lists",
    unavailable: "No AI model is available for this session. Direct PO lookup is available.",
    access: "You do not have permission to use Ask ERP.",
    lookupFailed: "Could not load the related documents. Try again.",
    invalidQuestion: "Enter a question of up to 200 characters.",
    enterPO: "Enter one exact PO number to search.",
    ambiguousPO: "Multiple active orders have this PO number. Check PO List.",
    notFound: "No purchase order matches that PO number.",
  },
  ko: {
    intro: "PO에 연결된 선적, 인보이스, 패킹리스트를 찾습니다.",
    model: "조회 방식", direct: "PO 번호 직접 조회", question: "PO 번호 또는 질문",
    placeholder: "PO 4500100101은 어느 선적으로 나갔어?", submit: "조회", busy: "조회 중…",
    empty: "연결된 문서가 없습니다.", po: "PO 열기", status: "상태", source: "연결 기준",
    shipment: "선적", invoice: "인보이스", packing: "패킹리스트",
    unavailable: "현재 사용할 수 있는 AI 모델이 없습니다. PO 번호로 직접 조회할 수 있습니다.",
    access: "Ask ERP 조회 권한이 없습니다.", lookupFailed: "관련 문서를 불러오지 못했습니다. 다시 시도해 주세요.",
    invalidQuestion: "질문을 200자 이내로 입력해 주세요.", enterPO: "정확한 PO 번호 하나를 입력해 주세요.",
    ambiguousPO: "같은 PO 번호의 주문이 여러 건입니다. PO List에서 확인해 주세요.",
    notFound: "해당 번호의 PO를 찾을 수 없습니다.",
  },
  zh: {
    intro: "查询采购订单关联的出货单、发票和装箱单。",
    model: "查询方式", direct: "按 PO 编号直接查询", question: "PO 编号或问题",
    placeholder: "PO 4500100101 对应哪一票出货？", submit: "查询", busy: "查询中…",
    empty: "未找到相关单据。", po: "打开 PO", status: "状态", source: "关联依据",
    shipment: "出货单", invoice: "发票", packing: "装箱单",
    unavailable: "当前没有可用的 AI 模型。您可以直接使用 PO 编号查询。",
    access: "您没有 Ask ERP 的查询权限。", lookupFailed: "无法加载相关单据，请重试。",
    invalidQuestion: "请输入不超过 200 字的问题。", enterPO: "请输入一个准确的 PO 编号。",
    ambiguousPO: "有多个有效订单使用此编号，请在订单列表中核对。",
    notFound: "未找到该编号的采购订单。",
  },
};

type Trace = {
  po: { number: string; buyer: string | null; status: string | null };
  shipments: TraceDocument[] | null;
  invoices: TraceDocument[] | null;
  packingLists: TraceDocument[] | null;
};
type Language = keyof typeof copy;
type ErrorText = "access" | "lookupFailed" | "invalidQuestion" | "enterPO" | "ambiguousPO" | "notFound";
const modelNames = { openai: "OpenAI", qwen: "Qwen" };

export default function AskERPPage() {
  const [lang, setLang] = useState<Language>("en");
  const [modes, setModes] = useState<Mode[]>([]);
  const [mode, setMode] = useState<Mode>("direct");
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<ErrorText | null>(null);
  const [result, setResult] = useState<{ trace: Trace; mode: Mode } | null>(null);
  const [loading, setLoading] = useState(false);
  const t = copy[lang];

  useEffect(() => {
    const language = navigator.language.split("-")[0];
    if (language === "ko" || language === "zh") setLang(language);
    const controller = new AbortController();
    fetch("/api/ask-erp", { cache: "no-store", signal: controller.signal })
      .then(async res => {
        if (!res.ok) {
          setError([401, 403, 404].includes(res.status) ? "access" : "lookupFailed");
          return;
        }
        const { modes: available } = await res.json() as { modes: Mode[] };
        setModes(available);
        setMode(available[0]);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("lookupFailed");
      });
    return () => controller.abort();
  }, []);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || !question.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/ask-erp", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, mode }),
      });
      const data = await res.json();
      if (!res.ok) setError(Object.hasOwn(t, data.error) ? data.error : "lookupFailed");
      else setResult(data);
    } catch {
      setError("lookupFailed");
    } finally {
      setLoading(false);
    }
  }

  const label = (value: Mode) => value === "direct" ? t.direct : modelNames[value];
  const groups = result ? [
    { title: t.shipment, docs: result.trace.shipments, path: "/shipments" },
    { title: t.invoice, docs: result.trace.invoices, path: "/invoices" },
    { title: t.packing, docs: result.trace.packingLists, path: "/packing-lists" },
  ] : [];

  return (
    <AppShell title="Ask ERP" description={t.intro}>
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-5 sm:px-6">
        <Card>
          <CardContent className="pt-5">
            <form onSubmit={search} className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <label htmlFor="ask-erp-mode" className="text-sm font-medium">{t.model}</label>
                <select id="ask-erp-mode" className="h-9 rounded-md border bg-background px-3 text-sm"
                  value={mode} onChange={event => setMode(event.target.value as Mode)} disabled={!modes.length || loading}>
                  {(modes.length ? modes : ["direct" as const]).map(value =>
                    <option key={value} value={value}>{label(value)}</option>
                  )}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="ask-erp-question" className="text-sm font-medium">{t.question}</label>
                <div className="flex flex-wrap gap-2">
                  <Input id="ask-erp-question" className="min-w-0 flex-[1_1_16rem]" value={question}
                    onChange={event => setQuestion(event.target.value)} placeholder={t.placeholder} maxLength={200} required />
                  <Button type="submit" disabled={!modes.length || loading || !question.trim()}>
                    {loading ? t.busy : t.submit}
                  </Button>
                </div>
              </div>
              {modes.length === 1 && <p className="text-sm text-muted-foreground">{t.unavailable}</p>}
              {error && <p role="alert" className="text-sm text-red-700">{t[error]}</p>}
            </form>
          </CardContent>
        </Card>
        {result && (
          <Card>
            <CardContent className="space-y-5 pt-5" aria-live="polite">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
                <div>
                  <h2 className="text-lg font-semibold">PO {result.trace.po.number}</h2>
                  <p className="text-sm text-muted-foreground">
                    {[result.trace.po.buyer, result.trace.po.status].filter(Boolean).join(" · ")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{label(result.mode)}</p>
                </div>
                <Link className="text-sm font-medium text-blue-700 hover:underline"
                  href={`/po/create?poNo=${encodeURIComponent(result.trace.po.number)}`}>{t.po}</Link>
              </div>
              {groups.filter(group => group.docs !== null).map(group => (
                <section key={group.path} className="space-y-2">
                  <h3 className="font-semibold">{group.title}</h3>
                  {group.docs?.length ? (
                    <div className="overflow-x-auto rounded-md border">
                      <table className="w-full table-fixed break-words text-left text-sm">
                        <colgroup>
                          <col className="w-1/2" />
                          <col className="w-1/4" />
                          <col className="w-1/4" />
                        </colgroup>
                        <thead className="bg-muted">
                          <tr><th className="px-3 py-2">No.</th><th className="px-3 py-2">{t.status}</th><th className="px-3 py-2">{t.source}</th></tr>
                        </thead>
                        <tbody>
                          {group.docs.map(doc => <tr key={doc.id} className="border-t">
                            <td className="px-3 py-2">
                              <Link className="font-medium text-blue-700 hover:underline"
                                href={`${group.path}/${encodeURIComponent(doc.id)}`}>{doc.number || doc.id}</Link>
                            </td>
                            <td className="px-3 py-2">{doc.status || "—"}</td>
                            <td className="px-3 py-2">{doc.linkedBy}</td>
                          </tr>)}
                        </tbody>
                      </table>
                    </div>
                  ) : <p className="text-sm text-muted-foreground">{t.empty}</p>}
                </section>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
