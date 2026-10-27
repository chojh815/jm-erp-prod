const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");
let tables = {},
  failures = {};
class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
  }
  select(columns) {
    this.columns = columns;
    return this;
  }
  eq(k, v) {
    this.filters.push((r) => r[k] === v);
    return this;
  }
  neq(k, v) {
    this.filters.push((r) => r[k] !== v);
    return this;
  }
  in(k, v) {
    this.filters.push((r) => v.includes(r[k]));
    return this;
  }
  order() {
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  then(resolve, reject) {
    try {
      if (failures[this.table])
        return Promise.resolve({
          data: null,
          error: { message: "Read failed" },
        }).then(resolve, reject);
      let data = (tables[this.table] || []).filter((r) =>
        this.filters.every((f) => f(r)),
      );
      if (this.columns !== "*") {
        const cols = this.columns.split(",");
        data = data.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
      }
      return Promise.resolve({
        data: this.single ? (data[0] ?? null) : structuredClone(data),
        error: null,
      }).then(resolve, reject);
    } catch (e) {
      return Promise.reject(e).then(resolve, reject);
    }
  }
}
const cache = {};
function load(name) {
  if (cache[name]) return cache[name].exports;
  const filename = path.resolve(__dirname, "..", name);
  const m = { exports: {} };
  cache[name] = m;
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const req = (s) =>
    s === "@/lib/supabaseAdmin"
      ? { supabaseAdmin: { from: (t) => new Query(t) } }
      : s === "next/server"
        ? {
            NextResponse: {
              json: (body, opts) => ({ body, status: opts?.status ?? 200 }),
            },
          }
        : s.startsWith("@/")
          ? load("src/" + s.slice(2) + ".ts")
          : require(s);
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, {
    filename,
  })(req, m, m.exports);
  return m.exports;
}
const money = load("src/lib/poAmounts.ts");
const exportsHelper = load("src/lib/poAmountExport.ts");
const route = load("src/app/api/orders/list/route.ts");
function fixture() {
  failures = {};
  tables = {
    po_headers: [
      {
        id: "po1",
        po_no: "4500162462",
        buyer_name: "RED BEAUTY INC",
        buyer_brand_name: "RED",
        status: "CONFIRMED",
        currency: "USD",
        is_deleted: false,
      },
    ],
    po_lines: [
      {
        id: "l1",
        po_header_id: "po1",
        line_no: 1,
        buyer_style_no: "A",
        qty: 100,
        qty_cancelled: 10,
        unit_price: 1,
        amount: 100,
        is_deleted: false,
      },
      {
        id: "l2",
        po_header_id: "po1",
        line_no: 2,
        buyer_style_no: "B",
        qty: 100,
        qty_cancelled: 0,
        unit_price: 10,
        amount: 1000,
        is_deleted: false,
      },
    ],
    shipment_lines: [
      {
        id: "sl1",
        po_line_id: "l1",
        shipment_id: "sh1",
        shipped_qty: 40,
        is_deleted: false,
      },
    ],
    shipments: [
      { id: "sh1", status: "SHIPPED", shipment_no: "SHP1", is_deleted: false },
    ],
    po_line_images: [],
    buyer_brands: [],
    work_sheet_lines: [],
  };
}
const get = async (query) =>
  route.GET(new Request("http://localhost/api/orders/list?" + query));
test("line amount uses its precise saved commercial amount and reconciles cents", () => {
  const r = money.calculatePoLineAmounts(
    { qty: 3, unit_price: 0.33, amount: 1, qty_cancelled: 1 },
    1,
  );
  assert.deepEqual(r.amounts, {
    order: 1,
    shipped: 0.33,
    cancelled: 0.33,
    pending: 0.34,
  });
});
test("mixed prices are computed per style, not blended across the PO", () => {
  const r = money.addPoAmounts([
    money.calculatePoLineAmounts({ qty: 100, amount: 100 }, 100).amounts,
    money.calculatePoLineAmounts({ qty: 100, amount: 1000 }, 0).amounts,
  ]);
  assert.deepEqual(r, {
    order: 1100,
    shipped: 100,
    cancelled: 0,
    pending: 1000,
  });
});
test("rounding always reconciles for shipment/cancellation combinations", () => {
  for (let qty = 1; qty < 35; qty++)
    for (let ship = 0; ship <= qty; ship++) {
      const cancel = Math.floor((qty - ship) / 2);
      const { amounts: a } = money.calculatePoLineAmounts(
        { qty, amount: 123.47, qty_cancelled: cancel },
        ship,
      );
      assert.equal(
        Math.round(a.order * 100),
        Math.round(a.shipped * 100) +
          Math.round(a.cancelled * 100) +
          Math.round(a.pending * 100),
      );
      assert.ok(a.pending >= 0);
    }
});
test("unshipped draft reservations remain pending in the commercial balance", () => {
  const r = money.calculatePoLineAmounts({ qty: 100, amount: 100 }, 0, 100);
  assert.equal(r.amounts.pending, 100);
  assert.equal(r.amounts.shipped, 0);
  assert.equal(r.totals.remainingQty, 0);
});
test("fully cancelled balance is zero even for legacy header-only cancellations", () => {
  assert.deepEqual(
    money.calculatePoLineAmounts({ qty: 100, amount: 1000 }, 40, 40, true)
      .amounts,
    { order: 1000, shipped: 400, cancelled: 600, pending: 0 },
  );
});
test("split shipments add to the line shipped total, and cancelled/deleted shipments are excluded", async () => {
  fixture();
  tables.shipment_lines.push(
    {
      id: "sl2",
      po_line_id: "l1",
      shipment_id: "sh1",
      shipped_qty: 20,
      is_deleted: false,
    },
    {
      id: "deleted",
      po_line_id: "l2",
      shipment_id: "old",
      shipped_qty: 100,
      is_deleted: false,
    },
  );
  tables.shipments.push({ id: "old", status: "CANCELLED", is_deleted: false });
  const res = await get("q=4500162462");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items[0].amounts, {
    order: 1100,
    shipped: 60,
    cancelled: 10,
    pending: 1030,
  });
});
test("list API supplies all four amounts and Pending Only totals use only pending", async () => {
  fixture();
  const res = await get("pending_only=true");
  assert.equal(res.status, 200);
  assert.equal(res.body.amountBasis, "pending");
  assert.equal(res.body.items[0].subtotal, 1100);
  assert.deepEqual(res.body.items[0].amounts, {
    order: 1100,
    shipped: 40,
    cancelled: 10,
    pending: 1050,
  });
  assert.equal(res.body.grandTotalsByCurrency.USD, 1050);
  assert.equal(res.body.items[0].sortAmount, 1050);
});
test("normal list totals retain original order amount", async () => {
  fixture();
  const res = await get("");
  assert.equal(res.body.amountBasis, "order");
  assert.equal(res.body.grandTotalsByCurrency.USD, 1100);
});
test("detail amounts match header totals and cancellation is selected from DB", async () => {
  fixture();
  const list = await get("");
  const detail = await get("detailFor=po1");
  assert.deepEqual(
    money.addPoAmounts(detail.body.lines.map((l) => l.amounts)),
    list.body.items[0].amounts,
  );
  assert.equal(detail.body.lines[0].totals.pendingQty, 50);
});
test("pending list excludes balance closed by shipping plus cancellation", async () => {
  fixture();
  tables.po_lines = tables.po_lines.slice(0, 1);
  tables.po_lines[0].qty_cancelled = 60;
  assert.equal((await get("pending_only=true")).body.total, 0);
  assert.equal((await get("")).body.items[0].status, "SHIPPED");
});
test("currency totals are separate and no meaningless mixed scalar total is returned", async () => {
  fixture();
  tables.po_headers.push({
    ...tables.po_headers[0],
    id: "po2",
    po_no: "EURPO",
    currency: "EUR",
  });
  tables.po_lines.push({
    ...tables.po_lines[1],
    id: "eurline",
    po_header_id: "po2",
    qty: 1,
    amount: 10,
  });
  const res = await get("pending_only=true");
  assert.deepEqual(res.body.grandTotalsByCurrency, { USD: 1050, EUR: 10 });
  assert.equal(res.body.grandTotal, null);
});
test("vendor filter applies to amount breakdown and exported line selection", async () => {
  fixture();
  tables.work_sheet_lines = [
    { po_line_id: "l2", vendor_id: "v1", is_deleted: false },
  ];
  const res = await get("vendor_id=v1&pending_only=true");
  assert.deepEqual(res.body.items[0].amounts, {
    order: 1000,
    shipped: 0,
    cancelled: 0,
    pending: 1000,
  });
  assert.deepEqual(res.body.items[0].lineIds, ["l2"]);
});
test("DB read errors do not silently show zero shipped balances", async () => {
  fixture();
  failures.shipment_lines = true;
  assert.equal((await get("")).status, 500);
  assert.equal((await get("detailFor=po1")).status, 500);
});
test("Excel and PDF rows preserve four numeric amounts and currency-separated totals", async () => {
  fixture();
  const list = await get("");
  const detail = await get("detailFor=po1");
  const headers = list.body.items.map((h) => ({
    ...h,
    mainBuyerBrand: h.buyerBrandName,
  }));
  const rows = exportsHelper.buildPoAmountExportRows(headers, {
    po1: detail.body.lines,
  });
  assert.equal(exportsHelper.poAmountExportColumns.length, 15);
  assert.deepEqual(
    rows.find((r) => r.kind === "po_total").values.slice(10, 14),
    [1100, 40, 10, 1050],
  );
  assert.deepEqual(
    rows.find((r) => r.kind === "currency_total").values.slice(10, 14),
    [1100, 40, 10, 1050],
  );
  assert.ok(rows.every((r) => r.values.length === 15));
});
test("export does not include styles outside the selected vendor", async () => {
  fixture();
  tables.work_sheet_lines = [
    { po_line_id: "l2", vendor_id: "v1", is_deleted: false },
  ];
  const list = await get("vendor_id=v1");
  const detail = await get("detailFor=po1");
  const rows = exportsHelper.buildPoAmountExportRows(list.body.items, {
    po1: detail.body.lines,
  });
  assert.equal(rows.filter((r) => r.kind === "line").length, 1);
  assert.equal(rows[0].values[3], "B");
});
