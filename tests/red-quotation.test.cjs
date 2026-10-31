const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"),
  path = require("path"),
  vm = require("vm"),
  ts = require("typescript");
const React = require("react"),
  { renderToStaticMarkup } = require("react-dom/server");
let actor, tables, rpcCalls, dbCalls, rpcFailure;
const Q = "11111111-1111-4111-8111-111111111111",
  V = "22222222-2222-4222-8222-222222222222";
class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
    dbCalls.push(table);
  }
  select() {
    return this;
  }
  eq(k, v) {
    this.filters.push((r) => r[k] === v);
    return this;
  }
  is(k, v) {
    return this.eq(k, v);
  }
  not(k, op, v) {
    this.filters.push((r) => r[k] !== v);
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  maybeSingle() {
    this.one = true;
    return this;
  }
  update(p) {
    this.patch = p;
    return this;
  }
  then(resolve, reject) {
    try {
      let r = (tables[this.table] || []).filter((x) =>
        this.filters.every((f) => f(x)),
      );
      if (this.patch) r.forEach((x) => Object.assign(x, this.patch));
      return Promise.resolve({
        data: this.one ? r[0] || null : structuredClone(r),
        error: null,
      }).then(resolve, reject);
    } catch (e) {
      return Promise.reject(e).then(resolve, reject);
    }
  }
}
const db = {
  from: (t) => new Query(t),
  rpc: async (name, args) => {
    rpcCalls.push({ name, args });
    return rpcFailure
      ? { error: rpcFailure }
      : {
          data:
            name === "red_save_document"
              ? {
                  revision: args.p_expected_revision + 1,
                  document: args.p_document,
                }
              : name === "red_create_revision"
                ? {
                    id: "new-id",
                    new_version_id: "new-id",
                    version_no: 3,
                    status: "DRAFT",
                  }
                : { status: "SENT" },
          error: null,
        };
  },
};
const cache = {};
function load(name) {
  if (cache[name]) return cache[name].exports;
  const module = { exports: {} };
  cache[name] = module;
  const filename = path.resolve(__dirname, "..", name),
    js = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
      },
    }).outputText;
  const request = (s) =>
    s === "@/lib/supabaseAdmin"
      ? { supabaseAdmin: db }
      : s === "@/lib/apiIdentity"
        ? {
            getApiIdentity: async () => {
              if (!actor) {
                const e = new Error("Not authenticated");
                e.status = 401;
                throw e;
              }
              return actor;
            },
          }
        : s === "next/server"
          ? {
              NextResponse: {
                json: (body, options) => ({
                  body,
                  status: options?.status || 200,
                }),
              },
            }
          : s.startsWith("@/")
            ? load("src/" + s.slice(2) + ".ts")
            : s === "./PrintButton"
              ? {
                  __esModule: true,
                  default: () => React.createElement("button", {}, "Print"),
                }
              : require(s);
  vm.runInThisContext(`(function(require,module,exports){${js}\n})`, {
    filename,
  })(request, module, module.exports);
  return module.exports;
}
const rules = load("src/lib/redQuoteDocument.ts"),
  diff = load("src/lib/redQuotationDiff.ts"),
  exportsLib = load("src/lib/redQuoteExport.ts");
const docRoute = load(
    "src/app/api/red/quotation-versions/[versionId]/document/route.ts",
  ),
  matrix = load(
    "src/app/api/red/quotation-versions/[versionId]/matrix/route.ts",
  ),
  costs = load("src/app/api/red/quotation-versions/[versionId]/costs/route.ts"),
  versions = load("src/app/api/red/quotations/[id]/versions/route.ts"),
  quote = load("src/app/api/red/quotations/[id]/route.ts"),
  list = load("src/app/api/red/quotations/route.ts"),
  excel = load("src/app/api/red/quotation-versions/[versionId]/excel/route.ts"),
  sent = load("src/app/api/red/quotation-versions/[versionId]/sent/route.ts"),
  pdf = load("src/app/red/quotation-versions/[versionId]/pdf/page.tsx");
function input() {
  return {
    inputs: {
      unit_price_per_piece: 1,
      unit_price_currency: "CNY",
      fx_cny_per_usd: 7.2,
      margin_pct: 20,
    },
    packages: {
      A: {
        packaging_costs: [{ moq: 1000, packaging_cost_per_pkg: 2 }],
        cells: [
          {
            pcs_per_pkg: 3,
            moq_packages: 1000,
            price_fob_per_pkg: 72,
            override_price_fob_per_pkg: null,
            offer_usd: 999,
          },
        ],
      },
    },
  };
}
function fixture() {
  actor = {
    user: { id: "staff-id" },
    permissions: [
      "dev.costings.view",
      "dev.costings.edit",
      "dev.costings.create",
      "dev.costings.delete",
    ],
  };
  rpcCalls = [];
  dbCalls = [];
  rpcFailure = null;
  const doc = rules.normalizeRedDocument(input());
  doc.header = {
    red_quotation_no: "REDQ-2610-0001",
    title: "Collar offer",
    buyer_name: "RED",
    style_no: "C1",
    ship_from_code: "CN_QINGDAO",
    incoterm: "FOB",
    quotation_date: "2026-10-31",
  };
  tables = {
    red_quotations: [
      { id: Q, archived_at: null, title: "Changed current title" },
    ],
    red_quotation_versions: [
      { id: V, red_quotation_id: Q, version_no: 2, status: "DRAFT" },
    ],
    red_quotation_documents: [
      { version_id: V, quotation_id: Q, document: doc, revision: 4 },
    ],
    red_quotation_price_matrix_v2: [],
    red_quotation_cost_inputs: [],
    red_quotation_packaging_costs_v2: [],
    red_quotation_price_matrix: [],
  };
  return doc;
}
const ctx = { params: { versionId: V } },
  qctx = { params: { id: Q } },
  req = (body) => ({ json: async () => body });
test("CNY offer, FX and gross margin persist together; spoofed final offer is recalculated", () => {
  const doc = rules.normalizeRedDocument(input());
  assert.equal(doc.packages.A.cells[0].offer_usd, 12.5);
  assert.equal(doc.inputs.fx_cny_per_usd, 7.2);
  assert.equal(doc.inputs.margin_pct, 20);
});
test("USD cost uses gross margin and FX 1, with 0% handled explicitly", () => {
  const data = input();
  data.inputs.unit_price_currency = "USD";
  data.packages.A.cells[0].price_fob_per_pkg = 10;
  assert.equal(
    rules.normalizeRedDocument(data).packages.A.cells[0].offer_usd,
    12.5,
  );
  data.inputs.margin_pct = 0;
  assert.equal(
    rules.normalizeRedDocument(data).packages.A.cells[0].offer_usd,
    10,
  );
});
test("unknown historic FX/margin never becomes a fabricated USD offer", () => {
  const data = input();
  delete data.inputs.fx_cny_per_usd;
  assert.equal(
    rules.normalizeRedDocument(data).packages.A.cells[0].offer_usd,
    null,
  );
  delete data.inputs.margin_pct;
  assert.equal(
    rules.normalizeRedDocument(data).packages.A.cells[0].offer_usd,
    null,
  );
});
test("all invalid cells reject the entire document instead of silently dropping rows", () => {
  for (const change of [
    (d) => (d.inputs.margin_pct = 100),
    (d) => (d.inputs.fx_cny_per_usd = 0),
    (d) => (d.inputs.fx_cny_per_usd = 1e-300),
    (d) => (d.packages.A.cells[0].price_fob_per_pkg = -1),
    (d) => (d.packages.A.cells[0].moq_packages = 1.5),
    (d) => d.packages.A.cells.push({ ...d.packages.A.cells[0] }),
    (d) => (d.inputs.unit_price_per_piece = true),
    (d) => (d.inputs.margin_pct = NaN),
  ]) {
    const data = input();
    change(data);
    assert.throws(() => rules.normalizeRedDocument(data));
  }
});
test("latest Draft is selected regardless of API list order; otherwise latest issued version", () => {
  const a = [
    { id: "v1", version_no: 1, status: "DRAFT" },
    { id: "v3", version_no: 3, status: "DRAFT" },
    { id: "v2", version_no: 2, status: "SENT" },
  ];
  assert.equal(rules.defaultRedVersion(a).id, "v3");
  assert.equal(rules.defaultRedVersion(a.reverse()).id, "v3");
  a.forEach((v) => (v.status = "SENT"));
  assert.equal(rules.defaultRedVersion(a).id, "v3");
});
test("matrix API retains package identity so a price change is visible in comparison", async () => {
  fixture();
  const r = await matrix.GET(new Request("http://test?package=A"), ctx);
  const c = r.body.data[0];
  assert.equal(c.package_code, "A");
  const changed = { ...c, offer_usd: 25 };
  const key = diff.keyOf("A", 3, 1000);
  assert.equal(
    diff.diffCell(
      diff.buildIndex([c]).get(key),
      diff.buildIndex([changed]).get(key),
    ).state,
    "UP",
  );
});
test("Override-only negotiation changes final USD offer and comparison", () => {
  const a = rules.normalizeRedDocument(input()),
    data = input();
  data.packages.A.cells[0].override_price_fob_per_pkg = 57.6;
  const b = rules.normalizeRedDocument(data);
  const d = diff.diffCell(a.packages.A.cells[0], b.packages.A.cells[0]);
  assert.equal(d.state, "DOWN");
  assert.equal(d.target, 10);
});
test("legacy comparison without USD field still detects effective Override changes", () => {
  const a = {
    package_code: "A",
    pcs_per_pkg: 3,
    moq_packages: 1000,
    price_fob_per_pkg: 1,
    override_price_fob_per_pkg: 1.4,
  };
  assert.equal(
    diff.diffCell(a, { ...a, override_price_fob_per_pkg: 1.6 }).state,
    "UP",
  );
});
test("anonymous and view-only callers cannot write or call RPC", async () => {
  fixture();
  actor = null;
  assert.equal((await docRoute.PUT(req({}), ctx)).status, 401);
  assert.equal(dbCalls.length, 0);
  fixture();
  actor.permissions = ["dev.costings.view"];
  assert.equal((await docRoute.PUT(req({}), ctx)).status, 403);
  assert.equal(rpcCalls.length, 0);
});
test("atomic save ignores client identity, version/status and header spoofing", async () => {
  fixture();
  const data = input();
  data.header = { buyer_name: "Fake" };
  const r = await docRoute.PUT(
    req({
      revision: 4,
      document: data,
      status: "DRAFT",
      version_key: "v1",
      updated_by: "fake",
    }),
    ctx,
  );
  assert.equal(r.status, 200);
  assert.equal(rpcCalls.length, 1);
  const call = rpcCalls[0];
  assert.equal(call.name, "red_save_document");
  assert.equal(call.args.p_version, V);
  assert.equal(call.args.p_actor, "staff-id");
  assert.equal(call.args.p_expected_revision, 4);
  assert.deepEqual(call.args.p_document.header, {});
  assert.equal(call.args.p_document.packages.A.cells[0].offer_usd, 12.5);
});
test("invalid document and missing revision fail before RPC writes", async () => {
  fixture();
  assert.equal(
    (await docRoute.PUT(req({ document: input() }), ctx)).status,
    409,
  );
  const data = input();
  data.inputs.margin_pct = 101;
  assert.equal(
    (await docRoute.PUT(req({ document: data, revision: 4 }), ctx)).status,
    400,
  );
  assert.equal(rpcCalls.length, 0);
});
test("concurrent update and sent-version SQL rejection map to conflict without fallback writes", async () => {
  fixture();
  for (const code of ["40001", "55000"]) {
    rpcFailure = { code, message: "locked/conflict" };
    assert.equal(
      (await docRoute.PUT(req({ document: input(), revision: 4 }), ctx)).status,
      409,
    );
  }
  assert.equal(rpcCalls.length, 2);
  assert.equal(tables.red_quotation_documents[0].revision, 4);
});
test("old split-save endpoints cannot bypass sent lock or erase Draft data", async () => {
  fixture();
  for (const status of ["SENT", "CONFIRMED", "DRAFT"]) {
    tables.red_quotation_versions[0].status = status;
    assert.equal((await matrix.PUT(req({ cells: [] }), ctx)).status, 409);
    assert.equal((await costs.PUT(req({}), ctx)).status, 409);
  }
  assert.equal(rpcCalls.length, 0);
  assert.equal(
    tables.red_quotation_documents[0].document.packages.A.cells.length,
    1,
  );
});
test("new version uses complete source document and returns consistent id for UI selection", async () => {
  const original = fixture();
  const r = await versions.POST(req({ from_version_id: V }), qctx);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.id, "new-id");
  assert.equal(r.body.data.version.id, "new-id");
  assert.deepEqual(rpcCalls[0].args.p_legacy_document, original);
  assert.equal(rpcCalls[0].name, "red_create_revision");
});
test("revision cannot copy another quotation source", async () => {
  fixture();
  tables.red_quotation_versions[0].red_quotation_id = "other";
  assert.equal(
    (await versions.POST(req({ from_version_id: V }), qctx)).status,
    400,
  );
  assert.equal(rpcCalls.length, 0);
});
test("archive and restore preserve every version and document", async () => {
  fixture();
  assert.equal((await quote.DELETE(req({}), qctx)).status, 200);
  assert.ok(tables.red_quotations[0].archived_at);
  assert.equal(tables.red_quotation_documents.length, 1);
  assert.equal(tables.red_quotation_versions.length, 1);
  assert.equal(
    (await list.GET(new Request("http://test"))).body.data.length,
    0,
  );
  assert.equal(
    (await list.GET(new Request("http://test?archived=1"))).body.data.length,
    1,
  );
  assert.equal(
    (await quote.PATCH(req({ action: "restore" }), qctx)).status,
    200,
  );
  assert.equal(tables.red_quotations[0].archived_at, null);
});
test("archive requires delete permission; header identity cannot be overwritten", async () => {
  fixture();
  actor.permissions = ["dev.costings.view"];
  assert.equal((await quote.DELETE(req({}), qctx)).status, 403);
  fixture();
  assert.equal(
    (await quote.PUT(req({ title: "New", id: "fake", status: "DRAFT" }), qctx))
      .status,
    200,
  );
  assert.equal(tables.red_quotations[0].id, Q);
  assert.equal(tables.red_quotations[0].status, undefined);
});
test("commercial export uses frozen header and final offer without internal costs/margin", () => {
  const doc = fixture();
  const data = exportsLib.commercialRedData(
    doc,
    { version_no: 2, status: "SENT" },
    "A",
  );
  assert.equal(data.title, "Collar offer");
  assert.deepEqual(data.rows, [{ pcs: 3, moq: 1000, offerUsd: 12.5 }]);
  const raw = JSON.stringify(data);
  for (const k of ["unit_price", "override", "margin", "fx_cny"])
    assert.ok(!raw.includes(k));
});
test("Excel export is actual XLSX and matches saved final USD instead of CNY cost", async () => {
  fixture();
  const response = await excel.GET(new Request("http://test?package=A"), ctx);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /spreadsheetml/);
  const Workbook = require("exceljs").Workbook,
    w = new Workbook();
  await w.xlsx.load(Buffer.from(await response.arrayBuffer()));
  const sheet = w.worksheets[0];
  assert.equal(sheet.getCell("D9").value, 12.5);
  assert.equal(sheet.getCell("D6").value, "USD / pkg");
  assert.equal(sheet.getCell("B4").value, "Collar offer");
  assert.ok(!JSON.stringify(sheet.getSheetValues()).includes("override_price"));
});
test("PDF uses same final USD and frozen metadata, with authenticated server read", async () => {
  fixture();
  const element = await pdf.default({
    params: { versionId: V },
    searchParams: { package: "A" },
  });
  const html = renderToStaticMarkup(element);
  assert.match(html, /12\.50/);
  assert.match(html, /Collar offer/);
  assert.ok(!html.includes("Changed current title"));
  assert.ok(!html.includes("Override"));
});
test("exports reject missing FX/margin, unknown package and unauthorized access", async () => {
  fixture();
  tables.red_quotation_documents[0].document.packages.A.cells[0].offer_usd =
    null;
  assert.equal((await excel.GET(new Request("http://test"), ctx)).status, 409);
  fixture();
  assert.equal(
    (await excel.GET(new Request("http://test?package=Z"), ctx)).status,
    404,
  );
  actor = null;
  assert.equal((await excel.GET(new Request("http://test"), ctx)).status, 401);
});
test("mark-sent uses saved revision and refuses incomplete final offer", async () => {
  fixture();
  assert.equal((await sent.POST(req({ revision: 4 }), ctx)).status, 200);
  assert.equal(rpcCalls[0].name, "red_mark_sent");
  assert.equal(rpcCalls[0].args.p_expected_revision, 4);
  fixture();
  tables.red_quotation_documents[0].document.packages.A.cells[0].offer_usd =
    null;
  assert.equal((await sent.POST(req({ revision: 4 }), ctx)).status, 400);
  assert.equal(rpcCalls.length, 0);
});
test("legacy read preserves costs but does not invent unknown FX or perform writes", async () => {
  fixture();
  tables.red_quotation_documents = [];
  tables.red_quotation_price_matrix_v2 = [
    {
      quotation_id: Q,
      version_key: "v2",
      package_code: "A",
      pcs: 3,
      moq_pkg: 1000,
      price_fob_per_pkg: 72,
      override_price_fob_per_pkg: 70,
    },
  ];
  tables.red_quotation_cost_inputs = [
    {
      red_quotation_version_id: V,
      unit_price_per_piece: 1,
      unit_price_currency: "CNY",
    },
  ];
  const r = await docRoute.GET(new Request("http://test"), ctx);
  assert.equal(r.body.legacy, true);
  assert.equal(r.body.revision, 0);
  assert.equal(
    r.body.document.packages.A.cells[0].override_price_fob_per_pkg,
    70,
  );
  assert.equal(r.body.document.packages.A.cells[0].offer_usd, null);
  assert.equal(rpcCalls.length, 0);
});
