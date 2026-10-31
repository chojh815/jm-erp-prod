const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  ts = require("typescript");
const REQUEST = "11111111-1111-4111-8111-111111111111",
  OTHER = "22222222-2222-4222-8222-222222222222",
  USER = "33333333-3333-4333-8333-333333333333",
  TOPIC = "44444444-4444-4444-8444-444444444444";
let tables, actor, storageObjects, writes, storageCalls;
class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
  }
  select() {
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
  is(k, v) {
    return this.eq(k, v);
  }
  gte(k, v) {
    this.filters.push((r) => r[k] >= v);
    return this;
  }
  lte(k, v) {
    this.filters.push((r) => r[k] <= v);
    return this;
  }
  order(k, o = { ascending: true }) {
    (this.sorts ??= []).push([k, o.ascending === false ? -1 : 1]);
    return this;
  }
  range(a, b) {
    this.slice = [a, b + 1];
    return this;
  }
  limit(n) {
    this.slice = [0, n];
    return this;
  }
  maybeSingle() {
    this.one = true;
    return this;
  }
  single() {
    this.one = true;
    return this;
  }
  or(text) {
    this.orText = text;
    return this;
  }
  insert(rows) {
    this.add = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(row) {
    return this.insert(row);
  }
  delete() {
    this.del = true;
    return this;
  }
  update(p) {
    this.patch = p;
    return this;
  }
  then(resolve, reject) {
    try {
      let result = (tables[this.table] ?? []).filter((r) =>
        this.filters.every((f) => f(r)),
      );
      if (this.orText) {
        if (this.orText.includes("owner_id.eq.")) {
          const ids = (
            this.orText.match(/id\.in\.\(([^)]*)\)/)?.[1] ?? ""
          ).split(",");
          result = result.filter(
            (r) =>
              r.owner_id === actor.user.id ||
              String(r.owner_email).toLowerCase() ===
                actor.user.email.toLowerCase() ||
              ids.includes(r.id),
          );
        } else {
          const needle = (
            this.orText.match(/ilike\.%([^%]+)%/)?.[1] ?? ""
          ).toLowerCase();
          result = result.filter((r) =>
            [
              "title",
              "note",
              "sender",
              "created_by_name",
              "search_filenames",
            ].some((k) =>
              String(r[k] ?? "")
                .toLowerCase()
                .includes(needle),
            ),
          );
        }
      }
      if (this.del) {
        writes++;
        tables[this.table] = (tables[this.table] ?? []).filter(
          (r) => !result.includes(r),
        );
      }
      if (this.patch) {
        writes++;
        result.forEach((r) => Object.assign(r, this.patch));
      }
      if (this.add) {
        writes++;
        result = this.add.map((r, i) => ({
          ...r,
          id: r.id || `generated-${(tables[this.table] ?? []).length + i}`,
          created_at: "2026-10-31T01:00:00Z",
        }));
        (tables[this.table] ??= []).push(...result);
      }
      if (this.sorts)
        result.sort((a, b) => {
          for (const [k, dir] of this.sorts) {
            if (a[k] < b[k]) return -dir;
            if (a[k] > b[k]) return dir;
          }
          return 0;
        });
      const count = result.length;
      if (this.slice) result = result.slice(...this.slice);
      return Promise.resolve({
        data: this.one ? (result[0] ?? null) : structuredClone(result),
        error: null,
        count,
      }).then(resolve, reject);
    } catch (e) {
      return Promise.reject(e).then(resolve, reject);
    }
  }
}
const db = {
  from: (t) => new Query(t),
  storage: {
    from: (bucket) => ({
      createSignedUploadUrl: async (p, opts) => {
        storageCalls.push(["upload", bucket, p, opts]);
        return { data: { token: "signed-upload-token" }, error: null };
      },
      list: async (dir, { search }) => ({
        data: storageObjects
          .filter((f) => f.path === dir + "/" + search)
          .map((f) => ({
            name: search,
            metadata: { size: f.size, mimetype: f.type },
          })),
        error: null,
      }),
      createSignedUrl: async (p, ttl, opts) => {
        storageCalls.push(["read", bucket, p, ttl, opts]);
        return {
          data: { signedUrl: "https://example.invalid/private-download" },
          error: null,
        };
      },
      download: async () => ({
        data: new Blob(["Item,FOB\nA,1.20\n"]),
        error: null,
      }),
    }),
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
                  status: options?.status ?? 200,
                }),
                redirect: (url) =>
                  new Response(null, {
                    status: 307,
                    headers: { Location: url },
                  }),
              },
            }
          : s.startsWith("@/")
            ? load("src/" + s.slice(2) + ".ts")
            : require(s);
  vm.runInThisContext(`(function(require,module,exports){${js}\n})`, {
    filename,
  })(request, module, module.exports);
  return module.exports;
}
const rules = load("src/lib/sampleHistoryRules.ts"),
  access = load("src/lib/sampleRequestAccess.ts");
const history = load("src/app/api/sample-requests/[id]/history/route.ts"),
  uploads = load("src/app/api/sample-requests/[id]/history/uploads/route.ts"),
  workspace = load("src/app/api/sample-requests/[id]/workspace/route.ts"),
  fileRoute = load(
    "src/app/api/sample-requests/[id]/history/[entryId]/file/route.ts",
  ),
  previewRoute = load(
    "src/app/api/sample-requests/[id]/history/[entryId]/preview/route.ts",
  ),
  rootRoute = load("src/app/api/sample-requests/route.ts"),
  detailRoute = load("src/app/api/sample-requests/[id]/route.ts");
function fixture(role = "staff") {
  actor = {
    role,
    user: { id: USER, email: "staff@example.com", name: "Employee A" },
    permissions: [
      "dev.sample_requests.view",
      ...(role === "manager"
        ? ["dev.sample_requests.edit", "dev.sample_requests.create"]
        : []),
    ],
  };
  tables = {
    sample_requests: [
      {
        id: REQUEST,
        request_title: "PET COLLAR",
        status: "DEVELOPING",
        owner_id: OTHER,
        owner_email: "owner@example.com",
        is_deleted: false,
      },
      {
        id: OTHER,
        request_title: "OTHER",
        status: "DEVELOPING",
        is_deleted: false,
      },
    ],
    sample_request_members: [{ request_id: REQUEST, user_id: USER }],
    sample_request_topics: [
      { id: TOPIC, request_id: REQUEST, title: "CHAIN COLLAR" },
    ],
    sample_request_history: [],
    user_profiles: [
      {
        user_id: USER,
        email: "staff@example.com",
        name: "Employee A",
        role: "staff",
        is_active: true,
      },
    ],
  };
  writes = 0;
  storageCalls = [];
  storageObjects = [];
}
const context = (id = REQUEST) => ({ params: Promise.resolve({ id }) });
const jsonRequest = (data) => ({ json: async () => data });
const input = (extra = {}) => ({
  title: "Factory price survey",
  received_date: "2026-10-20",
  entry_kind: "COST",
  source: "WECHAT",
  sender: "Factory A",
  note: "Thickness changed",
  topic_id: TOPIC,
  ...extra,
});
function entry(extra = {}) {
  return {
    id: "entry1",
    request_id: REQUEST,
    topic_id: TOPIC,
    received_date: "2026-10-20",
    title: "First costs",
    entry_kind: "COST",
    source: "EMAIL",
    sender: "Factory",
    note: "Original",
    files: [],
    visibility: "TEAM",
    created_by: USER,
    ...extra,
  };
}
test("anonymous access fails before DB writes or upload tokens", async () => {
  fixture();
  actor = null;
  assert.equal(
    (
      await uploads.POST(
        jsonRequest({ files: [{ name: "a.xlsx", size: 10 }] }),
        context(),
      )
    ).status,
    401,
  );
  assert.equal(
    (await history.GET(new Request("http://test"), context())).status,
    401,
  );
  assert.equal(writes, 0);
  assert.equal(storageCalls.length, 0);
});
test("only assigned staff can access a development request", async () => {
  fixture();
  await access.sampleRequestAccess(REQUEST, actor, true);
  await assert.rejects(
    access.sampleRequestAccess(OTHER, actor, true),
    /not assigned/,
  );
});
test("legacy owner ID/email grants access without name matching", async () => {
  fixture();
  tables.sample_request_members = [];
  tables.sample_requests[0].owner_email = "STAFF@example.com";
  await access.sampleRequestAccess(REQUEST, actor);
  tables.sample_requests[0].owner_email = "another@example.com";
  tables.sample_requests[0].owner_name = "Employee A";
  await assert.rejects(access.sampleRequestAccess(REQUEST, actor));
});
test("inactive/deleted request is inaccessible", async () => {
  fixture();
  tables.sample_requests[0].is_deleted = true;
  await assert.rejects(access.sampleRequestAccess(REQUEST, actor), /not found/);
});
test("staff cannot alter requests or employee assignments", async () => {
  fixture();
  assert.equal(
    (
      await workspace.POST(
        jsonRequest({ action: "member", user_id: USER }),
        context(),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await detailRoute.PUT(
        jsonRequest({ estimated_order_value: 9999 }),
        context(),
      )
    ).status,
    403,
  );
  assert.equal(writes, 0);
});
test("viewer and a manager with edit revoked cannot contribute", async () => {
  fixture("viewer");
  await assert.rejects(
    access.sampleRequestAccess(REQUEST, actor, true),
    /read-only/,
  );
  fixture("manager");
  actor.permissions = ["dev.sample_requests.view"];
  await assert.rejects(
    access.sampleRequestAccess(REQUEST, actor, true),
    /read-only/,
  );
});
test("manager can create Sub Titles and assign employees", async () => {
  fixture("manager");
  assert.equal(
    (
      await workspace.POST(
        jsonRequest({ action: "topic", title: "SNAP ON COLLAR" }),
        context(),
      )
    ).status,
    200,
  );
  assert.equal(tables.sample_request_topics[1].title, "SNAP ON COLLAR");
  assert.equal(
    (
      await workspace.POST(
        jsonRequest({ action: "member", user_id: USER }),
        context(),
      )
    ).status,
    200,
  );
});
test("large Excel uses signed private upload, not the API body or public bucket", async () => {
  fixture();
  const response = await uploads.POST(
    jsonRequest({ files: [{ name: "Costs.xlsx", size: 28 * 1024 * 1024 }] }),
    context(),
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.bucket, "sample-request-history");
  assert.ok(
    response.body.uploads[0].path.startsWith(REQUEST + "/" + USER + "/"),
  );
  assert.equal(storageCalls[0][3].upsert, false);
});
test("oversized and unsupported uploads are rejected before issuing any token", async () => {
  fixture();
  for (const f of [
    { name: "cost.xlsx", size: 41 * 1024 * 1024 },
    { name: "bad.exe", size: 1 },
    { name: "a.xlsx", size: 0 },
  ])
    assert.equal(
      (await uploads.POST(jsonRequest({ files: [f] }), context())).status,
      400,
    );
  assert.equal(storageCalls.length, 0);
});
test("registrant identity and timestamp cannot be spoofed by the client", async () => {
  fixture();
  const res = await history.POST(
    jsonRequest(
      input({
        created_by: OTHER,
        created_by_name: "Fake",
        created_at: "2000-01-01",
      }),
    ),
    context(),
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.item.created_by, USER);
  assert.equal(res.body.item.created_by_name, "Employee A");
  assert.equal(res.body.item.received_date, "2026-10-20");
  assert.equal(res.body.item.created_at, "2026-10-31T01:00:00Z");
});
test("progress-only note works; empty submissions and invalid dates fail", async () => {
  fixture();
  assert.equal(
    (
      await history.POST(
        jsonRequest(input({ entry_kind: "PROGRESS" })),
        context(),
      )
    ).status,
    200,
  );
  for (const bad of [
    { note: "", files: [] },
    { received_date: "2026-02-31" },
    { received_date: "2026-13-01" },
    { title: " " },
    { source: "SMS" },
  ])
    assert.equal(
      (await history.POST(jsonRequest(input(bad)), context())).status,
      400,
    );
});
test("cross-request Sub Title and revision links are rejected", async () => {
  fixture();
  tables.sample_request_topics.push({
    id: OTHER,
    request_id: OTHER,
    title: "Unrelated",
  });
  assert.equal(
    (await history.POST(jsonRequest(input({ topic_id: OTHER })), context()))
      .status,
    400,
  );
  tables.sample_request_history = [entry({ id: "foreign", request_id: OTHER })];
  assert.equal(
    (
      await history.POST(
        jsonRequest(input({ previous_entry_id: "foreign" })),
        context(),
      )
    ).status,
    404,
  );
});
test("a revision appends to history and preserves its source record", async () => {
  fixture();
  tables.sample_request_history = [entry()];
  const original = structuredClone(tables.sample_request_history[0]);
  const response = await history.POST(
    jsonRequest(input({ entry_kind: "REVISION", previous_entry_id: "entry1" })),
    context(),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(tables.sample_request_history[0], original);
  assert.equal(tables.sample_request_history.length, 2);
  assert.equal(response.body.item.previous_entry_id, "entry1");
});
test("revision must stay in the same Sub Title", async () => {
  fixture();
  tables.sample_request_history = [entry({ topic_id: null })];
  assert.equal(
    (
      await history.POST(
        jsonRequest(input({ previous_entry_id: "entry1" })),
        context(),
      )
    ).status,
    400,
  );
  assert.equal(writes, 0);
});
test("unuploaded, foreign, duplicate and mismatched file references fail", async () => {
  fixture();
  for (const path of [
    REQUEST + "/" + OTHER + "/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.xlsx",
    REQUEST + "/" + USER + "/../../file.xlsx",
    REQUEST + "/" + USER + "/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.xlsx",
  ]) {
    const res = await history.POST(
      jsonRequest(input({ files: [{ name: "a.xlsx", size: 10, path }] })),
      context(),
    );
    assert.equal(res.status, 400);
  }
  assert.equal(writes, 0);
});
test("uploaded files are finalized using Storage metadata", async () => {
  fixture();
  const p = REQUEST + "/" + USER + "/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.xlsx";
  storageObjects = [
    {
      path: p,
      size: 10,
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  ];
  const r = await history.POST(
    jsonRequest(
      input({
        files: [{ path: p, name: "cost.xlsx", size: 10, type: "fake" }],
      }),
    ),
    context(),
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.item.files[0].type, storageObjects[0].type);
  assert.equal(r.body.item.files[0].url, undefined);
});
test("management-only data is omitted from staff search and file access", async () => {
  fixture();
  tables.sample_request_history = [
    entry({
      visibility: "MANAGEMENT",
      files: [{ name: "cost.xlsx", path: REQUEST + "/" + USER + "/x.xlsx" }],
    }),
  ];
  assert.equal(
    (await history.GET(new Request("http://test?q=cost"), context())).body
      .total,
    0,
  );
  const ctx = { params: Promise.resolve({ id: REQUEST, entryId: "entry1" }) };
  assert.equal(
    (await fileRoute.GET(new Request("http://test"), ctx)).status,
    404,
  );
  assert.equal(
    (await previewRoute.GET(new Request("http://test"), ctx)).status,
    404,
  );
  assert.equal(storageCalls.length, 0);
  assert.equal(
    (
      await history.POST(
        jsonRequest(input({ visibility: "MANAGEMENT" })),
        context(),
      )
    ).status,
    403,
  );
});
test("file downloads recheck membership and issue short-lived signed URLs", async () => {
  fixture();
  tables.sample_request_history = [
    entry({
      files: [
        { name: "original.xlsx", path: REQUEST + "/" + USER + "/x.xlsx" },
      ],
    }),
  ];
  const ctx = { params: Promise.resolve({ id: REQUEST, entryId: "entry1" }) };
  assert.equal(
    (await fileRoute.GET(new Request("http://test?download=1"), ctx)).status,
    307,
  );
  assert.equal(storageCalls[0][3], 300);
  assert.equal(storageCalls[0][4].download, "original.xlsx");
  tables.sample_request_members = [];
  assert.equal(
    (await fileRoute.GET(new Request("http://test"), ctx)).status,
    403,
  );
  assert.equal(storageCalls.length, 1);
});
test("spreadsheet preview reads values without changing the original file", async () => {
  fixture();
  tables.sample_request_history = [
    entry({
      files: [{ name: "cost.csv", path: REQUEST + "/" + USER + "/x.csv" }],
    }),
  ];
  const res = await previewRoute.GET(new Request("http://test"), {
    params: Promise.resolve({ id: REQUEST, entryId: "entry1" }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.rows[0], ["Item", "FOB"]);
  assert.equal(writes, 0);
});
test("root request list is scoped to assignments and hides other requests", async () => {
  fixture();
  const r = await rootRoute.GET(new Request("http://test"));
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.body.items.map((r) => r.id),
    [REQUEST],
  );
  assert.equal(r.body.canManage, false);
  assert.equal(r.body.canCreate, false);
});
test("history search, received-date ordering and pagination work together", async () => {
  fixture();
  tables.sample_request_history = Array.from({ length: 30 }, (_, i) =>
    entry({
      id: "e" + i,
      title: "Cost " + i,
      received_date: i === 0 ? "2026-01-01" : "2026-10-20",
      created_at: "2026-10-31T00:00:00Z",
    }),
  );
  const res = await history.GET(
    new Request("http://test?page=1&from=2026-10-01&q=Cost"),
    context(),
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 29);
  assert.equal(res.body.items.length, 25);
  assert.ok(res.body.items.every((r) => r.received_date === "2026-10-20"));
});
