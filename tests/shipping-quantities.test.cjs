const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
let tables = {};
let writes = 0;
class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
  }
  select() {
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  eq(k, v) {
    this.filters.push((r) => r[k] === v);
    return this;
  }
  in(k, values) {
    this.filters.push((r) => values.includes(r[k]));
    return this;
  }
  or(expression) {
    const parts = expression.split(",").map((p) => p.split("."));
    this.filters.push((r) =>
      parts.some(([k, op, ...v]) =>
        op === "is" ? r[k] == null : String(r[k]) === v.join("."),
      ),
    );
    return this;
  }
  update(patch) {
    this.patch = patch;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  then(resolve, reject) {
    try {
      const result = (tables[this.table] ?? []).filter((r) =>
        this.filters.every((f) => f(r)),
      );
      if (this.patch) {
        writes++;
        result.forEach((r) => Object.assign(r, this.patch));
      }
      return Promise.resolve({
        data: this.single ? (result[0] ?? null) : structuredClone(result),
        error: null,
      }).then(resolve, reject);
    } catch (e) {
      return Promise.reject(e).then(resolve, reject);
    }
  }
}
const db = { from: (name) => new Query(name) };
const cache = {};
function load(name) {
  if (cache[name]) return cache[name].exports;
  const filename = path.join(root, name);
  const module = { exports: {} };
  cache[name] = module;
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const req = (spec) => {
    if (spec === "@/lib/supabaseAdmin") return { supabaseAdmin: db };
    if (spec === "@/lib/expectedMarginSnapshot")
      return { createExpectedMarginSnapshot: async () => ({ created: 0 }) };
    if (spec === "@/lib/api-guard")
      return { assertApiPermission: async () => null };
    if (spec === "next/server")
      return {
        NextResponse: {
          json: (body, options) => ({ body, status: options?.status ?? 200 }),
        },
      };
    if (spec.startsWith("@/")) return load("src/" + spec.slice(2) + ".ts");
    return require(spec);
  };
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, {
    filename,
  })(req, module, module.exports);
  return module.exports;
}
const rules = load("src/lib/shippingQuantityRules.ts");
const guard = load("src/lib/shippingQuantityGuard.ts");
const cancel = load("src/app/api/orders/[id]/cancel-lines/route.ts");
const source = [
  {
    id: "s1",
    po_line_id: "p1",
    po_no: "PO1",
    style_no: "JM1",
    shipped_qty: 40,
    po_lines: {
      buyer_style_no: "BUY1",
      jm_style_no: "JM1",
      po_headers: { po_no: "PO1" },
    },
  },
  {
    id: "s2",
    po_line_id: "p2",
    po_no: "PO2",
    style_no: "JM1",
    shipped_qty: 20,
    po_lines: {
      buyer_style_no: "BUY1",
      jm_style_no: "JM1",
      po_headers: { po_no: "PO2" },
    },
  },
];
const docs = [
  { po_no: "PO1", style_no: "BUY1", qty: 40 },
  { po_no: "PO2", style_no: "BUY1", qty: 20 },
];
function fixture() {
  writes = 0;
  tables = {
    po_headers: [
      { id: "po1", po_no: "PO1", status: "CONFIRMED", is_deleted: false },
    ],
    po_lines: [
      {
        id: "p1",
        po_header_id: "po1",
        qty: 100,
        qty_cancelled: 0,
        is_deleted: false,
      },
      {
        id: "p2",
        po_header_id: "po1",
        qty: 20,
        qty_cancelled: 0,
        is_deleted: false,
      },
    ],
    shipments: [
      { id: "sh1", status: "SHIPPED", is_deleted: false },
      { id: "sh2", status: "CANCELLED", is_deleted: false },
    ],
    shipment_lines: [
      { ...source[0], shipment_id: "sh1", is_deleted: false },
      {
        id: "stale",
        shipment_id: "sh2",
        po_line_id: "p1",
        shipped_qty: 50,
        is_deleted: false,
      },
    ],
    invoice_headers: [],
    invoice_lines: [],
    invoice_shipments: [],
    packing_list_headers: [],
  };
}
const cancelQty = async (qty, id = "p1") =>
  cancel.PUT(
    { json: async () => ({ lines: [{ po_line_id: id, qty_cancelled: qty }] }) },
    { params: { id: "PO1" } },
  );
test("integer quantities and cancellation bounds", () => {
  assert.equal(rules.cancellableQuantity(100, 40), 60);
  for (const invalid of [
    -1,
    1.5,
    NaN,
    Infinity,
    "",
    null,
    true,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assert.throws(() => rules.quantity(invalid));
});
test("packing carton splits and JM/buyer aliases preserve each PO total", () => {
  rules.assertDocumentQuantities(
    source,
    [{ ...docs[0], qty: 30 }, { ...docs[0], qty: 10 }, docs[1]],
    "PL",
  );
  rules.assertDocumentQuantities(
    source,
    [{ ...docs[0], style_no: "JM1" }, docs[1]],
    "PL",
  );
});
test("equal grand total cannot hide a mismatch between POs", () => {
  assert.throws(() =>
    rules.assertDocumentQuantities(
      source,
      [
        { ...docs[0], qty: 39 },
        { ...docs[1], qty: 21 },
      ],
      "Invoice",
    ),
  );
});
test("missing, foreign, deleted, negative or fractional document quantities fail", () => {
  for (const changed of [
    [],
    [{ ...docs[0], po_no: "FOREIGN" }, docs[1]],
    [{ ...docs[0], is_deleted: true }, docs[1]],
    [{ ...docs[0], qty: -1 }, docs[1]],
    [{ ...docs[0], qty: 40.5 }, docs[1]],
  ]) {
    assert.throws(() => rules.assertDocumentQuantities(source, changed, "PL"));
  }
});
test("a foreign source ID or relabeled PO cannot be used to bypass matching", () => {
  assert.throws(() =>
    rules.assertDocumentQuantities(
      source,
      [{ ...docs[0], shipment_line_id: "foreign" }, docs[1]],
      "Invoice",
    ),
  );
  assert.throws(() =>
    rules.assertDocumentQuantities(
      source,
      [{ ...docs[0], shipment_line_id: "s1", po_no: "PO2" }, docs[1]],
      "Invoice",
    ),
  );
});
test("100 ordered, 40 shipped: Cancel Qty 60 succeeds without cancelling whole PO", async () => {
  fixture();
  const response = await cancelQty(60);
  assert.equal(response.status, 200);
  assert.equal(tables.po_lines[0].qty_cancelled, 60);
  assert.equal(tables.po_headers[0].status, "CONFIRMED");
});
test("over-cancellation fails before writes", async () => {
  fixture();
  const response = await cancelQty(61);
  assert.equal(response.status, 409);
  assert.equal(writes, 0);
});
test("cancel quantity can be restored to zero", async () => {
  fixture();
  tables.po_lines[0].qty_cancelled = 60;
  assert.equal((await cancelQty(0)).status, 200);
  assert.equal(tables.po_lines[0].qty_cancelled, 0);
});
test("partial cancellation request does not mark untouched PO lines cancelled", async () => {
  fixture();
  tables.shipment_lines = [];
  assert.equal((await cancelQty(100)).status, 200);
  assert.equal(tables.po_headers[0].status, "CONFIRMED");
  assert.equal((await cancelQty(20, "p2")).status, 200);
  assert.equal(tables.po_headers[0].status, "CANCELLED");
});
test("unknown cancellation line fails before writes", async () => {
  fixture();
  assert.equal((await cancelQty(1, "foreign")).status, 400);
  assert.equal(writes, 0);
});
test("deleted/cancelled allocations are ignored even when every shipment is inactive", async () => {
  fixture();
  tables.shipments[0].status = "CANCELLED";
  assert.equal((await guard.allocatedByPoLine(["p1"])).get("p1"), undefined);
});
test("draft allocations reserve quantity", async () => {
  fixture();
  tables.shipments[0].status = "DRAFT";
  assert.equal((await guard.allocatedByPoLine(["p1"])).get("p1"), 40);
});
test("new shipment deducts cancellation and aggregates duplicate/split PO lines", async () => {
  fixture();
  tables.po_lines[0].qty_cancelled = 30;
  await guard.assertShipmentCapacity(
    [{ po_line_id: "p1", shipped_qty: 30 }],
    ["po1"],
  );
  await assert.rejects(
    guard.assertShipmentCapacity(
      [
        { po_line_id: "p1", shipped_qty: 20 },
        { po_line_id: "p1", shipped_qty: 11 },
      ],
      ["po1"],
    ),
  );
  tables.po_lines[0].qty_cancelled = 60;
  await assert.rejects(
    guard.assertShipmentCapacity(
      [{ po_line_id: "p1", shipped_qty: 1 }],
      ["po1"],
    ),
  );
});
test("new shipment rejects lines belonging to another PO", async () => {
  fixture();
  await assert.rejects(
    guard.assertShipmentCapacity(
      [{ po_line_id: "p1", shipped_qty: 1 }],
      ["other"],
    ),
  );
});
test("invoice_shipments association locks shipment editing/splitting/cancellation", async () => {
  fixture();
  tables.invoice_shipments = [{ shipment_id: "sh1", invoice_id: "i1" }];
  tables.invoice_headers = [{ id: "i1", status: "DRAFT" }];
  await assert.rejects(guard.assertShipmentEditable("sh1"));
});
test("packing list association also locks shipment quantity", async () => {
  fixture();
  tables.packing_list_headers = [
    { id: "pl1", shipment_id: "sh1", status: "DRAFT" },
  ];
  await assert.rejects(guard.assertShipmentEditable("sh1"));
});
function invoiceFixture() {
  fixture();
  tables.invoice_headers = [{ id: "i1", shipment_id: "sh1", status: "DRAFT" }];
  tables.invoice_lines = [
    {
      id: "il1",
      invoice_id: "i1",
      shipment_id: "sh1",
      shipment_line_id: "s1",
      po_line_id: "p1",
      po_no: "PO1",
      style_no: "BUY1",
      qty: 40,
    },
  ];
  return tables.invoice_headers[0];
}
test("invoice save validates final merged lines; harmless metadata edits work", async () => {
  const header = invoiceFixture();
  await guard.validateInvoiceSave(header, [{ id: "il1", hs_code: "123" }]);
  await assert.rejects(
    guard.validateInvoiceSave(header, [{ id: "il1", qty: 39 }]),
  );
  await assert.rejects(
    guard.validateInvoiceSave(header, [{ id: "il1", is_deleted: true }]),
  );
  assert.equal(writes, 0);
});
test("invoice save rejects foreign IDs, duplicate IDs and changed source links", async () => {
  const header = invoiceFixture();
  for (const incoming of [
    [{ id: "other", qty: 40 }],
    [{ id: "il1" }, { id: "il1" }],
    [{ id: "il1", shipment_id: "sh2" }],
  ])
    await assert.rejects(guard.validateInvoiceSave(header, incoming));
});
test("invoice confirmation detects historical mismatches", async () => {
  const header = invoiceFixture();
  tables.invoice_lines[0].qty = 100;
  await assert.rejects(guard.validateInvoiceSave(header));
});
test("packing save accepts carton splits, rejects mismatch and mismatched linked invoice", async () => {
  invoiceFixture();
  const header = { shipment_id: "sh1", invoice_id: "i1" };
  await guard.validatePackingSave(header, [
    { ...docs[0], qty: 30 },
    { ...docs[0], qty: 10 },
  ]);
  await assert.rejects(
    guard.validatePackingSave(header, [{ ...docs[0], qty: 41 }]),
  );
  tables.invoice_lines[0].qty = 39;
  await assert.rejects(guard.validatePackingSave(header, [docs[0]]));
});

const invoiceRoute = load("src/app/api/invoices/[id]/route.ts");
const confirmRoute = load("src/app/api/invoices/[id]/confirm/route.ts");
const orderRoute = load("src/app/api/orders/[id]/route.ts");
const uuid = "11111111-1111-4111-8111-111111111111";
test("actual Invoice PUT rejects mismatch before any header or line write", async () => {
  invoiceFixture();
  tables.invoice_headers[0].id = uuid;
  tables.invoice_lines[0].invoice_id = uuid;
  tables.invoice_headers[0].is_deleted = false;
  const res = await invoiceRoute.PUT(
    { json: async () => ({ lines: [{ id: "il1", qty: 39 }] }) },
    { params: Promise.resolve({ id: uuid }) },
  );
  assert.equal(res.status, 409);
  assert.equal(writes, 0);
});
test("actual Invoice confirm endpoint rejects a historical mismatch", async () => {
  invoiceFixture();
  tables.invoice_lines[0].qty = 39;
  const res = await confirmRoute.POST(
    { json: async () => ({}) },
    { params: { id: "i1" } },
  );
  assert.equal(res.status, 409);
  assert.equal(writes, 0);
});
test("actual PO PUT prevents over-cancellation before saving header", async () => {
  fixture();
  tables.po_headers[0].id = uuid;
  tables.po_lines.forEach((r, i) => {
    r.po_header_id = uuid;
    r.line_no = i + 1;
  });
  const res = await orderRoute.PUT(
    {
      json: async () => ({
        header: { status: "CONFIRMED" },
        lines: [
          { id: "p1", line_no: 1, qty: 100, qty_cancelled: 61 },
          { id: "p2", line_no: 2, qty: 20 },
        ],
      }),
    },
    { params: { id: uuid } },
  );
  assert.equal(res.status, 409);
  assert.equal(writes, 0);
});
test("document creation rejects cancelled or empty shipments", async () => {
  fixture();
  await assert.rejects(guard.validateShipmentSource("sh2"));
  tables.shipment_lines = [];
  await assert.rejects(guard.validateShipmentSource("sh1"));
});
test("actual PO PUT saves remaining cancellation and restores it to zero", async () => {
  fixture();
  tables.po_headers[0].id = uuid;
  tables.po_lines.forEach((r, i) => {
    r.po_header_id = uuid;
    r.line_no = i + 1;
  });
  for (const qty of [60, 0]) {
    const res = await orderRoute.PUT(
      {
        json: async () => ({
          header: { status: "CONFIRMED" },
          lines: [
            { id: "p1", line_no: 1, qty: 100, qty_cancelled: qty },
            { id: "p2", line_no: 2, qty: 20 },
          ],
        }),
      },
      { params: { id: uuid } },
    );
    assert.equal(res.status, 200, res.body.error);
    assert.equal(tables.po_lines[0].qty_cancelled, qty);
    assert.equal(tables.po_headers[0].status, "CONFIRMED");
  }
});
