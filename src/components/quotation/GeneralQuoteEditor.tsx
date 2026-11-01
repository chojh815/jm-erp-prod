"use client";
import React from "react";
import QuotationPurgeDialog from "./QuotationPurgeDialog";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import {
  assertQuoteReady,
  type QuoteDocument,
  type QuoteLine,
} from "@/lib/generalQuoteRules";
const cls =
  "w-full rounded border bg-background px-2 py-2 text-sm disabled:bg-muted";
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
function line(): QuoteLine {
  return {
    id: crypto.randomUUID(),
    style_no: "",
    description: "",
    qty: 1,
    unit: "pc",
    offer_price: null,
    target_price: null,
    remarks: "",
    costing_id: null,
    internal: {},
    tiers: [],
  };
}
function empty(): QuoteDocument {
  return {
    header: {
      buyer_id: null,
      buyer_code: "",
      buyer_name: "",
      brand: "",
      subject: "",
      quotation_date: today(),
      received_at: today(),
      valid_until: "",
      currency: "USD",
      incoterm: "FOB",
      remarks: "",
    },
    lines: [],
    requires_review: false,
    source_note: "",
  };
}
async function json(url: string, init?: RequestInit) {
  const r = await fetch(url, { cache: "no-store", ...init }),
    j = await r.json();
  if (!r.ok || j.ok === false || j.success === false)
    throw new Error(j.error || "처리하지 못했습니다.");
  return j;
}
export default function GeneralQuoteEditor({ id }: { id?: string }) {
  const [createAllowed, setCreateAllowed] = React.useState(false);
  const router = useRouter(),
    [data, setData] = React.useState<any>(null),
    [doc, setDoc] = React.useState<QuoteDocument>(empty),
    [version, setVersion] = React.useState(""),
    [source, setSource] = React.useState(""),
    [dirty, setDirty] = React.useState(false),
    [busy, setBusy] = React.useState(false),
    [message, setMessage] = React.useState(""),
    [buyers, setBuyers] = React.useState<any[]>([]),
    [ack, setAck] = React.useState(false),
    [currencyConfirm, setCurrencyConfirm] = React.useState(false),
    [costSearch, setCostSearch] = React.useState(""),
    [costings, setCostings] = React.useState<any[]>([]);
  const seq = React.useRef(0),
    canEdit = id ? !!data?.canEdit : createAllowed,
    editable =
      canEdit &&
      (!id || data?.version.status === "DRAFT") &&
      !data?.quotation.archived_at;
  React.useEffect(() => {
    void json("/api/quotations/bootstrap")
      .then((j) => {
        setBuyers(j.buyers || []);
        setCreateAllowed(j.canCreate === true);
      })
      .catch((e) => setMessage(e.message));
    if (!id) setDoc((d) => (d.lines.length ? d : { ...d, lines: [line()] }));
  }, [id]);
  async function load(v = version, s = source) {
    if (!id) return;
    const token = ++seq.current;
    setBusy(true);
    try {
      const j = await json(
        "/api/quotations/" +
          id +
          "?" +
          new URLSearchParams({
            ...(v ? { version_id: v } : {}),
            ...(s ? { source: s } : {}),
          }),
      );
      if (token !== seq.current) return;
      setData(j);
      setDoc(j.document);
      setVersion(j.version.id);
      setDirty(false);
      setAck(false);
      setCurrencyConfirm(false);
      setMessage("");
    } catch (e: any) {
      if (token === seq.current) setMessage(e.message);
    } finally {
      if (token === seq.current) setBusy(false);
    }
  }
  React.useEffect(() => {
    if (id) void load("", "");
    return () => {
      seq.current++;
    };
  }, [id]);
  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function change(fn: (d: QuoteDocument) => void) {
    if (!editable || busy) return;
    const next = structuredClone(doc);
    fn(next);
    setDoc(next);
    setDirty(true);
  }
  const send = (url: string, body: any, method = "POST") =>
    json(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const result = id
        ? await send(
            "/api/quotations/" + id,
            {
              version_id: version,
              revision: data.revision,
              document: doc,
              source,
              acknowledge_review: ack,
              confirm_currency_change: currencyConfirm,
            },
            "PUT",
          )
        : await send("/api/quotations/create", { document: doc });
      setDirty(false);
      if (!id) {
        router.replace("/quotations/" + result.id);
        return;
      }
      await load(version, source);
      setMessage("견적과 모든 단가·MOQ를 함께 저장했습니다.");
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function action(action: "revise" | "sent") {
    if (!id) return;
    if (dirty) {
      setMessage("먼저 저장해 주세요.");
      return;
    }
    let note = "";
    if (action === "sent") {
      try {
        assertQuoteReady(doc);
      } catch (e: any) {
        setMessage(e.message);
        return;
      }
      if (
        !window.confirm(
          "이 버전을 발송본으로 기록하고 잠그시겠습니까? 메일은 자동 전송하지 않습니다.",
        )
      )
        return;
    } else {
      const n = window.prompt("수정 이유 / 네고 내용 (선택)", "");
      if (n === null) return;
      note = n;
    }
    setBusy(true);
    try {
      const r = await send("/api/quotations/" + id, {
        action,
        version_id: version,
        revision: data.revision,
        note,
        source,
      });
      setSource("");
      await load(r.version_id, "");
      setMessage(
        action === "sent"
          ? "발송본으로 기록했습니다."
          : "이전 견적과 첨부를 복사한 수정본을 만들었습니다.",
      );
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function search() {
    try {
      const j = await json(
        "/api/quotations/costings?q=" + encodeURIComponent(costSearch),
      );
      setCostings(j.rows || []);
    } catch (e: any) {
      setMessage(e.message);
    }
  }
  async function importCosting(cid: string) {
    setBusy(true);
    try {
      const j = await json(
        "/api/quotations/costings?id=" + encodeURIComponent(cid),
      );
      if (doc.header.currency !== "USD")
        throw new Error(
          "Costing 오퍼는 USD입니다. 견적 통화를 USD로 확인한 후 추가해 주세요.",
        );
      setDoc((d) => ({
        ...d,
        lines: [...d.lines.filter((l) => l.style_no.trim()), j.line],
      }));
      setDirty(true);
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function filesUpload(l: QuoteLine, files: FileList | null) {
    if (!id || !files?.length) return;
    if (dirty) {
      setMessage("가격 변경을 먼저 저장한 후 파일을 올려 주세요.");
      return;
    }
    setBusy(true);
    try {
      let revision = data.revision;
      for (const file of Array.from(files)) {
        const base = { version_id: version, revision, line_id: l.id };
        const sign = await send("/api/quotations/" + id + "/files", {
          ...base,
          action: "sign",
          file: { name: file.name, size: file.size },
        });
        const upload = await createSupabaseBrowserClient()
          .storage.from(sign.bucket)
          .uploadToSignedUrl(sign.path, sign.token, file, {
            contentType: file.type || "application/octet-stream",
          });
        if (upload.error) throw upload.error;
        const r = await send("/api/quotations/" + id + "/files", {
          ...base,
          action: "finalize",
          file: { name: file.name, size: file.size, path: sign.path },
        });
        revision = r.revision;
      }
      await load(version, source);
      setMessage("첨부를 버전별로 보관했습니다.");
    } catch (e: any) {
      setMessage(
        e.message + " 이미 등록된 파일은 보존됩니다. Reload 후 확인해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function removeFile(f: any) {
    if (!id || dirty) return;
    if (
      !window.confirm(
        "이 DRAFT의 첨부에서 제외하시겠습니까? 과거 버전의 파일은 유지됩니다.",
      )
    )
      return;
    setBusy(true);
    try {
      await send("/api/quotations/" + id + "/files", {
        action: "remove",
        version_id: version,
        revision: data.revision,
        line_id: f.quotation_line_id,
        file_id: f.id,
      });
      await load(version, source);
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  function output(kind: "pdf" | "excel") {
    try {
      assertQuoteReady(doc);
      if (dirty) throw new Error("저장 후 출력해 주세요.");
      window.open(
        (kind === "pdf" ? "/quotations/" : "/api/quotations/") +
          id +
          "/" +
          kind +
          "?version_id=" +
          version,
        "_blank",
        "noopener,noreferrer",
      );
    } catch (e: any) {
      setMessage(e.message);
    }
  }
  return (
    <main className="mx-auto max-w-7xl space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {id ? data?.quotation.quotation_no || "Quotation" : "New Quotation"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {data?.quotation.archived_at
              ? "보관된 견적 · 조회 전용"
              : "바이어용 오퍼 · 버전별 가격 보존"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {id && data?.canPurge && (
            <QuotationPurgeDialog
              id={id}
              quotationNo={data.quotation.quotation_no}
              disabled={busy || dirty}
              onDeleted={() => router.push("/quotations")}
            />
          )}
          <button
            className="rounded border px-3 py-2"
            onClick={() => {
              if (
                !dirty ||
                window.confirm("저장하지 않은 변경을 버리시겠습니까?")
              )
                router.push("/quotations");
            }}
          >
            Back
          </button>
          {id && (
            <button
              className="rounded border px-3 py-2"
              disabled={busy}
              onClick={() => {
                if (
                  !dirty ||
                  window.confirm("변경을 버리고 다시 불러오시겠습니까?")
                )
                  void load();
              }}
            >
              Reload
            </button>
          )}
        </div>
      </div>
      {message && (
        <p role="status" className="rounded border bg-muted/30 p-3 text-sm">
          {message}
        </p>
      )}
      {id && data && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded border bg-background p-2 text-sm"
            value={version}
            disabled={busy}
            onChange={(e) => {
              if (
                dirty &&
                !window.confirm("변경을 버리고 버전을 바꾸시겠습니까?")
              )
                return;
              setSource("");
              void load(e.target.value, "");
            }}
          >
            {data.versions.map((v: any) => (
              <option key={v.id} value={v.id}>
                v{v.version_no} ({v.status})
              </option>
            ))}
          </select>
          <button
            className="rounded border px-3 py-2 text-sm"
            disabled={
              busy || dirty || !data.canCreate || !!data.quotation.archived_at
            }
            onClick={() => void action("revise")}
          >
            수정본 만들기
          </button>
          <button
            className="rounded border px-3 py-2 text-sm"
            disabled={busy || dirty}
            onClick={() => output("pdf")}
          >
            PDF / Print
          </button>
          <button
            className="rounded border px-3 py-2 text-sm"
            disabled={busy || dirty}
            onClick={() => output("excel")}
          >
            Excel (XLSX)
          </button>
        </div>
      )}
      {data?.version && (
        <p className="text-xs text-muted-foreground">
          수정 이유: {data.version.change_note || "최초 견적"} · 발송 기록:{" "}
          {data.version.sent_at
            ? new Date(data.version.sent_at).toLocaleString("ko-KR", {
                timeZone: "Asia/Seoul",
              })
            : "미발송"}
        </p>
      )}
      {(data?.legacy || doc.requires_review) && (
        <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            기존 견적 자료입니다. 가격 출처와 단위를 확인해 주세요. 발송본의
            변경은 수정본에서 진행합니다.
          </p>
          <select
            className="rounded border bg-white p-2"
            value={source || data.sources[0]?.key || ""}
            disabled={busy || dirty}
            onChange={(e) => {
              setSource(e.target.value);
              void load(version, e.target.value);
            }}
          >
            {data.sources.map((s: any) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          {doc.requires_review && (
            <label className="ml-3">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />{" "}
              표시된 가격 출처·통화·단위를 확인했습니다.
            </label>
          )}
        </div>
      )}
      <fieldset disabled={!editable || busy} className="min-w-0 space-y-4">
        <div className="grid gap-3 rounded border p-4 md:grid-cols-3">
          <label className="text-sm">
            Buyer
            <select
              className={cls}
              value={doc.header.buyer_id || ""}
              onChange={(e) =>
                change((d) => {
                  d.header.buyer_id = e.target.value || null;
                  const b = buyers.find((b) => b.id === e.target.value);
                  d.header.buyer_name = b?.name || "";
                })
              }
            >
              <option value="">바이어 선택</option>
              {buyers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
            </select>
          </label>
          {[
            ["subject", "제목"],
            ["brand", "Brand"],
            ["incoterm", "조건 / Incoterm"],
            ["remarks", "비고"],
          ].map(([key, label]) => (
            <label key={key} className="text-sm">
              {label}
              <input
                className={cls}
                value={(doc.header as any)[key]}
                onChange={(e) =>
                  change((d) => {
                    (d.header as any)[key] = e.target.value;
                  })
                }
              />
            </label>
          ))}
          <label className="text-sm">
            견적 통화
            <select
              className={cls}
              value={doc.header.currency}
              onChange={(e) => {
                if (
                  doc.lines.some((l) => l.offer_price != null) &&
                  !window.confirm(
                    "단가가 자동 환산되지 않습니다. 새 통화에 맞게 단가를 확인하시겠습니까?",
                  )
                )
                  return;
                setCurrencyConfirm(true);
                change((d) => {
                  d.header.currency = e.target.value;
                });
              }}
            >
              {[
                "USD",
                "CNY",
                "EUR",
                "GBP",
                "JPY",
                "KRW",
                "HKD",
                "AUD",
                "CAD",
              ].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          {[
            ["quotation_date", "견적 날짜"],
            ["received_at", "요청 받은 날짜"],
            ["valid_until", "유효 기한"],
          ].map(([key, label]) => (
            <label key={key} className="text-sm">
              {label}
              <input
                type="date"
                className={cls}
                value={(doc.header as any)[key]}
                onChange={(e) =>
                  change((d) => {
                    (d.header as any)[key] = e.target.value;
                  })
                }
              />
            </label>
          ))}
        </div>
        <div className="rounded border p-3">
          <p className="text-sm">
            Costing의 저장된 오퍼와 실제 원가 버전·환율·마진을 복사합니다.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              className={cls}
              placeholder="Style No 검색"
              value={costSearch}
              onChange={(e) => setCostSearch(e.target.value)}
            />
            <button
              className="shrink-0 rounded border px-3"
              onClick={() => void search()}
            >
              Costing 검색
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {costings.map((c) => (
              <button
                key={c.id}
                className="rounded border px-2 py-1 text-sm"
                onClick={() => void importCosting(c.id)}
              >
                {c.style_no} · v{c.version} · USD{" "}
                {c.offer_usd ?? c.offer_price_usd ?? "미입력"} 추가
              </button>
            ))}
          </div>
        </div>
        {doc.lines.map((l, i) => (
          <section key={l.id} className="space-y-3 rounded border p-4">
            <div className="flex justify-between">
              <h2 className="font-medium">Line {i + 1}</h2>
              <button
                className="text-sm text-red-700"
                onClick={() =>
                  change((d) => {
                    d.lines = d.lines.filter((x) => x.id !== l.id);
                  })
                }
              >
                행 제거
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-6">
              {[
                ["style_no", "Style No", "text"],
                ["description", "Description", "text"],
                ["qty", "Qty", "number"],
                ["unit", "단위", "text"],
                ["offer_price", "최종 오퍼 / " + l.unit, "number"],
                ["target_price", "Target", "number"],
              ].map(([key, label, type]) => (
                <label key={key} className="text-sm">
                  {label}
                  <input
                    type={type}
                    min={type === "number" ? 0 : undefined}
                    step="any"
                    className={cls}
                    value={(l as any)[key] ?? ""}
                    onChange={(e) =>
                      change((d) => {
                        (d.lines[i] as any)[key] =
                          type === "number"
                            ? e.target.value === ""
                              ? null
                              : Number(e.target.value)
                            : e.target.value;
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <label className="block text-sm">
              행 비고
              <input
                className={cls}
                value={l.remarks}
                onChange={(e) =>
                  change((d) => {
                    d.lines[i].remarks = e.target.value;
                  })
                }
              />
            </label>
            <p className="text-sm font-medium">
              금액: {doc.header.currency}{" "}
              {(l.qty * (l.offer_price || 0)).toFixed(2)}
            </p>
            <details className="text-sm">
              <summary>내부 원가 근거 (바이어 출력 제외)</summary>
              <p>
                Costing: {l.costing_id || "직접 입력"} · 원가 버전:{" "}
                {l.internal.costing_snapshot?.version ??
                  l.internal.legacy_snapshot?.costing_version ??
                  "—"}
              </p>
              <p>
                환율:{" "}
                {l.internal.costing_snapshot?.fx_cny_per_usd ??
                  l.internal.legacy_snapshot?.fx_cny_per_usd ??
                  "—"}{" "}
                · 마진:{" "}
                {l.internal.costing_snapshot?.target_margin_pct ??
                  l.internal.costing_snapshot?.margin_pct ??
                  "—"}
              </p>
            </details>
            <div className="space-y-2">
              <h3 className="text-sm font-medium">
                수량별 오퍼 / MOQ ({doc.header.currency})
              </h3>
              {l.tiers.map((t, j) => (
                <div key={t.id} className="grid grid-cols-5 gap-2">
                  {[
                    ["qty", "MOQ", "number"],
                    ["offer_price", "최종 단가", "number"],
                    ["ship_from", "선적지", "text"],
                    ["remarks", "비고", "text"],
                  ].map(([key, label, type]) => (
                    <input
                      key={key}
                      aria-label={label}
                      placeholder={label}
                      type={type}
                      min="0"
                      step="any"
                      className={cls}
                      value={(t as any)[key] ?? ""}
                      onChange={(e) =>
                        change((d) => {
                          (d.lines[i].tiers[j] as any)[key] =
                            type === "number"
                              ? e.target.value === ""
                                ? null
                                : Number(e.target.value)
                              : e.target.value;
                        })
                      }
                    />
                  ))}
                  <button
                    className="rounded border text-sm"
                    onClick={() =>
                      change((d) => {
                        d.lines[i].tiers.splice(j, 1);
                      })
                    }
                  >
                    MOQ 제거
                  </button>
                </div>
              ))}
              <button
                className="rounded border px-3 py-1 text-sm"
                onClick={() =>
                  change((d) => {
                    d.lines[i].tiers.push({
                      id: crypto.randomUUID(),
                      qty: 1000,
                      offer_price: null,
                      ship_from: "",
                      remarks: "",
                    });
                  })
                }
              >
                MOQ 추가
              </button>
            </div>
          </section>
        ))}
        <button
          className="rounded border px-3 py-2 text-sm"
          onClick={() =>
            change((d) => {
              d.lines.push(line());
            })
          }
        >
          Style 행 추가
        </button>
      </fieldset>
      {id &&
        data &&
        doc.lines.map((l) => (
          <div key={l.id} className="space-y-2 rounded border p-3">
            <p className="text-sm font-medium">{l.style_no} · 버전 첨부</p>
            {data.files
              .filter((f: any) => f.quotation_line_id === l.id)
              .map((f: any) => (
                <div key={f.id} className="flex gap-3 text-sm">
                  <a
                    className="text-blue-700 underline"
                    target="_blank"
                    rel="noreferrer"
                    href={
                      "/api/quotations/" +
                      id +
                      "/files?version_id=" +
                      version +
                      "&file_id=" +
                      f.id +
                      "&download=1"
                    }
                  >
                    {f.file_name}
                  </a>
                  {editable && (
                    <button
                      disabled={busy || dirty}
                      onClick={() => void removeFile(f)}
                    >
                      이 DRAFT에서 제외
                    </button>
                  )}
                </div>
              ))}
            {editable && (
              <input
                type="file"
                multiple
                disabled={
                  busy ||
                  dirty ||
                  data.revision === 0 ||
                  !data.document.lines.some((x: QuoteLine) => x.id === l.id)
                }
                onChange={(e) => {
                  void filesUpload(l, e.target.files);
                  e.target.value = "";
                }}
              />
            )}
            <p className="text-xs text-muted-foreground">
              행당 최대 10개 · 파일당 10MB · 먼저 견적을 저장해 주세요.
            </p>
          </div>
        ))}
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          disabled={busy || !editable}
          onClick={() => void save()}
        >
          {busy ? "처리 중…" : "견적 전체 저장"}
        </button>
        {id && (
          <button
            className="rounded border px-3 py-2 text-sm disabled:opacity-50"
            disabled={busy || dirty || !editable || !data?.revision}
            onClick={() => void action("sent")}
          >
            발송본 기록 · 잠금
          </button>
        )}
        <span className="text-sm text-muted-foreground">
          {dirty
            ? "저장하지 않은 변경이 있습니다."
            : !editable
              ? "발송/확정본 또는 보관된 견적은 조회 전용입니다."
              : "저장된 같은 가격으로 화면·PDF·Excel을 표시합니다."}
        </span>
      </div>
    </main>
  );
}
