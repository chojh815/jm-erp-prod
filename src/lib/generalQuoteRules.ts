export class QuoteError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type QuoteTier = {
  id: string;
  qty: number;
  offer_price: number | null;
  ship_from: string;
  remarks: string;
};
export type QuoteLine = {
  id: string;
  style_no: string;
  description: string;
  qty: number;
  unit: string;
  offer_price: number | null;
  target_price: number | null;
  remarks: string;
  costing_id: string | null;
  internal: Record<string, any>;
  tiers: QuoteTier[];
};
export type QuoteDocument = {
  header: {
    buyer_id: string | null;
    buyer_code: string;
    buyer_name: string;
    brand: string;
    subject: string;
    quotation_date: string;
    received_at: string;
    valid_until: string;
    currency: string;
    incoterm: string;
    remarks: string;
  };
  lines: QuoteLine[];
  requires_review: boolean;
  source_note: string;
};
const text = (v: any, max = 500) =>
  String(v ?? "")
    .trim()
    .slice(0, max);
function numeric(v: any, label: string, integer = false): number | null {
  if (v == null || v === "") return null;
  if (!["number", "string"].includes(typeof v))
    throw new QuoteError(label + " 값이 잘못되었습니다.");
  const n = Number(v);
  if (
    !Number.isFinite(n) ||
    n < 0 ||
    n > 1e10 ||
    (integer && !Number.isSafeInteger(n))
  )
    throw new QuoteError(label + " 값은 유효한 0 이상의 숫자여야 합니다.");
  return n;
}
function date(v: any, required = false) {
  const s = text(v, 30);
  if (!s && !required) return "";
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    !Number.isFinite(new Date(s + "T00:00:00Z").getTime()) ||
    new Date(s + "T00:00:00Z").toISOString().slice(0, 10) !== s
  )
    throw new QuoteError("올바른 날짜가 필요합니다.");
  return s;
}
export function normalizeQuote(value: any): QuoteDocument {
  const h = value?.header || {},
    currency = text(h.currency || "USD", 10).toUpperCase();
  if (
    !["USD", "CNY", "EUR", "GBP", "JPY", "KRW", "HKD", "AUD", "CAD"].includes(
      currency,
    )
  )
    throw new QuoteError("지원하지 않는 견적 통화입니다.");
  const buyer = h.buyer_id ? text(h.buyer_id) : null;
  if (buyer && !UUID.test(buyer))
    throw new QuoteError("올바른 바이어가 필요합니다.");
  if (
    !Array.isArray(value?.lines) ||
    !value.lines.length ||
    value.lines.length > 100
  )
    throw new QuoteError("견적 행은 1~100개여야 합니다.");
  const ids = new Set<string>(),
    tierIds = new Set<string>();
  const lines = value.lines.map((l: any): QuoteLine => {
    const id = text(l.id);
    if (!UUID.test(id) || ids.has(id))
      throw new QuoteError("행 ID가 잘못되었거나 중복입니다.");
    ids.add(id);
    const qty = numeric(l.qty, "수량", true);
    if (!qty || qty > 1e8) throw new QuoteError("수량은 양의 정수여야 합니다.");
    const style = text(l.style_no, 200);
    if (!style) throw new QuoteError("Style No가 필요합니다.");
    const costing = l.costing_id ? text(l.costing_id) : null;
    if (costing && !UUID.test(costing))
      throw new QuoteError("올바른 Costing ID가 필요합니다.");
    const incoming = l.tiers ?? [];
    if (!Array.isArray(incoming) || incoming.length > 50)
      throw new QuoteError("수량별 가격은 최대 50개입니다.");
    const tierKeys = new Set<string>();
    const tiers = incoming.map((t: any): QuoteTier => {
      const tid = text(t.id),
        q = numeric(t.qty, "MOQ", true),
        ship = text(t.ship_from, 100);
      if (
        !UUID.test(tid) ||
        tierIds.has(tid) ||
        !q ||
        q > 1e8 ||
        tierKeys.has(q + "|" + ship)
      )
        throw new QuoteError("MOQ 행의 ID·수량·선적지 중복을 확인해 주세요.");
      tierIds.add(tid);
      tierKeys.add(q + "|" + ship);
      return {
        id: tid,
        qty: q,
        offer_price: numeric(t.offer_price, "수량별 오퍼"),
        ship_from: ship,
        remarks: text(t.remarks, 1000),
      };
    });
    const price = numeric(l.offer_price, "오퍼 단가");
    if (price !== null && qty * price > 9e12)
      throw new QuoteError("견적 행 금액이 허용 범위를 초과합니다.");
    return {
      id,
      style_no: style,
      description: text(l.description, 2000),
      qty,
      unit: text(l.unit || "pc", 30),
      offer_price: price,
      target_price: numeric(l.target_price, "타깃 단가"),
      remarks: text(l.remarks, 2000),
      costing_id: costing,
      internal: {},
      tiers,
    };
  });
  return {
    header: {
      buyer_id: buyer,
      buyer_code: text(h.buyer_code, 100),
      buyer_name: text(h.buyer_name, 200),
      brand: text(h.brand, 200),
      subject: text(h.subject, 300),
      quotation_date: date(h.quotation_date, true),
      received_at: date(h.received_at),
      valid_until: date(h.valid_until),
      currency,
      incoterm: text(h.incoterm || "FOB", 200),
      remarks: text(h.remarks ?? h.notes, 5000),
    },
    lines,
    requires_review: !!value.requires_review,
    source_note: text(value.source_note, 1000),
  };
}
export function assertQuoteReady(d: QuoteDocument) {
  if (!d.lines.length) throw new QuoteError("견적 행이 필요합니다.", 409);
  if (d.requires_review)
    throw new QuoteError("기존 가격 출처를 확인하고 저장해 주세요.", 409);
  if (!d.header.buyer_name && !d.header.buyer_id)
    throw new QuoteError("바이어 정보가 필요합니다.");
  if (
    d.lines.some(
      (l) =>
        l.offer_price == null ||
        l.offer_price <= 0 ||
        l.tiers.some((t) => t.offer_price == null || t.offer_price <= 0),
    )
  )
    throw new QuoteError(
      "모든 행과 MOQ에 양의 최종 오퍼 단가가 필요합니다.",
      409,
    );
}
export function commercialQuote(
  d: QuoteDocument,
  qno: string,
  versionNo: number,
  status: string,
) {
  assertQuoteReady(d);
  return {
    ...d.header,
    quotation_no: qno,
    version_no: versionNo,
    status,
    lines: d.lines.map((l) => ({
      style_no: l.style_no,
      description: l.description,
      qty: l.qty,
      unit: l.unit,
      offer_price: l.offer_price!,
      amount: Math.round(l.qty * l.offer_price! * 100) / 100,
      remarks: l.remarks,
      tiers: l.tiers.map((t) => ({
        qty: t.qty,
        offer_price: t.offer_price,
        ship_from: t.ship_from,
        remarks: t.remarks,
      })),
    })),
  };
}
