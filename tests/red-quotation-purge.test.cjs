const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("fs"),
  path = require("path"),
  vm = require("vm"),
  ts = require("typescript");
const Q = "11111111-1111-4111-8111-111111111111",
  U = "33333333-3333-4333-8333-333333333333",
  OTHER = "22222222-2222-4222-8222-222222222222",
  TOKEN = "a".repeat(32);
let actor, calls, removals, responses, storageError, tableRows;
class Query {
  constructor(t) {
    this.t = t;
    this.f = [];
  }
  select() {
    return this;
  }
  eq(k, v) {
    this.f.push((x) => x[k] === v);
    return this;
  }
  in(k, v) {
    this.f.push((x) => v.includes(x[k]));
    return this;
  }
  limit() {
    return this;
  }
  then(resolve, reject) {
    return Promise.resolve({
      data: (tableRows[this.t] || []).filter((x) => this.f.every((f) => f(x))),
      error: null,
    }).then(resolve, reject);
  }
}
const db = {
  from: (t) => new Query(t),
  rpc: async (n, a) => {
    calls.push({ name: n, args: a });
    const r = responses[n];
    return typeof r === "function" ? r(a) : r || { data: null, error: null };
  },
  storage: {
    from: (bucket) => ({
      remove: async (paths) => {
        removals.push({ bucket, paths });
        return {
          error: storageError ? { message: "test Storage error" } : null,
          data: [],
        };
      },
    }),
  },
};
const cache = {};
function load(file) {
  if (cache[file]) return cache[file].exports;
  const m = { exports: {} };
  cache[file] = m;
  const filename = path.resolve(__dirname, "..", file),
    js = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
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
          ? {
              NextResponse: {
                json: (body, o) => ({ body, status: o?.status || 200 }),
              },
            }
          : s.startsWith("@/")
            ? load("src/" + s.slice(2) + ".ts")
            : require(s);
  vm.runInThisContext(`(function(require,module,exports){${js}\n})`, {
    filename,
  })(req, m, m.exports);
  return m.exports;
}
const purge = load("src/app/api/red/quotations/[id]/purge/route.ts"),
  cleanup = load("src/app/api/red/quotations/[id]/purge-cleanup/route.ts"),
  helper = load("src/lib/redQuotationPurge.ts");
const ctx = { params: { id: Q } },
  body = (extra = {}) => ({
    confirmed: true,
    confirmation_no: "QUO-26-0001",
    confirmation_token: TOKEN,
    ...extra,
  }),
  request = (b) => ({ json: async () => b });
function fixture() {
  actor = {
    user: { id: U },
    permissions: ["dev.costings.view", "dev.costings.delete"],
  };
  calls = [];
  removals = [];
  tableRows = {};
  storageError = false;
  responses = {
    red_purge_preview: {
      data: {
        id: Q,
        quotation_no: "QUO-26-0001",
        eligible: true,
        counts: { quotation_versions: 1, quotation_line_attachments: 1 },
        confirmation_token: TOKEN,
      },
    },
    red_purge_commit: {
      data: {
        id: Q,
        quotation_no: "QUO-26-0001",
        deleted: true,
        counts: { quotation_line_attachments: 1 },
      },
    },
    red_purge_cleanup_claim: {
      data: {
        jobs: [
          { id: "job1", bucket: "red-quotation-images", path: "q/file.txt" },
        ],
        pending: 1,
        retained: 0,
      },
    },
    red_purge_cleanup_finish: { data: null },
  };
}
test("anonymous cannot inspect, purge or retry file deletion", async () => {
  fixture();
  actor = null;
  for (const f of [
    () => purge.GET(request({}), ctx),
    () => purge.POST(request(body()), ctx),
    () => cleanup.POST(request({}), ctx),
  ])
    assert.equal((await f()).status, 401);
  assert.equal(calls.length, 0);
  assert.equal(removals.length, 0);
});
test("view/create permissions alone do not grant permanent deletion", async () => {
  fixture();
  actor.permissions = ["dev.costings.view", "dev.costings.create"];
  assert.equal((await purge.GET(request({}), ctx)).status, 403);
  assert.equal((await purge.POST(request(body()), ctx)).status, 403);
  assert.equal((await cleanup.POST(request({}), ctx)).status, 403);
  assert.equal(calls.length, 0);
});
test("preview returns actual counts and confirmation fingerprint with no mutation", async () => {
  fixture();
  const r = await purge.GET(request({}), ctx);
  assert.equal(r.status, 200);
  assert.equal(r.body.counts.quotation_versions, 1);
  assert.equal(r.body.confirmation_token, TOKEN);
  assert.deepEqual(
    calls.map((x) => x.name),
    ["red_purge_preview"],
  );
  assert.equal(removals.length, 0);
});
test("invalid id, acknowledgement, missing number or token cannot reach purge RPC", async () => {
  fixture();
  assert.equal(
    (await purge.GET(request({}), { params: { id: "bad" } })).status,
    400,
  );
  for (const b of [
    body({ confirmed: false }),
    body({ confirmed: "true" }),
    body({ confirmation_no: "" }),
    body({ confirmation_token: "invalid" }),
    {},
  ])
    assert.equal((await purge.POST(request(b), ctx)).status, 400);
  assert.equal(calls.length, 0);
});
test("exact typed number and server user reach SQL, cleanup runs only after committed delete", async () => {
  fixture();
  const r = await purge.POST(
    request(body({ confirmation_no: " QUO-26-0001 ", actor_id: OTHER })),
    ctx,
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.deleted, true);
  assert.equal(r.body.cleanup.pending, 1);
  assert.equal(r.body.cleanup.removed, 0);
  assert.deepEqual(
    calls.map((x) => x.name),
    ["red_purge_commit"],
  );
  const c = await cleanup.POST(request({}), ctx);
  assert.equal(c.body.cleanup.pending, 0);
  assert.equal(c.body.cleanup.removed, 1);
  assert.deepEqual(
    calls.map((x) => x.name),
    ["red_purge_commit", "red_purge_cleanup_claim", "red_purge_cleanup_finish"],
  );
  assert.equal(calls[0].args.p_actor, U);
  assert.equal(calls[0].args.p_confirmation_no, "QUO-26-0001");
});
test("sent, reference and stale-state SQL refusals never touch Storage", async () => {
  fixture();
  for (const code of ["55000", "40001"]) {
    responses.red_purge_commit = {
      error: { code, message: "Deletion blocked" },
    };
    assert.equal((await purge.POST(request(body()), ctx)).status, 409);
  }
  assert.equal(removals.length, 0);
  assert.equal(
    calls.every((x) => x.name === "red_purge_commit"),
    true,
  );
});
test("Storage outage preserves committed quote success and retry information", async () => {
  fixture();
  storageError = true;
  const r = await purge.POST(request(body()), ctx);
  assert.equal(r.status, 200);
  assert.equal(r.body.deleted, true);
  assert.equal(r.body.cleanup.pending, 1);
  const c = await cleanup.POST(request({}), ctx);
  assert.equal(c.body.cleanup.failed, 1);
  assert.equal(c.body.cleanup.pending, 1);
  assert.ok(
    calls.find((x) => x.name === "red_purge_cleanup_finish").args.p_error,
  );
});
test("cleanup RPC outage cannot turn completed deletion into a false deletion failure", async () => {
  fixture();
  responses.red_purge_cleanup_claim = {
    error: { code: "test", message: "outage" },
  };
  const r = await purge.POST(request(body()), ctx);
  assert.equal(r.status, 200);
  assert.equal(r.body.deleted, true);
  assert.ok(r.body.cleanup.pending > 0);
  assert.equal((await cleanup.POST(request({}), ctx)).status, 500);
  assert.equal(removals.length, 0);
});
test("shared files are retained and never sent to Storage removal", async () => {
  fixture();
  responses.red_purge_cleanup_claim = {
    data: { jobs: [], pending: 0, retained: 1 },
  };
  await purge.POST(request(body()), ctx);
  const r = await cleanup.POST(request({}), ctx);
  assert.equal(r.body.cleanup.retained, 1);
  assert.equal(r.body.cleanup.pending, 0);
  assert.equal(removals.length, 0);
});
test("unexpected bucket and traversal paths fail closed and stay retryable", async () => {
  fixture();
  for (const job of [
    { id: "j", bucket: "other-private-bucket", path: "x" },
    { id: "j", bucket: "red-quotation-images", path: "../x" },
  ]) {
    responses.red_purge_cleanup_claim = {
      data: { jobs: [job], pending: 1, retained: 0 },
    };
    const r = await cleanup.POST(request({ actor_id: OTHER }), ctx);
    assert.equal(r.body.cleanup.failed, 1);
    assert.equal(r.body.cleanup.pending, 1);
  }
  assert.equal(removals.length, 0);
  assert.equal(
    calls
      .filter((x) => x.name === "red_purge_cleanup_claim")
      .every((x) => x.args.p_actor === U),
    true,
  );
});
test("pending cleanup visibility is scoped to the deleting user", async () => {
  fixture();
  tableRows = {
    red_quotation_file_cleanup_jobs: [
      { quote_id: Q, created_by: U, state: "pending" },
      { quote_id: OTHER, created_by: OTHER, state: "pending" },
    ],
    red_quotation_number_reservations: [
      { quote_id: Q, quotation_no: "QUO-26-0001" },
    ],
  };
  const r = await helper.pendingPurgeCleanups(U);
  assert.deepEqual(r, [{ id: Q, pending: 1, quotation_no: "QUO-26-0001" }]);
});
