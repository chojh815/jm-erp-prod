const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function load(relativePath, db) {
  const source = fs.readFileSync(path.join(__dirname, "../src", relativePath), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const module = { exports: {} };
  new Function("require", "exports", "module", outputText)((name) => {
    if (name === "next/server") return { NextResponse: { json: (body) => body } };
    if (name === "@/lib/supabaseAdmin") return { supabaseAdmin: db };
    return load(name.replace(/^@\//, "") + ".ts", db);
  }, module.exports, module);
  return module.exports;
}

class Query {
  constructor(rows) { this.rows = rows; }
  select() { return this; }
  eq(column, value) {
    this.rows = this.rows.filter((row) => row[column] === value);
    return this;
  }
  in(column, values) {
    this.rows = this.rows.filter((row) => values.includes(row[column]));
    return this;
  }
  or() { assert.equal(this.rows.length, 0); return this; }
  order() { return this; }
  limit(size) {
    this.rows = this.rows.slice(0, size);
    return this;
  }
  then(resolve, reject) {
    return Promise.resolve({ data: this.rows, error: null }).then(resolve, reject);
  }
}

const client = (tables) => ({ from: (table) => new Query(tables[table] ?? []) });
const url = (year) => new Request(
  "https://example.test/?preset=CUSTOM&start=" + year + "-01-01&end=" + year + "-12-31",
);
const po = (id, extra = {}) => ({
  id, po_no: id, buyer_id: "buyer", buyer_name: "Buyer", order_date: "2026-01-01",
  requested_ship_date: "2026-05-01", status: "CONFIRMED", is_deleted: false,
  ...extra,
});
const ship = (id, extra = {}) => ({
  id, shipment_no: id, buyer_id: "buyer", buyer_name: "Buyer",
  status: "SHIPPED", is_deleted: false, created_at: "2026-05-01",
  ...extra,
});
const invoice = (id, extra = {}) => ({
  id, invoice_no: id, buyer_id: "buyer", status: "PAID",
  is_deleted: false, total_amount: 50, invoice_date: "2026-05-01", ...extra,
});
const line = (id, po_header_id, extra = {}) => ({
  id, po_header_id, qty: 10, amount: 100, unit_price: 10, is_deleted: false, ...extra,
});
const shipmentLine = (shipment_id, po_line_id, shipped_qty, extra = {}) => ({
  shipment_id, po_line_id, shipped_qty, is_deleted: false, style_no: "A",
  unit_price: 10, ...extra,
});

test("overview assigns invoiced shipping to the invoice year and counts linked shipments once", async () => {
  const db = client({
    shipments: [ship("historical"), ship("replacement"), ship("unbilled"), ship("split")],
    invoice_headers: [
      invoice("historical-invoice", { shipment_id: "historical", invoice_date: "2025-12-26" }),
      invoice("replacement-invoice", { shipment_id: "replacement" }),
      invoice("deleted-invoice", { shipment_id: "unbilled", is_deleted: true }),
    ],
    invoice_shipments: [
      { invoice_id: "replacement-invoice", shipment_id: "replacement", is_deleted: false },
      { invoice_id: "replacement-invoice", shipment_id: "split", is_deleted: false },
    ],
  });
  const { GET } = load("app/api/dashboards/overview/route.ts", db);
  for (const [year, count] of [[2025, "1"], [2026, "2"]]) {
    const result = await GET(url(year));
    const shipped = result.kpis.find((row) => row.key === "shipped");
    assert.equal(shipped.value_usd, 50);
    assert.equal(shipped.sub_value, count);
    assert.equal(result.trend.reduce((sum, row) => sum + row.shipped_usd, 0), 50);
  }
});

test("overview uses remaining quantity after splits and cancellations for pending and at risk", async () => {
  const db = client({
    po_headers: [po("partial", { fulfillment_status: "PARTIAL" })],
    po_lines: [line("line", "partial", { qty_cancelled: 2 })],
    shipments: [ship("s1"), ship("s2"), ship("draft", { status: "DRAFT" }), ship("removed", { is_deleted: true })],
    shipment_lines: [
      shipmentLine("s1", "line", 3), shipmentLine("s2", "line", 2),
      shipmentLine("draft", "line", 2), shipmentLine("removed", "line", 2),
      shipmentLine("s1", "line", 1, { is_deleted: true }),
    ],
  });
  const { GET } = load("app/api/dashboards/overview/route.ts", db);
  const result = await GET(url(2026));
  assert.equal(result.kpis.find((row) => row.key === "orders").value_usd, 100);
  assert.equal(result.kpis.find((row) => row.key === "pending").value_usd, 30);
  assert.equal(result.lists.at_risk[0].amount_usd, 30);
});

test("shipment profitability excludes the superseded PO and keeps live unbilled shipments", async () => {
  const db = client({
    po_headers: [
      po("old-order", { is_deleted: true }), po("new-order"), po("open-order"),
      po("historical-order", { is_deleted: true }),
    ],
    po_lines: [
      line("old-line", "old-order"), line("replacement-line", "new-order"),
      line("open-line", "open-order"), line("historical-line", "historical-order"),
    ],
    shipments: [
      ship("old", { etd: "2026-05-01" }), ship("replacement"),
      ship("open", { etd: "2026-05-02" }), ship("historical"),
    ],
    shipment_lines: [
      shipmentLine("old", "old-line", 10), shipmentLine("replacement", "replacement-line", 10),
      shipmentLine("open", "open-line", 2), shipmentLine("historical", "historical-line", 5),
    ],
    invoice_headers: [
      invoice("deleted-invoice", { shipment_id: "old", is_deleted: true }),
      invoice("new-invoice"),
      invoice("historical-invoice", { shipment_id: "historical", invoice_date: "2025-12-26" }),
    ],
    invoice_shipments: [
      { invoice_id: "new-invoice", shipment_id: "replacement", is_deleted: false },
    ],
  });
  const { GET } = load("app/api/dashboards/profitability/shipments/route.ts", db);
  const current = await GET(url(2026));
  assert.equal(current.ok, true, current.error);
  assert.deepEqual(current.shipments.map((row) => row.shipment_no).sort(), ["open", "replacement"]);
  assert.equal(current.kpis.revenue_usd, 120);
  const prior = await GET(url(2025));
  assert.deepEqual(prior.shipments.map((row) => row.shipment_no), ["historical"]);
});
