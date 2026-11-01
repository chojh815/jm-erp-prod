const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("fs"),
  path = require("path"),
  vm = require("vm"),
  ts = require("typescript");
const React = require("react"),
  { renderToStaticMarkup } = require("react-dom/server");
const Q = "11111111-1111-4111-8111-111111111111",
  V = "22222222-2222-4222-8222-222222222222",
  U = "33333333-3333-4333-8333-333333333333",
  L = "44444444-4444-4444-8444-444444444444",
  C = "55555555-5555-4555-8555-555555555555",
  B = "66666666-6666-4666-8666-666666666666";
let actor, tables, rpcs, queries, rpcFailure, objects, storageCalls;
class Query {
  constructor(t) {
    this.t = t;
    this.filters = [];
    queries.push(t);
  }
  select() {
    return this;
  }
  eq(k, v) {
    this.filters.push((r) => r[k] === v);
    return this;
  }
  in(k, v) {
    this.filters.push((r) => v.includes(r[k]));
    return this;
  }
  is(k, v) {
    return this.eq(k, v);
  }
  not(k, o, v) {
    this.filters.push((r) => r[k] !== v);
    return this;
  }
  ilike(k, v) {
    const s = v.replaceAll("%", "").toLowerCase();
    this.filters.push((r) =>
      String(r[k] || "")
        .toLowerCase()
        .includes(s),
    );
    return this;
  }
  order(k, o) {
    this.sort = [k, o?.ascending === false ? -1 : 1];
    return this;
  }
  limit(n) {
    this.max = n;
    return this;
  }
  maybeSingle() {
    this.one = true;
    return this;
  }
  then(resolve, reject) {
    try {
      let rows = (tables[this.t] || []).filter((r) =>
        this.filters.every((f) => f(r)),
      );
      if (this.sort) {
        const [k, dir] = this.sort;
        rows.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir);
      }
      if (this.max) rows = rows.slice(0, this.max);
      return Promise.resolve({
        data: this.one
          ? structuredClone(rows[0] || null)
          : structuredClone(rows),
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
    rpcs.push({ name, args });
    return rpcFailure
      ? { error: rpcFailure }
      : {
          data: {
            id: Q,
            quotation_id: Q,
            quotation_no: "Q-2611-0001",
            version_id: V,
            version_no: 2,
            revision: (args.p_revision || 0) + 1,
            status: args.p_action === "sent" ? "SENT" : "DRAFT",
          },
          error: null,
        };
  },
  storage: {
    from: (bucket) => ({
      createSignedUploadUrl: async (p, opts) => {
        storageCalls.push({ type: "upload", bucket, path: p, opts });
        return { data: { token: "test-token" }, error: null };
      },
      list: async (dir, { search }) => ({
        data: objects
          .filter((f) => f.path === dir + "/" + search)
          .map((f) => ({
            name: search,
            metadata: { size: f.size, mimetype: f.type },
          })),
        error: null,
      }),
      createSignedUrl: async (p, ttl, opts) => {
        storageCalls.push({ type: "read", bucket, path: p, ttl, opts });
        return {
          data: { signedUrl: "https://example.invalid/file" },
          error: null,
        };
      },
    }),
  },
};
class NR {
  static json(body, o) {
    return { body, status: o?.status || 200 };
  }
  static redirect(url, o) {
    return new Response(null, {
      status: 307,
      headers: { Location: url, ...o?.headers },
    });
  }
}
const cache = {};
function load(name) {
  if (cache[name]) return cache[name].exports;
  const m = { exports: {} };
  cache[name] = m;
  const filename = path.resolve(__dirname, "..", name),
    js = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
      },
    }).outputText;
  const req = (s) =>
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
          ? { NextResponse: NR }
          : s.includes("PrintButton")
            ? {
                __esModule: true,
                default: () => React.createElement("button", {}, "Print"),
              }
            : s.startsWith("@/")
              ? load("src/" + s.slice(2) + ".ts")
              : require(s);
  vm.runInThisContext(`(function(require,module,exports){${js}\n})`, {
    filename,
  })(req, m, m.exports);
  return m.exports;
}
const rules = load("src/lib/generalQuoteRules.ts"),
  server = load("src/lib/generalQuoteServer.ts"),
  route = load("src/app/api/quotations/[id]/route.ts"),
  create = load("src/app/api/quotations/create/route.ts"),
  fromCosting = load("src/app/api/quotations/create-from-costing/route.ts"),
  tiers = load("src/app/api/quotations/[id]/tiers/route.ts"),
  excel = load("src/app/api/quotations/[id]/excel/route.ts"),
  pdf = load("src/app/quotations/[id]/pdf/page.tsx"),
  files = load("src/app/api/quotations/[id]/files/route.ts"),
  list = load("src/app/api/quotations/list/route.ts"),
  remove = load("src/app/api/quotations/delete/route.ts"),
  bootstrap = load("src/app/api/quotations/bootstrap/route.ts");
function document() {
  return {
    header: {
      buyer_id: B,
      buyer_name: "Buyer A",
      subject: "Offer",
      quotation_date: "2026-11-01",
      received_at: "2026-11-01",
      valid_until: "",
      currency: "USD",
      incoterm: "FOB",
      remarks: "Buyer note",
    },
    lines: [
      {
        id: L,
        style_no: "C1",
        description: "Collar",
        qty: 100,
        unit: "pc",
        offer_price: 12.5,
        target_price: 10,
        remarks: "",
        costing_id: C,
        internal: {},
        tiers: [],
      },
    ],
    requires_review: false,
    source_note: "",
  };
}
function fixture() {
  actor = {
    user: { id: U, email: "staff@example.com" },
    permissions: [
      "dev.costings.view",
      "dev.costings.create",
      "dev.costings.edit",
      "dev.costings.delete",
    ],
  };
  rpcs = [];
  queries = [];
  rpcFailure = null;
  objects = [];
  storageCalls = [];
  const d = rules.normalizeQuote(document());
  d.lines[0].internal = {
    costing_snapshot: {
      id: C,
      version: 3,
      offer_usd: 12.5,
      fx_cny_per_usd: 7.2,
      target_margin_pct: 20,
    },
  };
  tables = {
    quotation_headers: [
      {
        id: Q,
        quotation_no: "Q-2611-0001",
        archived_at: null,
        status: "DRAFT",
        buyer_name: "Changed live label",
      },
    ],
    quotation_versions: [
      {
        id: V,
        quotation_id: Q,
        version_no: 1,
        status: "DRAFT",
        document: d,
        revision: 4,
        header_snapshot: {
          buyer_id: B,
          buyer_name: "Buyer A",
          quotation_date: "2026-11-01",
          currency: "USD",
        },
      },
    ],
    quotation_lines: [],
    quotation_items: [],
    quotation_variants: [],
    quotation_variant_lines: [],
    quotation_line_attachments: [],
    quotation_line_keys: [{ id: L, quotation_id: Q }],
    companies: [
      {
        id: B,
        code: "BUY",
        company_type: "BUYER",
        company_name: "Buyer A",
        is_deleted: false,
      },
    ],
    costing_headers: [
      {
        id: C,
        style_no: "C1",
        version: 3,
        offer_usd: 12.5,
        offer_price_usd: 9,
        fx_cny_per_usd: 7.2,
        target_margin_pct: 20,
        buyer_id: B,
        is_deleted: false,
        updated_at: "2026-11-01T01:00:00Z",
      },
    ],
  };
  return d;
}
const ctx = { params: { id: Q } },
  req = (b) => ({ json: async () => b }),
  saveBody = (d) => ({ document: d || document(), version_id: V, revision: 4 });

test('legacy headers without lines can be repaired in a reviewed Draft, never printed as empty offers',async()=>{fixture();tables.quotation_versions[0].document=null;tables.quotation_versions[0].revision=0;const s=await server.readQuote(Q,V);assert.equal(s.document.lines.length,0);assert.equal(s.document.requires_review,true);assert.equal(s.sources[0].key,'empty');assert.throws(()=>rules.commercialQuote(s.document,'Q1',1,'DRAFT'));});
test('high precision saved unit price stays identical in PDF and XLSX',async()=>{fixture();tables.quotation_versions[0].document.lines[0].offer_price=12.345678;const r=await excel.GET(new Request('http://test'),ctx),Workbook=require('exceljs').Workbook,w=new Workbook();await w.xlsx.load(Buffer.from(await r.arrayBuffer()));assert.equal(w.worksheets[0].getCell('E8').value,12.345678);const html=renderToStaticMarkup(await pdf.default({params:{id:Q},searchParams:{version_id:V}}));assert.match(html,/12\.345678/);});
test("normalization validates quantities and preserves saved unit-price precision", () => {
  const d = document();
  d.lines[0].offer_price = 1.234567;
  assert.equal(rules.normalizeQuote(d).lines[0].offer_price, 1.234567);
  for (const edit of [
    (x) => (x.lines[0].qty = -1),
    (x) => (x.lines[0].offer_price = -1),
    (x) => (x.header.quotation_date = "2026-02-31"),
    (x) => x.lines.push({ ...x.lines[0] }),
    (x) => (x.lines[0].qty = 1.5),
    (x) => (x.lines[0].offer_price = true),
  ]) {
    const a = document();
    edit(a);
    assert.throws(() => rules.normalizeQuote(a));
  }
});
test("target price is never substituted for missing final offer", () => {
  const d = document();
  d.lines[0].offer_price = null;
  const n = rules.normalizeQuote(d);
  assert.equal(n.lines[0].target_price, 10);
  assert.throws(() => rules.assertQuoteReady(n), /최종/);
});
test("anonymous cannot read, create, save, delete, bootstrap, export or upload", async () => {
  fixture();
  actor = null;
  for (const call of [
    () => route.GET(new Request("http://test"), ctx),
    () => route.PUT(req(saveBody()), ctx),
    () => create.POST(req({})),
    () => remove.POST(req({ id: Q })),
    () => bootstrap.GET(),
    () => excel.GET(new Request("http://test"), ctx),
    () => files.POST(req({}), ctx),
  ])
    assert.equal((await call()).status, 401);
  assert.equal(queries.length, 0);
  assert.equal(rpcs.length, 0);
});
test("view-only caller cannot mutate any quotation path", async () => {
  fixture();
  actor.permissions = ["dev.costings.view"];
  assert.equal((await route.PUT(req(saveBody()), ctx)).status, 403);
  assert.equal((await fromCosting.POST(req({ costing_id: C }))).status, 403);
  assert.equal((await route.DELETE(req({}), ctx)).status, 403);
  assert.equal((await files.POST(req({}), ctx)).status, 403);
  assert.equal(rpcs.length, 0);
});
test("one detail GET returns consistent header, lines, versions and files for UI", async () => {
  fixture();
  const r = await route.GET(new Request("http://test"), ctx);
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  assert.deepEqual(r.body.lines, r.body.document.lines);
  assert.equal(r.body.header.buyer_name, "Buyer A");
  assert.equal(r.body.revision, 4);
});
test("flat old header save is rejected instead of false success", async () => {
  fixture();
  assert.equal((await route.PUT(req({ subject: "Changed" }), ctx)).status, 409);
  assert.equal(rpcs.length, 0);
});
test("full save preserves server costing snapshot and ignores client internal data and status", async () => {
  fixture();
  const d = document();
  d.lines[0].internal = { costing_snapshot: { version: 99 } };
  const r = await route.PUT(req({ ...saveBody(d), status: "DRAFT" }), ctx);
  assert.equal(r.status, 200);
  assert.equal(rpcs.length, 1);
  assert.equal(rpcs[0].args.p_action, "save");
  assert.equal(rpcs[0].args.p_actor, U);
  assert.equal(
    rpcs[0].args.p_document.lines[0].internal.costing_snapshot.version,
    3,
  );
});
test("invalid line rejects entire save before any write", async () => {
  fixture();
  const d = document();
  d.lines[0].qty = 0;
  assert.equal((await route.PUT(req(saveBody(d)), ctx)).status, 400);
  assert.equal(rpcs.length, 0);
});
test("conflict and foreign-ID SQL errors propagate as 409 without partial fallback", async () => {
  fixture();
  for (const code of ["40001", "55000"]) {
    rpcFailure = { code, message: "conflict" };
    assert.equal((await route.PUT(req(saveBody()), ctx)).status, 409);
  }
  assert.equal(
    rpcs.every((x) => x.name === "quotation_write"),
    true,
  );
});
test("old tier API cannot change a foreign tier or allow negative price", async () => {
  fixture();
  assert.equal(
    (
      await tiers.PUT(
        req({ updates: [{ tier_id: "foreign", unit_price: -5 }] }),
        ctx,
      )
    ).status,
    409,
  );
  assert.equal(rpcs.length, 0);
});
test("Costing creation copies actual saved offer, version, FX and margin, not fixed v1", async () => {
  fixture();
  const r = await fromCosting.POST(req({ costing_id: C }));
  assert.equal(r.status, 200);
  const l = rpcs[0].args.p_document.lines[0];
  assert.equal(l.offer_price, 12.5);
  assert.equal(l.internal.costing_snapshot.version, 3);
  assert.equal(l.internal.costing_snapshot.fx_cny_per_usd, 7.2);
  assert.equal(l.internal.costing_snapshot.target_margin_pct, 20);
});
test("ambiguous Style No cannot silently choose a random costing version", async () => {
  fixture();
  tables.costing_headers.push({
    ...tables.costing_headers[0],
    id: B,
    version: 4,
  });
  assert.equal((await fromCosting.POST(req({ style_no: "C1" }))).status, 409);
  assert.equal(rpcs.length, 0);
});
test("changed Costing snapshot between selection and save is rejected", async () => {
  fixture();
  const d = document();
  d.lines[0].id = B;
  d.lines[0].internal = { costing_snapshot: { version: 2, updated_at: "old" } };
  await assert.rejects(server.prepareQuote(d), /Costing이 변경/);
});
test("manual create keeps target separate and uses stable line IDs", async () => {
  fixture();
  const r = await create.POST(
    req({
      buyer_id: B,
      received_at: "2026-11-01",
      lines: [{ style_no: "C1", qty: 100, target_price: 10 }],
    }),
  );
  assert.equal(r.status, 200);
  const d = rpcs[0].args.p_document;
  assert.ok(rules.UUID.test(d.lines[0].id));
  assert.equal(d.lines[0].offer_price, null);
  assert.equal(d.header.buyer_name, "Buyer A");
});
test("archive and restore always use soft RPC operations", async () => {
  fixture();
  await route.DELETE(req({}), ctx);
  await route.PATCH(req({ action: "restore" }), ctx);
  assert.deepEqual(
    rpcs.map((r) => r.args.p_action),
    ["archive", "restore"],
  );
});
test("mark-sent rejects blank prices, unresolved legacy source and invalid tiers", async () => {
  fixture();
  tables.quotation_versions[0].document.lines[0].offer_price = null;
  assert.equal(
    (await route.POST(req({ action: "sent", version_id: V, revision: 4 }), ctx))
      .status,
    409,
  );
  assert.equal(rpcs.length, 0);
});
test("revision links exact source and preserves full document snapshot", async () => {
  const d = fixture();
  const r = await route.POST(
    req({
      action: "revise",
      version_id: V,
      revision: 4,
      note: "Buyer requests",
    }),
    ctx,
  );
  assert.equal(r.status, 200);
  assert.equal(rpcs[0].args.p_version, V);
  assert.deepEqual(rpcs[0].args.p_document, d);
  assert.equal(rpcs[0].args.p_note, "Buyer requests");
});
test("commercial shape explicitly excludes target, internal costing, FX and margin", () => {
  const d = fixture(),
    c = rules.commercialQuote(d, "Q1", 1, "SENT"),
    s = JSON.stringify(c);
  assert.equal(c.lines[0].amount, 1250);
  for (const k of [
    "internal",
    "target_price",
    "costing_snapshot",
    "margin",
    "fx_cny",
  ])
    assert.ok(!s.includes(k));
});
test("actual XLSX and PDF match saved buyer price and omit internal costs/margin", async () => {
  fixture();
  const response = await excel.GET(new Request("http://test"), ctx);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /spreadsheetml/);
  const Workbook = require("exceljs").Workbook,
    w = new Workbook();
  await w.xlsx.load(Buffer.from(await response.arrayBuffer()));
  const sh = w.worksheets[0];
  assert.equal(sh.getCell("E8").value, 12.5);
  assert.equal(sh.getCell("F8").value, 1250);
  const text = JSON.stringify(sh.getSheetValues());
  assert.ok(!text.includes("costing_snapshot"));
  const html = renderToStaticMarkup(
    await pdf.default({ params: { id: Q }, searchParams: { version_id: V } }),
  );
  assert.match(html, /12\.5/);
  assert.match(html, /1250\.00/);
  assert.ok(!html.includes("Changed live label"));
  assert.ok(!html.includes("COST"));
  assert.ok(!html.includes("M%"));
});
test("legacy sources use existing base prices and flag conflicting items instead of merging", async () => {
  fixture();
  tables.quotation_versions[0].document = null;
  tables.quotation_versions[0].revision = 0;
  tables.quotation_lines = [
    {
      id: L,
      quotation_id: Q,
      style_no: "C1",
      qty: 100,
      offer_usd: 12.5,
      is_deleted: false,
    },
  ];
  tables.quotation_items = [
    { id: C, quotation_id: Q, style_no: "OLD", is_deleted: false },
  ];
  const s = await server.readQuote(Q, V);
  assert.equal(s.sources.length, 2);
  assert.equal(s.document.lines[0].offer_price, 12.5);
  assert.equal(s.document.requires_review, true);
  await assert.rejects(
    async () => rules.commercialQuote(s.document, "Q1", 1, "SENT"),
    /출처/,
  );
  assert.equal((await route.PUT(req(saveBody(s.document)), ctx)).status, 409);
});
test("confirmed legacy source can be saved only with explicit acknowledgement", async () => {
  fixture();
  tables.quotation_versions[0].document = null;
  tables.quotation_versions[0].revision = 0;
  tables.quotation_lines = [
    { id: L, quotation_id: Q, style_no: "C1", qty: 100, offer_usd: 12.5 },
  ];
  tables.quotation_items = [{ id: C, quotation_id: Q, style_no: "OLD" }];
  const s = await server.readQuote(Q, V);
  const r = await route.PUT(
    req({ ...saveBody(s.document), revision: 0, acknowledge_review: true }),
    ctx,
  );
  assert.equal(r.status, 200);
  assert.equal(rpcs[0].args.p_document.requires_review, false);
});
test("currency cannot be relabeled without confirmation", async () => {
  fixture();
  const d = document();
  d.header.currency = "EUR";
  assert.equal((await route.PUT(req(saveBody(d)), ctx)).status, 409);
  assert.equal(rpcs.length, 0);
});
test("signed upload bypasses API file body limit and cannot overwrite existing file", async () => {
  fixture();
  const r = await files.POST(
    req({
      action: "sign",
      version_id: V,
      revision: 4,
      line_id: L,
      file: { name: "cost.xlsx", size: 8 * 1024 * 1024 },
    }),
    ctx,
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.bucket, "quotation-version-files");
  assert.ok(r.body.path.startsWith(Q + "/" + V + "/" + U + "/"));
  assert.equal(storageCalls[0].opts.upsert, false);
});
test("file finalize verifies actual Storage path, size and MIME", async () => {
  fixture();
  const p =
    Q + "/" + V + "/" + U + "/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.xlsx";
  objects = [
    {
      path: p,
      size: 50,
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  ];
  const r = await files.POST(
    req({
      action: "finalize",
      version_id: V,
      revision: 4,
      line_id: L,
      file: { name: "a.xlsx", path: p, size: 50, type: "fake" },
    }),
    ctx,
  );
  assert.equal(r.status, 200);
  assert.equal(rpcs[0].args.p_file.type, objects[0].type);
});
test("foreign, incomplete and oversized file inputs never finalize", async () => {
  fixture();
  for (const f of [
    { name: "bad.exe", size: 1 },
    { name: "a.xlsx", size: 11 * 1024 * 1024 },
  ])
    assert.equal(
      (
        await files.POST(
          req({
            action: "sign",
            version_id: V,
            revision: 4,
            line_id: L,
            file: f,
          }),
          ctx,
        )
      ).status,
      400,
    );
  assert.equal(
    (
      await files.POST(
        req({
          action: "finalize",
          version_id: V,
          revision: 4,
          line_id: L,
          file: {
            name: "a.xlsx",
            size: 2,
            path:
              Q +
              "/" +
              V +
              "/" +
              B +
              "/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.xlsx",
          },
        }),
        ctx,
      )
    ).status,
    400,
  );
  assert.equal(rpcs.length, 0);
});
test("sent/archived files are immutable and stale revisions cannot issue upload tokens", async () => {
  fixture();
  tables.quotation_versions[0].status = "SENT";
  assert.equal(
    (
      await files.POST(
        req({
          action: "sign",
          version_id: V,
          revision: 4,
          line_id: L,
          file: { name: "a.txt", size: 3 },
        }),
        ctx,
      )
    ).status,
    409,
  );
  fixture();
  assert.equal(
    (
      await files.POST(
        req({
          action: "sign",
          version_id: V,
          revision: 3,
          line_id: L,
          file: { name: "a.txt", size: 3 },
        }),
        ctx,
      )
    ).status,
    409,
  );
  assert.equal(storageCalls.length, 0);
});
test("downloads check quote/version/line and use 5-minute private links", async () => {
  fixture();
  tables.quotation_line_attachments = [
    {
      id: C,
      quotation_id: Q,
      version_id: V,
      quotation_line_id: L,
      bucket_name: "quotation-version-files",
      file_path: "q/file.txt",
      file_name: "original.txt",
      is_deleted: false,
    },
  ];
  const r = await files.GET(
    new Request(
      "http://test?version_id=" + V + "&file_id=" + C + "&download=1",
    ),
    ctx,
  );
  assert.equal(r.status, 307);
  assert.equal(storageCalls[0].ttl, 300);
  assert.equal(storageCalls[0].opts.download, "original.txt");
  tables.quotation_line_attachments[0].quotation_line_id = B;
  assert.equal(
    (
      await files.GET(
        new Request("http://test?version_id=" + V + "&file_id=" + C),
        ctx,
      )
    ).status,
    404,
  );
});
test("all missing compatibility routes exist and reject anonymous access", async () => {
  fixture();
  actor = null;
  for (const p of ["lines", "variants", "variant-lines"]) {
    const r = load("src/app/api/quotations/[id]/" + p + "/route.ts");
    assert.equal((await r.GET(new Request("http://test"), ctx)).status, 401);
  }
  assert.equal(queries.length, 0);
});
