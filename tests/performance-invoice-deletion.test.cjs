const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(
  path.join(__dirname, "../src/app/api/dashboards/performance/route.ts"),
  "utf8",
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});

function createRoute(tables) {
  class Query {
    constructor(table) {
      this.rows = tables[table];
    }
    select() { return this; }
    not(column, operator, value) {
      assert.equal(operator, "is");
      this.rows = this.rows.filter((row) => (row[column] ?? null) !== value);
      return this;
    }
    eq(column, value) {
      this.rows = this.rows.filter((row) => row[column] === value);
      return this;
    }
    neq(column, value) {
      this.rows = this.rows.filter((row) => row[column] !== value);
      return this;
    }
    in(column, values) {
      this.rows = this.rows.filter((row) => values.includes(row[column]));
      return this;
    }
    then(resolve, reject) {
      return Promise.resolve({ data: this.rows, error: null }).then(resolve, reject);
    }
  }

  const imports = {
    "next/server": { NextResponse: { json: (body) => body } },
    "@/app/api/_supabase": {
      createSupabaseServerClient: () => ({ from: (table) => new Query(table) }),
    },
  };
  const module = { exports: {} };
  new Function("require", "exports", "module", outputText)(
    (name) => imports[name], module.exports, module,
  );
  return module.exports.GET;
}

const po = (id, brand, amount) => ({
  id, brand, buyer_id: "buyer-1", buyer_name: "Buyer 1",
  order_date: "2026-06-01", status: "CONFIRMED", is_deleted: false,
  po_lines: [{ amount, is_deleted: false }],
});
const invoice = (id, amount, extra = {}) => ({
  id, buyer_id: "buyer-1", buyer_name: "Buyer 1", invoice_date: "2026-06-22",
  status: "PAID", total_amount: amount, is_deleted: false, ...extra,
});
const line = (invoice_id, po_line_id, amount, is_deleted = false) => ({
  invoice_id, po_line_id, amount, is_deleted,
});
const request = (dimension) =>
  new Request("https://example.test/api/dashboards/performance?dimension=" + dimension);

test("deleted invoices cannot double shipping or appear in the brand report", async () => {
  const GET = createRoute({
    po_headers: [po("po-1", "Brand A", 4435.61)],
    po_lines: [{ id: "line-1", po_header_id: "po-1" }],
    invoice_headers: [
      invoice("paid", 4435.61),
      invoice("deleted-both", 0, { status: "DELETED", is_deleted: true }),
      invoice("flag-only", 900, { is_deleted: true }),
      invoice("status-only", 800, { status: "DELETED", is_deleted: null }),
    ],
    invoice_lines: [
      line("paid", "line-1", 4435.61),
      line("deleted-both", "line-1", 4435.61, true),
      line("flag-only", "line-1", 900),
      line("status-only", "line-1", 800),
    ],
  });

  for (const dimension of ["buyer", "brand"]) {
    const result = await GET(request(dimension));
    assert.equal(result.ok, true);
    for (const period of ["monthly", "yearly"]) {
      assert.equal(result[period].length, 1);
      assert.equal(result[period][0].order_usd, 4435.61);
      assert.equal(result[period][0].ship_usd, 4435.61);
    }
    assert.equal(result.yearly_raw[0].brand_name, "Brand A");
  }
});

test("deleted lines neither inflate fallback totals nor shift brand allocations", async () => {
  const GET = createRoute({
    po_headers: [po("po-a", "Brand A", 500), po("po-b", "Brand B", 100)],
    po_lines: [{ id: "line-a", po_header_id: "po-a" }, { id: "line-b", po_header_id: "po-b" }],
    invoice_headers: [
      invoice("with-total", 200),
      invoice("fallback", 0, { status: null, is_deleted: null }),
    ],
    invoice_lines: [
      line("with-total", "line-a", 150),
      line("with-total", "line-b", 50),
      line("with-total", "line-b", 450, true),
      line("fallback", "line-a", 125, null),
      line("fallback", "line-a", 400, true),
    ],
  });

  const result = await GET(request("brand"));
  assert.equal(result.ok, true);
  assert.deepEqual(
    Object.fromEntries(result.yearly.map((row) => [row.brand_name, row.ship_usd])),
    { "Brand A": 275, "Brand B": 50 },
  );
});

test("a valid invoice header amount stays included when no active lines remain", async () => {
  const GET = createRoute({
    po_headers: [po("po-a", "Brand A", 50)],
    po_lines: [{ id: "line-a", po_header_id: "po-a" }],
    invoice_headers: [invoice("active", 50)],
    invoice_lines: [line("active", "line-a", 50, true)],
  });

  const result = await GET(request("brand"));
  assert.equal(result.ok, true);
  assert.deepEqual(
    Object.fromEntries(result.yearly.map((row) => [row.brand_name, row.ship_usd])),
    { "Brand A": 0, "—": 50 },
  );
});
