"use client";
import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { redBatchManufacturer } from "@/lib/redBatchVendors";
import type {
  RedBatchPo,
  RedBatchPoLine,
  RedBatchPoScope,
} from "@/lib/redBatchOrders";

type Props = {
  disabled?: boolean;
  selectItem?: boolean;
  refreshKey?: number;
  onChange: (po: RedBatchPo | null, line: RedBatchPoLine | null) => void;
};
async function getOptions(params: URLSearchParams, signal: AbortSignal) {
  const response = await fetch("/api/production-batches/options?" + params, {
    cache: "no-store",
    signal,
  });
  const data = await response.json();
  if (!response.ok || !data.success)
    throw new Error(data.message || "PO 정보를 불러오지 못했습니다.");
  return data;
}
const control =
  "h-10 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-60";
export default function RedBatchPoPicker({
  disabled,
  selectItem = true,
  refreshKey = 0,
  onChange,
}: Props) {
  const field = React.useId();
  const [scope, setScope] = React.useState<RedBatchPoScope>(
    selectItem ? "pending" : "all",
  );
  const [search, setSearch] = React.useState("");
  const [offset, setOffset] = React.useState(0);
  const [pos, setPos] = React.useState<RedBatchPo[]>([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [po, setPo] = React.useState<RedBatchPo | null>(null);
  const [lines, setLines] = React.useState<RedBatchPoLine[]>([]);
  const [lineId, setLineId] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [itemsLoading, setItemsLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [itemsError, setItemsError] = React.useState("");
  React.useEffect(() => {
    setPo(null);
    setLines([]);
    setLineId("");
    setOffset(0);
    setItemsError("");
  }, [refreshKey]);
  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      void getOptions(
        new URLSearchParams({ q: search, offset: String(offset), scope }),
        controller.signal,
      )
        .then((data) => {
          if (!controller.signal.aborted) {
            setPos(data.rows || []);
            setHasMore(data.hasMore);
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            setError(e.message);
            setPos([]);
            setHasMore(false);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, offset, scope, refreshKey]);
  React.useEffect(() => {
    if (!po || !selectItem) {
      setLines([]);
      setItemsLoading(false);
      return;
    }
    const controller = new AbortController();
    setItemsLoading(true);
    setItemsError("");
    void getOptions(
      new URLSearchParams({ po_id: po.id, scope }),
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) setLines(data.rows || []);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setItemsError(e.message);
          setLines([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setItemsLoading(false);
      });
    return () => controller.abort();
  }, [po?.id, selectItem, scope]);
  const choices =
    po && !pos.some((item) => item.id === po.id) ? [po, ...pos] : pos;
  const selected = lines.find((item) => item.id === lineId);
  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
      <div>
        <label htmlFor={field + "-scope"} className="mb-1 block text-sm">
          표시할 RED PO
        </label>
        <select
          id={field + "-scope"}
          className={control}
          value={scope}
          disabled={disabled}
          onChange={(e) => {
            setScope(e.target.value as RedBatchPoScope);
            setOffset(0);
            setPo(null);
            setLines([]);
            setLineId("");
            setItemsError("");
            onChange(null, null);
          }}
        >
          <option value="pending">Pending RED PO · 미선적 잔량</option>
          <option value="unbatched">Pending · 4.0 BATCH 미등록 품목</option>
          <option value="all">전체 RED PO · 완료 건 포함</option>
        </select>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor={field + "-search"} className="mb-1 block text-sm">
            RED PO 번호 검색
          </label>
          <Input
            id={field + "-search"}
            value={search}
            maxLength={100}
            disabled={disabled}
            placeholder="PO 번호 일부 입력"
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
          />
        </div>
        <div>
          <label htmlFor={field + "-po"} className="mb-1 block text-sm">
            PO 선택
          </label>
          <select
            id={field + "-po"}
            className={control}
            value={po?.id || ""}
            disabled={disabled || loading}
            onChange={(e) => {
              const next =
                choices.find((item) => item.id === e.target.value) || null;
              setPo(next);
              setLines([]);
              setLineId("");
              setItemsError("");
              onChange(next, null);
            }}
          >
            <option value="">
              {loading ? "PO 불러오는 중…" : "PO를 선택해 주세요"}
            </option>
            {choices.map((item) => (
              <option key={item.id} value={item.id}>
                {item.po_no} ·{" "}
                {redBatchManufacturer(item.manufacturing_origin)?.label ||
                  "제조지 미등록"}{" "}
                · 잔량 {Number(item.pending_qty || 0).toLocaleString()}
                {item.unbatched_pending_line_count !== undefined
                  ? " · 4.0 미등록 " +
                    item.unbatched_pending_line_count +
                    "품목"
                  : ""}
                {item.has_legacy_batch ? " · 기존 배치 있음" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>
      {(offset > 0 || hasMore) && (
        <div className="flex items-center gap-2 text-sm">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || loading || offset === 0}
            onClick={() => setOffset((value) => Math.max(0, value - 50))}
          >
            이전 PO
          </Button>
          <span>
            {offset + 1}~{offset + pos.length}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || loading || !hasMore}
            onClick={() => setOffset((value) => value + 50)}
          >
            다음 PO
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        미등록 여부는 PO별 품목의 4.0 배치를 기준으로 확인합니다. 추가 생산·과거
        자료는 전체 RED PO에서 찾을 수 있습니다.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {selectItem && (
        <div>
          <label htmlFor={field + "-line"} className="mb-1 block text-sm">
            PO 품목 선택
          </label>
          <select
            id={field + "-line"}
            className={control}
            value={lineId}
            disabled={disabled || !po || itemsLoading}
            onChange={(e) => {
              const next =
                lines.find((item) => item.id === e.target.value) || null;
              setLineId(next?.id || "");
              onChange(po, next);
            }}
          >
            <option value="">
              {itemsLoading ? "품목 불러오는 중…" : "품목을 선택해 주세요"}
            </option>
            {lines.map((item) => (
              <option key={item.id} value={item.id} disabled={!item.sku_code}>
                {[
                  item.buyer_style_no ||
                    item.buyer_style_code ||
                    "스타일 미등록",
                  item.upc ? "UPC " + item.upc : null,
                  item.color,
                  item.size,
                  item.description,
                  item.pending_qty !== undefined
                    ? "잔량 " + Number(item.pending_qty).toLocaleString()
                    : null,
                  item.has_batch === true ? "4.0 등록됨" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </option>
            ))}
          </select>
          {po && !itemsLoading && !lines.length && !itemsError && (
            <p className="mt-1 text-sm text-muted-foreground">
              선택한 PO에 등록된 품목이 없습니다.
            </p>
          )}
          {itemsError && (
            <p role="alert" className="mt-1 text-sm text-red-700">
              {itemsError}
            </p>
          )}
          {selected && (
            <p className="mt-2 text-sm">
              스타일{" "}
              {selected.buyer_style_no || selected.buyer_style_code || "—"} ·
              UPC {selected.upc || "미등록"} · 배치 품목 코드{" "}
              <strong>{selected.sku_code}</strong>
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            UPC를 배치 품목 코드로 사용하며, UPC가 없으면 바이어 스타일 번호를
            사용합니다.
          </p>
        </div>
      )}
    </div>
  );
}
