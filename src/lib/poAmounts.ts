export type PoAmounts = {
  order: number;
  shipped: number;
  cancelled: number;
  pending: number;
};
export type PoQuantities = {
  orderQty: number;
  shippedQty: number;
  cancelledQty: number;
  pendingQty: number;
  allocatedQty: number;
  remainingQty: number;
};
export const emptyPoAmounts = (): PoAmounts => ({
  order: 0,
  shipped: 0,
  cancelled: 0,
  pending: 0,
});
const finite = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const nonnegative = (v: unknown) => Math.max(0, finite(v));
const cents = (v: number) => Math.round((v + Number.EPSILON) * 100);

// Use each PO line's saved amount to retain its precise commercial price.
// Allocate in cents and leave the rounding remainder in pending so the four
// displayed amounts always reconcile, even for split shipments.
export function calculatePoLineAmounts(
  line: any,
  shipped: number,
  allocated = shipped,
  headerCancelled = false,
): { amounts: PoAmounts; totals: PoQuantities } {
  const orderQty = nonnegative(line.qty);
  const shippedQty = Math.min(orderQty, nonnegative(shipped));
  const cancelledQty = Math.min(
    orderQty - shippedQty,
    headerCancelled ? orderQty - shippedQty : nonnegative(line.qty_cancelled),
  );
  const pendingQty = Math.max(0, orderQty - shippedQty - cancelledQty);
  const allocatedQty = Math.min(
    orderQty - cancelledQty,
    Math.max(shippedQty, nonnegative(allocated)),
  );
  const order = cents(
    line.amount == null
      ? orderQty * nonnegative(line.unit_price_precise ?? line.unit_price)
      : nonnegative(line.amount),
  );
  const shippedCents =
    orderQty > 0
      ? Math.min(order, Math.round((order * shippedQty) / orderQty))
      : 0;
  const cancelledCents =
    orderQty > 0
      ? Math.min(
          order - shippedCents,
          Math.round((order * cancelledQty) / orderQty),
        )
      : 0;
  const finalCancelledCents =
    pendingQty === 0 && cancelledQty > 0
      ? order - shippedCents
      : cancelledCents;
  const pendingCents = order - shippedCents - finalCancelledCents;
  return {
    amounts: {
      order: order / 100,
      shipped: shippedCents / 100,
      cancelled: finalCancelledCents / 100,
      pending: pendingCents / 100,
    },
    totals: {
      orderQty,
      shippedQty,
      cancelledQty,
      pendingQty,
      allocatedQty,
      remainingQty: Math.max(0, orderQty - allocatedQty - cancelledQty),
    },
  };
}
export function addPoAmounts(values: PoAmounts[]): PoAmounts {
  const sum = emptyPoAmounts();
  for (const key of Object.keys(sum) as (keyof PoAmounts)[])
    sum[key] =
      values.reduce((total, value) => total + cents(value[key]), 0) / 100;
  return sum;
}
export function poAmountsByCurrency(
  items: { currency?: string | null; amounts: PoAmounts }[],
): Record<string, PoAmounts> {
  const grouped: Record<string, PoAmounts[]> = {};
  for (const item of items)
    (grouped[item.currency?.trim() || "Unspecified"] ??= []).push(item.amounts);
  return Object.fromEntries(
    Object.entries(grouped).map(([currency, amounts]) => [
      currency,
      addPoAmounts(amounts),
    ]),
  );
}
