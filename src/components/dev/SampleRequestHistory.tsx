"use client";
import React from "react";
import useSWR from "swr";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import {
  HISTORY_KINDS,
  HISTORY_SOURCES,
  validateHistoryFile,
} from "@/lib/sampleHistoryRules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Topic = { id: string; title: string };
type HistoryFile = { name: string; path: string; size: number; type: string };
type Entry = {
  id: string;
  topic_id: string | null;
  received_date: string;
  title: string;
  entry_kind: string;
  source: string;
  sender: string;
  note: string;
  files: HistoryFile[];
  previous_entry_id: string | null;
  created_by_name: string;
  created_at: string;
  visibility: string;
};
const kinds: Record<string, string> = {
  COST: "직원 가격조사",
  REVISION: "수정 자료",
  BUYER_REQUEST: "바이어 요청",
  PROGRESS: "진행 내용",
  OTHER: "기타",
};
const sources: Record<string, string> = {
  EMAIL: "메일",
  WECHAT: "위챗",
  INTERNAL: "직접 작성",
  OTHER: "기타",
};
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const selectClass =
  "mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
async function readJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok)
    throw new Error(data.error || "처리하지 못했습니다. 다시 시도해 주세요.");
  return data;
}
export default function SampleRequestHistory({
  requestId,
}: {
  requestId: string;
}) {
  const base = `/api/sample-requests/${requestId}`;
  const {
    data: workspace,
    error: workspaceError,
    mutate: reloadWorkspace,
  } = useSWR(base + "/workspace", readJson);
  const topics: Topic[] = workspace?.topics ?? [];
  const [topic, setTopic] = React.useState("all");
  const [search, setSearch] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [page, setPage] = React.useState(1);
  const params = new URLSearchParams({
    page: String(page),
    ...(topic !== "all" ? { topic } : {}),
    ...(query ? { q: query } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });
  const {
    data: history,
    error: historyError,
    mutate: reloadHistory,
    isLoading,
  } = useSWR(workspace ? `${base}/history?${params}` : null, readJson);
  const [newTopic, setNewTopic] = React.useState("");
  const [member, setMember] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [receivedDate, setReceivedDate] = React.useState(today);
  const [sender, setSender] = React.useState("");
  const [source, setSource] = React.useState("EMAIL");
  const [kind, setKind] = React.useState("COST");
  const [note, setNote] = React.useState("");
  const [draftTopic, setDraftTopic] = React.useState("common");
  const [visibility, setVisibility] = React.useState("TEAM");
  const [files, setFiles] = React.useState<File[]>([]);
  const [fileKey, setFileKey] = React.useState(0);
  const [previous, setPrevious] = React.useState<Entry | null>(null);
  const [preview, setPreview] = React.useState<{
    entry: Entry;
    index: number;
  } | null>(null);
  const [sheet, setSheet] = React.useState("");
  const previewFile = preview?.entry.files[preview.index];
  const excel = !!previewFile && /\.(xlsx|xls|csv)$/i.test(previewFile.name);
  const fileUrl = (entryId: string, index: number, download = false) =>
    `${base}/history/${entryId}/file?index=${index}${download ? "&download=1" : ""}`;
  const {
    data: table,
    error: previewError,
    isLoading: previewLoading,
  } = useSWR(
    preview && excel
      ? `${base}/history/${preview.entry.id}/preview?index=${preview.index}${sheet ? `&sheet=${encodeURIComponent(sheet)}` : ""}`
      : null,
    readJson,
  );
  const compose = React.useRef<HTMLDivElement>(null);
  async function workspaceAction(action: string, value: string) {
    setBusy(true);
    setMessage("");
    try {
      await readJson(base + "/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "topic"
            ? { action, title: value }
            : { action, user_id: value },
        ),
      });
      setNewTopic("");
      setMember("");
      await reloadWorkspace();
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function register() {
    setMessage("");
    if (!title.trim()) {
      setMessage("자료 제목을 입력해 주세요.");
      return;
    }
    if (!files.length && !note.trim()) {
      setMessage("파일 또는 진행 내용을 입력해 주세요.");
      return;
    }
    if (files.length > 5) {
      setMessage("파일은 한 번에 5개까지 등록할 수 있습니다.");
      return;
    }
    try {
      files.forEach(validateHistoryFile);
    } catch (e: any) {
      setMessage(e.message);
      return;
    }
    setBusy(true);
    try {
      let uploaded: any[] = [];
      if (files.length) {
        const prepared = await readJson(base + "/history/uploads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            files: files.map((f) => ({ name: f.name, size: f.size })),
          }),
        });
        const supabase = createSupabaseBrowserClient();
        for (let index = 0; index < files.length; index++) {
          const upload = prepared.uploads[index];
          setMessage(`파일 업로드 중 (${index + 1}/${files.length})`);
          const result = await supabase.storage
            .from(prepared.bucket)
            .uploadToSignedUrl(upload.path, upload.token, files[index], {
              contentType: files[index].type || "application/octet-stream",
            });
          if (result.error) throw new Error(result.error.message);
        }
        uploaded = prepared.uploads.map((f: any) => ({
          path: f.path,
          name: f.name,
          size: f.size,
        }));
      }
      setMessage("이력 등록 중…");
      await readJson(base + "/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          received_date: receivedDate,
          sender,
          source,
          entry_kind: kind,
          note,
          topic_id: draftTopic === "common" ? null : draftTopic,
          previous_entry_id: previous?.id ?? null,
          visibility,
          files: uploaded,
        }),
      });
      setTitle("");
      setNote("");
      setFiles([]);
      setFileKey((k) => k + 1);
      setPrevious(null);
      setPage(1);
      setTopic("all");
      setQuery("");
      setSearch("");
      setFrom("");
      setTo("");
      await reloadHistory();
      setMessage("등록했습니다. 이전 원본과 수정 이력이 함께 보관됩니다.");
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  function revise(entry: Entry) {
    setPrevious(entry);
    setKind("REVISION");
    setDraftTopic(entry.topic_id || "common");
    setTitle(`수정: ${entry.title}`.slice(0, 200));
    setNote("");
    setFiles([]);
    setFileKey((k) => k + 1);
    setVisibility(entry.visibility);
    setReceivedDate(today());
    compose.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const error = workspaceError || historyError;
  return (
    <div className="space-y-5">
      {error && (
        <div
          role="alert"
          className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {error.message}
          <Button
            variant="outline"
            size="sm"
            className="ml-3"
            onClick={() => {
              void reloadWorkspace();
              void reloadHistory();
            }}
          >
            다시 시도
          </Button>
        </div>
      )}
      {!workspace && !error && (
        <p className="text-sm text-muted-foreground">
          자료 이력을 불러오는 중…
        </p>
      )}
      {workspace && (
        <>
          {workspace.canManage && (
            <details className="rounded border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Sub Title 및 담당 직원 설정
              </summary>
              <div className="mt-4 grid gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="sample-topic" className="text-sm">
                    세부 개발건 / Sub Title
                  </label>
                  <Input
                    id="sample-topic"
                    maxLength={200}
                    value={newTopic}
                    onChange={(e) => setNewTopic(e.target.value)}
                    placeholder="CHAIN COLLAR"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !newTopic.trim()}
                    onClick={() => void workspaceAction("topic", newTopic)}
                  >
                    Sub Title 추가
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    등록된 자료의 분류와 이력은 계속 유지됩니다.
                  </p>
                </div>
                <div className="space-y-2">
                  <label htmlFor="sample-member" className="text-sm">
                    자료를 등록할 담당 직원
                  </label>
                  <select
                    id="sample-member"
                    className={selectClass}
                    value={member}
                    onChange={(e) => setMember(e.target.value)}
                  >
                    <option value="">직원 선택</option>
                    {(workspace.users ?? []).map((u: any) => (
                      <option key={u.user_id} value={u.user_id}>
                        {u.name || u.email}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !member}
                    onClick={() => void workspaceAction("member", member)}
                  >
                    직원 배정
                  </Button>
                  <ul className="space-y-1">
                    {(workspace.members ?? []).map((m: any) => {
                      const u = workspace.users.find(
                        (u: any) => u.user_id === m.user_id,
                      );
                      return (
                        <li
                          key={m.user_id}
                          className="flex items-center justify-between gap-2 text-sm"
                        >
                          <span>{u?.name || u?.email || "비활성 직원"}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={async () => {
                              try {
                                await readJson(
                                  `${base}/workspace?user_id=${m.user_id}`,
                                  { method: "DELETE" },
                                );
                                await reloadWorkspace();
                              } catch (e: any) {
                                setMessage(e.message);
                              }
                            }}
                          >
                            배정 해제
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-xs text-muted-foreground">
                    요청서의 기존 담당자와 관리자는 기본 접근 권한을 유지합니다.
                  </p>
                </div>
              </div>
            </details>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={topic === "all" ? "default" : "outline"}
              onClick={() => {
                setTopic("all");
                setPage(1);
              }}
            >
              전체 자료
            </Button>
            <Button
              size="sm"
              variant={topic === "common" ? "default" : "outline"}
              onClick={() => {
                setTopic("common");
                setDraftTopic("common");
                setPage(1);
              }}
            >
              공통 자료
            </Button>
            {topics.map((t) => (
              <Button
                key={t.id}
                size="sm"
                variant={topic === t.id ? "default" : "outline"}
                onClick={() => {
                  setTopic(t.id);
                  setDraftTopic(t.id);
                  setPage(1);
                }}
              >
                {t.title}
              </Button>
            ))}
          </div>
          <form
            className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(search);
              setPage(1);
            }}
          >
            <Input
              aria-label="자료 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="파일명·제목·직원·변경 내용 검색"
            />
            <Input
              aria-label="받은 날짜 시작"
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
            <Input
              aria-label="받은 날짜 종료"
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
            <Button type="submit" variant="outline">
              검색
            </Button>
          </form>
          <div className="space-y-3" aria-live="polite">
            {isLoading && (
              <p className="text-sm text-muted-foreground">조회 중…</p>
            )}
            {!isLoading && history?.items.length === 0 && (
              <p className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">
                등록된 자료가 없습니다. 아래에서 첫 자료나 진행 내용을 등록해
                주세요.
              </p>
            )}
            {(history?.items ?? []).map((entry: Entry) => (
              <article
                key={entry.id}
                id={`history-${entry.id}`}
                className="rounded-lg border p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-muted-foreground">
                      {entry.received_date} ·{" "}
                      {topics.find((t) => t.id === entry.topic_id)?.title ||
                        "공통 자료"}{" "}
                      · {kinds[entry.entry_kind]}
                      {entry.visibility === "MANAGEMENT"
                        ? " · 관리자 전용"
                        : ""}
                    </div>
                    <h3 className="mt-1 font-semibold">{entry.title}</h3>
                    <div className="mt-1 text-xs text-muted-foreground">
                      받은 경로: {sources[entry.source]} · 보낸 사람:{" "}
                      {entry.sender || "미입력"}
                    </div>
                  </div>
                  {workspace.canContribute && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => revise(entry)}
                    >
                      수정본 추가
                    </Button>
                  )}
                </div>
                {entry.previous_entry_id && (
                  <p className="mt-2 text-xs text-blue-700">
                    이전 자료에 연결된 수정본 · 원본은 계속 보관됩니다.
                  </p>
                )}
                {entry.note && (
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm">
                    {entry.note}
                  </p>
                )}
                <ul className="mt-3 space-y-2">
                  {entry.files.map((file, index) => (
                    <li
                      key={file.path}
                      className="flex flex-wrap items-center gap-2 text-sm"
                    >
                      <span className="min-w-0 break-all">{file.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSheet("");
                          setPreview({ entry, index });
                        }}
                      >
                        보기
                      </Button>
                      <a
                        className="text-blue-700 underline"
                        href={fileUrl(entry.id, index, true)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        원본 다운로드
                      </a>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  등록: {entry.created_by_name} ·{" "}
                  {new Date(entry.created_at).toLocaleString("ko-KR", {
                    timeZone: "Asia/Seoul",
                  })}
                </p>
              </article>
            ))}
            <div className="flex items-center justify-between gap-2 text-sm">
              <span>{history?.total ?? 0}건 · 받은 날짜순</span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  이전
                </Button>
                <span>{page}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    !history || page * history.pageSize >= history.total
                  }
                  onClick={() => setPage((p) => p + 1)}
                >
                  다음
                </Button>
              </div>
            </div>
          </div>
          {workspace.canContribute && (
            <div
              ref={compose}
              className="space-y-4 rounded-lg border bg-slate-50/40 p-4"
            >
              <h3 className="font-semibold">
                {previous ? "수정본 등록" : "자료·진행 내용 등록"}
              </h3>
              {previous && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>이전 자료: {previous.title}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setPrevious(null)}
                  >
                    연결 해제
                  </Button>
                </div>
              )}
              <fieldset
                disabled={busy}
                className="grid min-w-0 gap-3 sm:grid-cols-2"
              >
                <label className="text-sm">
                  Sub Title
                  <select
                    className={selectClass}
                    value={draftTopic}
                    disabled={!!previous}
                    onChange={(e) => setDraftTopic(e.target.value)}
                  >
                    <option value="common">공통 자료</option>
                    {topics.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  실제 받은 날짜
                  <Input
                    className="mt-1"
                    type="date"
                    value={receivedDate}
                    onChange={(e) => setReceivedDate(e.target.value)}
                  />
                </label>
                <label className="text-sm sm:col-span-2">
                  자료 제목
                  <Input
                    className="mt-1"
                    maxLength={200}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="예: 체인 두께 변경 후 재견적"
                  />
                </label>
                <label className="text-sm">
                  자료 구분
                  <select
                    className={selectClass}
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    {HISTORY_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {kinds[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  받은 경로
                  <select
                    className={selectClass}
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  >
                    {HISTORY_SOURCES.map((s) => (
                      <option key={s} value={s}>
                        {sources[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  보낸 사람
                  <Input
                    className="mt-1"
                    maxLength={200}
                    value={sender}
                    onChange={(e) => setSender(e.target.value)}
                    placeholder="직원 또는 바이어 이름"
                  />
                </label>
                {workspace.canManage && (
                  <label className="text-sm">
                    열람 범위
                    <select
                      className={selectClass}
                      value={visibility}
                      onChange={(e) => setVisibility(e.target.value)}
                    >
                      <option value="TEAM">담당 직원·관리자</option>
                      <option value="MANAGEMENT">관리자 전용</option>
                    </select>
                  </label>
                )}
                <label className="text-sm sm:col-span-2">
                  변경 내용 / 진행 메모
                  <Textarea
                    className="mt-1"
                    maxLength={10000}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <label className="text-sm sm:col-span-2">
                  파일 첨부
                  <Input
                    key={fileKey}
                    className="mt-1"
                    type="file"
                    multiple
                    accept=".xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.docx"
                    onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                  />
                  <span className="mt-1 block text-xs text-muted-foreground">
                    최대 5개 · 파일당 40 MB · 파일 없이 진행 메모만 등록할 수도
                    있습니다.
                  </span>
                </label>
              </fieldset>
              <p className="text-xs text-muted-foreground">
                등록자와 등록 시각은 로그인 정보를 기준으로 자동 기록됩니다.
                수정본을 추가해도 기존 파일은 변경되지 않습니다.
              </p>
              <Button disabled={busy} onClick={() => void register()}>
                {busy ? "등록 중…" : "이력 등록"}
              </Button>
            </div>
          )}
        </>
      )}
      {message && (
        <p role="status" className="whitespace-pre-wrap break-words text-sm">
          {message}
        </p>
      )}
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent className="max-h-[90vh] w-[95vw] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="break-all pr-5">
              {previewFile?.name || "자료 미리보기"}
            </DialogTitle>
          </DialogHeader>
          {preview && previewFile && (
            <>
              {excel ? (
                <>
                  {previewLoading && (
                    <p className="text-sm">표 미리보기를 준비 중…</p>
                  )}
                  {previewError && (
                    <p role="alert" className="text-sm text-red-700">
                      {previewError.message}
                    </p>
                  )}
                  {table && (
                    <>
                      <label className="text-sm">
                        워크시트
                        <select
                          className={selectClass}
                          value={sheet || table.sheet}
                          onChange={(e) => setSheet(e.target.value)}
                        >
                          {table.sheets.map((s: string) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </label>
                      <p className="text-xs text-muted-foreground">
                        표 미리보기는 첫 100행·20열을 표시합니다. 사진·병합 셀과
                        전체 양식은 원본 파일에서 확인해 주세요.
                      </p>
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-xs">
                          <tbody>
                            {table.rows.map((row: string[], r: number) => (
                              <tr key={r}>
                                {row.map((cell, c) => (
                                  <td
                                    key={c}
                                    className="max-w-xs whitespace-pre-wrap break-words border p-2"
                                  >
                                    {cell}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </>
              ) : /\.(png|jpg|jpeg|webp|gif)$/i.test(previewFile.name) ? (
                <img
                  className="mx-auto max-h-[65vh] max-w-full object-contain"
                  src={fileUrl(preview.entry.id, preview.index)}
                  alt={previewFile.name}
                />
              ) : /\.pdf$/i.test(previewFile.name) ? (
                <iframe
                  title={previewFile.name}
                  className="h-[65vh] w-full"
                  src={fileUrl(preview.entry.id, preview.index)}
                />
              ) : (
                <p className="text-sm">
                  이 파일은 원본을 다운로드해 확인할 수 있습니다.
                </p>
              )}
              <a
                className="text-sm text-blue-700 underline"
                href={fileUrl(preview.entry.id, preview.index, true)}
                target="_blank"
                rel="noreferrer"
              >
                원본 다운로드
              </a>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
