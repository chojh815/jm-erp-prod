const { test } = require("node:test");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  path = require("node:path"),
  ts = require("typescript");
function load(file, mocks = {}) {
  const m = { exports: {} };
  const filename = path.resolve(__dirname, "..", file);
  const js = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  vm.runInThisContext("(function(require,module,exports){" + js + "\n})", {
    filename,
  })((s) => (s in mocks ? mocks[s] : require(s)), m, m.exports);
  return m.exports;
}
const rules = load("src/lib/redBatchCode.ts");
const make = (date, extra = {}) =>
  rules.makeRedBatchCode({ mfgDate: date, labelType: "V", ...extra });
test("ISO week-year and 53rd week match the new guideline across year boundaries", () => {
  for (const [date, code] of [
    ["2026-01-05", "JZ02AV0"],
    ["2026-09-21", "JZ39AV0"],
    ["2026-12-31", "JZ53DV0"],
    ["2027-01-01", "JZ53EV0"],
    ["2027-01-03", "JZ53GV0"],
    ["2027-01-04", "JA01AV0"],
  ])
    assert.equal(make(date), code);
});
test("every weekday has a separate 1st, 2nd and 3rd run code", () => {
  const letters = ["ABCDEFG", "HJKLNPQ", "RSTUWXY"];
  for (let run = 1; run <= 3; run++)
    for (let day = 0; day < 7; day++)
      assert.equal(
        make(`2026-09-${21 + day}`, { runNo: run }),
        `JZ39${letters[run - 1][day]}V0`,
      );
});
test("label revisions change only the final digit, while production runs change DAY", () => {
  assert.equal(make("2026-11-19", { runNo: 2, version: 0 }), "JZ47LV0");
  assert.equal(make("2026-11-19", { runNo: 1, version: 1 }), "JZ47DV1");
  assert.equal(make("2026-11-19", { labelType: "M", version: 9 }), "JZ47DM9");
});
test("invalid dates, run counts, label types and multidigit versions cannot create misleading codes", () => {
  for (const date of [
    "2026-02-29",
    "2026-02-30",
    "2026-13-01",
    "2026-00-01",
    "2026-2-01",
    "bad",
    "",
  ])
    assert.throws(() => make(date));
  assert.equal(make("2028-02-29"), "JB09BV0");
  for (const runNo of [0, 4, -1, 1.5, "2"])
    assert.throws(() => make("2026-11-19", { runNo }));
  for (const version of [-1, 10, 0.5, NaN, "1"])
    assert.throws(() => make("2026-11-19", { version }));
  for (const labelType of ["", "X", "MM"])
    assert.throws(() => make("2026-11-19", { labelType }));
  for (const vendorInitial of ["", "12", "1", "한"])
    assert.throws(() => make("2026-11-19", { vendorInitial }));
});
test("date-only output stays stable in every supported operating timezone", () => {
  const original = process.env.TZ;
  try {
    for (const tz of [
      "UTC",
      "Asia/Seoul",
      "America/New_York",
      "Pacific/Honolulu",
    ]) {
      process.env.TZ = tz;
      assert.equal(make("2027-01-01"), "JZ53EV0");
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

const Q = "11111111-1111-4111-8111-111111111111",
  U = "33333333-3333-4333-8333-333333333333";
let identity, calls, tables, rpcResult, missing, legacyError;
class Query {
  constructor(table, client) {
    this.table = table;
    this.client = client;
    this.filters = [];
    this.action = "select";
  }
  select() {
    return this;
  }
  eq(k, v) {
    this.filters.push((r) => r[k] === v);
    return this;
  }
  gte(k, v) {
    this.filters.push((r) => r[k] >= v);
    return this;
  }
  lte(k, v) {
    this.filters.push((r) => r[k] <= v);
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  update(p) {
    this.action = "update";
    this.patch = p;
    return this;
  }
  delete() {
    this.action = "delete";
    return this;
  }
  then(resolve, reject) {
    calls.push({ table: this.table, client: this.client, action: this.action });
    if (missing && this.table === "production_batches_v4")
      return Promise.resolve({
        data: null,
        error: { code: "PGRST205", message: "table not found" },
      }).then(resolve, reject);
    if (legacyError && this.client === "legacy")
      return Promise.resolve({ data: null, error: legacyError }).then(
        resolve,
        reject,
      );
    const rows = (tables[this.table] || []).filter((r) =>
      this.filters.every((f) => f(r)),
    );
    if (this.patch) rows.forEach((r) => Object.assign(r, this.patch));
    if (this.action === "delete")
      tables[this.table] = (tables[this.table] || []).filter(
        (r) => !rows.includes(r),
      );
    return Promise.resolve({
      data: this.single ? rows[0] || null : rows,
      error: null,
    }).then(resolve, reject);
  }
}
const db = {
  from: (t) => new Query(t, "admin"),
  rpc: async (name, args) => {
    calls.push({ name, args });
    return rpcResult;
  },
};
const route = load("src/app/api/production-batches/route.ts", {
  "next/server": {
    NextResponse: {
      json: (data, opts) => ({ body: data, status: opts?.status || 200 }),
    },
  },
  "next/headers": { cookies: () => ({ getAll: () => [] }) },
  "@supabase/ssr": {
    createServerClient: () => ({ from: (t) => new Query(t, "legacy") }),
  },
  "@/lib/apiIdentity": {
    getApiIdentity: async () => {
      if (!identity)
        throw Object.assign(new Error("Not authenticated"), { status: 401 });
      return identity;
    },
  },
  "@/lib/supabaseAdmin": { supabaseAdmin: db },
  "@/lib/redBatchCode": rules,
});
const payload = (overrides = {}) => ({
  sku_code: " abc-100 ",
  mfg_date: "2026-11-19",
  vendor_initial: "J",
  run_no: 1,
  label_type: "M",
  version: 0,
  ...overrides,
});
const req = (b) => ({ json: async () => b });
function fixture() {
  identity = { user: { id: U }, permissions: ["production_batches.view"] };
  calls = [];
  missing = false;
  legacyError = null;
  tables = {
    production_batches: [
      {
        id: Q,
        buyer_code: "RED",
        mfg_date: "2026-01-01",
        created_at: "2026-01-01",
        batch_code: "JZ01DM0",
      },
    ],
    production_batches_v4: [],
  };
  rpcResult = {
    data: { id: Q, batch_code: "JZ47DM0", guideline_version: "4.0" },
  };
}
test("anonymous and users without batch access cannot read or mutate data", async () => {
  fixture();
  for (const forbidden of [null, { user: { id: U }, permissions: [] }]) {
    identity = forbidden;
    for (const fn of [
      () => route.GET(new Request("http://test")),
      () => route.POST(req(payload())),
      () => route.PUT(req({ id: Q })),
      () => route.DELETE(new Request("http://test?id=" + Q)),
    ])
      assert.equal((await fn()).status, forbidden ? 403 : 401);
  }
  assert.equal(calls.length, 0);
});
test("new production sends explicit run and original label version with authenticated actor", async () => {
  fixture();
  const r = await route.POST(req(payload({ actor_id: Q })));
  assert.equal(r.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "create_kiss_batch_v4");
  assert.equal(calls[0].args.p_actor, U);
  assert.equal(calls[0].args.p_sku, "ABC-100");
  assert.equal(calls[0].args.p_run, 1);
  assert.equal(calls[0].args.p_version, 0);
  assert.equal(calls[0].args.p_source, null);
});
test("stale clients and invalid batch inputs fail before any database write", async () => {
  fixture();
  for (const bad of [
    null,
    [],
    {},
    payload({ sku_code: "" }),
    payload({ mfg_date: "2026-02-30" }),
    payload({ version: 1 }),
    payload({ version: 10 }),
    payload({ run_no: 4 }),
    payload({ label_type: "X" }),
    payload({ source_id: "bad" }),
    payload({ vendor_initial: "1" }),
    payload({ po_no: 23 }),
  ])
    assert.equal((await route.POST(req(bad))).status, 400);
  assert.equal(calls.length, 0);
});
test("label revision carries its source and never falls back to a new production run", async () => {
  fixture();
  rpcResult = { data: { id: Q, batch_code: "JZ47DM1" } };
  assert.equal(
    (await route.POST(req(payload({ version: 1, source_id: Q })))).status,
    200,
  );
  assert.equal(calls[0].args.p_source, Q);
  assert.equal(calls[0].args.p_version, 1);
  assert.equal(calls[0].args.p_run, 1);
});
test("duplicates and revision conflicts report a conflict without silently changing the printed code", async () => {
  fixture();
  for (const code of ["23505", "40001"]) {
    rpcResult = { error: { code, message: "Conflict" } };
    assert.equal((await route.POST(req(payload()))).status, 409);
  }
  assert.equal(calls.length, 2);
});
test("legacy list remains readable before database setup and legacy permissions are honored", async () => {
  fixture();
  missing = true;
  const r = await route.GET(new Request("http://test"));
  assert.equal(r.status, 200);
  assert.equal(r.body.setupRequired, true);
  assert.equal(r.body.rows[0].guideline_version, "legacy");
  assert.ok(
    calls.find(
      (c) => c.table === "production_batches" && c.client === "legacy",
    ),
  );
  legacyError = { message: "Permission denied" };
  assert.equal((await route.GET(new Request("http://test"))).status, 500);
});
test("4.0 and legacy PO edits target their own storage and only change PO", async () => {
  fixture();
  tables.production_batches_v4 = [{ id: Q, buyer_code: "RED" }];
  for (const guideline_version of [undefined, "4.0"]) {
    assert.equal(
      (
        await route.PUT(
          req({ id: Q, guideline_version, po_no: "PO-1", version: 9 }),
        )
      ).status,
      200,
    );
  }
  assert.equal(tables.production_batches[0].po_no, "PO-1");
  assert.equal(tables.production_batches_v4[0].po_no, "PO-1");
  assert.equal(tables.production_batches_v4[0].version, undefined);
});
test("PostgREST composite RPC responses return the saved row to the screen", async () => {
  fixture();
  rpcResult = {
    data: [{ id: Q, batch_code: "JZ47DM0", guideline_version: "4.0" }],
  };
  const r = await route.POST(req(payload()));
  assert.equal(r.status, 200);
  assert.equal(r.body.row.id, Q);
});
