const { PGlite } = require(
  process.env.RED_TEST_PGLITE_MODULE || "@electric-sql/pglite",
);
const fs = require("fs"),
  path = require("path"),
  assert = require("node:assert/strict");
const U = "33333333-3333-4333-8333-333333333333",
  Q = "11111111-1111-4111-8111-111111111111",
  OTHER = "22222222-2222-4222-8222-222222222222",
  L = "44444444-4444-4444-8444-444444444444",
  I = "55555555-5555-4555-8555-555555555555",
  VAR = "66666666-6666-4666-8666-666666666666";
(async () => {
  const db = new PGlite();
  let count = 0;
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);create table storage.objects(id uuid,bucket_id text);
create table companies(id uuid primary key,company_name text,code text);create table quote_accounts(id uuid primary key,buyer_id uuid,display_name text);
create table quotation_headers(id uuid primary key default gen_random_uuid(),quotation_no text unique,status text default 'DRAFT',quote_account_id uuid,buyer_id uuid,buyer_code text,buyer_name text,subject text,currency text,incoterm text,remarks text,received_at date default current_date,quotation_date date,valid_until date,is_deleted boolean default false,deleted_at timestamptz,sent_at timestamptz,is_sent boolean default false,created_at timestamptz default now(),updated_at timestamptz default now(),created_by uuid,buyer_brand_name text,style_no text);
create table quotation_lines(id uuid primary key,quotation_id uuid references quotation_headers(id));create table quotation_items(id uuid primary key,quotation_id uuid references quotation_headers(id));
create table quotation_variants(id uuid primary key,quotation_id uuid references quotation_headers(id),quotation_line_id uuid references quotation_lines(id));
create table quotation_variant_lines(id uuid primary key,quotation_variant_id uuid references quotation_variants(id),variant_id uuid references quotation_variants(id),quotation_line_id uuid references quotation_lines(id));
create table quotation_tiers(id uuid primary key,quotation_id uuid references quotation_headers(id),quotation_item_id uuid references quotation_items(id));
create table costing_headers(id uuid primary key,quotation_id uuid,quotation_line_id uuid,quotation_no text);
create table quotation_line_attachments(id uuid primary key default gen_random_uuid(),quotation_id uuid,quotation_line_id uuid,file_name text,file_path text,mime_type text,file_size bigint,created_by uuid,created_by_email text,created_at timestamptz default now(),is_deleted boolean default false,deleted_at timestamptz);
create table external_orders(id uuid primary key,q_id uuid references quotation_headers(id) on delete cascade);
insert into quotation_headers(id,quotation_no,status,buyer_name,currency) values('${Q}','QUO-26-0001','DRAFT','Test','USD'),('${OTHER}','QUO-26-0002','DRAFT','Other','USD');
insert into quotation_lines values('${L}','${Q}');insert into quotation_items values('${I}','${Q}');insert into quotation_variants values('${VAR}','${Q}','${L}');
insert into quotation_variant_lines values(gen_random_uuid(),'${VAR}','${VAR}','${L}');insert into quotation_tiers values(gen_random_uuid(),'${Q}','${I}');
insert into quotation_line_attachments(quotation_id,quotation_line_id,file_name,file_path) values('${Q}','${L}','same.txt','shared-file.txt'),('${OTHER}',null,'same.txt','shared-file.txt');`);
  const sql = (n) =>
    fs.readFileSync(
      path.join(__dirname, "../supabase/migrations/" + n),
      "utf8",
    );
  await db.exec(sql("20261101000100_general_quotation_integrity.sql"));
  await db.exec(sql("20261101000200_quotation_test_purge.sql"));
  await db.exec(sql("20261101000200_quotation_test_purge.sql"));
  count++;
  const row = async (s, args = []) => (await db.query(s, args)).rows[0],
    preview = async (id) =>
      (await row("select quotation_purge_preview($1) as p", [id])).p;
  const purge = async (
    id,
    p,
    number = p.quotation_no,
    token = p.confirmation_token,
  ) =>
    (
      await row("select quotation_purge_commit($1,$2,$3,$4) as p", [
        id,
        number,
        token,
        U,
      ])
    ).p;
  const write = async (action, id, v, revision, doc) =>
    (
      await row("select quotation_write($1,$2,$3,$4,$5,$6) as r", [
        action,
        id,
        v,
        revision,
        doc ? JSON.stringify(doc) : null,
        U,
      ])
    ).r;
  const document = () => ({
    header: {
      buyer_name: "Test",
      quotation_date: "2026-11-01",
      received_at: "2026-11-01",
      currency: "USD",
    },
    lines: [
      {
        id: crypto.randomUUID(),
        style_no: "C1",
        qty: 10,
        offer_price: 12.5,
        tiers: [],
      },
    ],
    requires_review: false,
  });
  let p = await preview(Q);
  assert.equal(p.eligible, true);
  assert.equal(p.counts.quotation_versions, 1);
  assert.equal(p.counts.quotation_tiers, 1);
  count++;
  await assert.rejects(purge(Q, p, "WRONG"), /견적번호/);
  assert.equal((await preview(Q)).eligible, true);
  count++;
  await assert.rejects(purge(Q, p, p.quotation_no, "bad-token"), /변경/);
  count++;
  // A live cross-table soft reference blocks deletion, including otherwise unissued Drafts.
  await db.query(
    "insert into costing_headers(id,quotation_id,quotation_line_id) values(gen_random_uuid(),$1,$2)",
    [Q, L],
  );
  p = await preview(Q);
  assert.equal(p.eligible, false);
  await assert.rejects(purge(Q, p), /연결/);
  await db.query("delete from costing_headers where quotation_id=$1", [Q]);
  count++;
  await db.query(
    "insert into costing_headers(id,quotation_no) values(gen_random_uuid(),$1)",
    ["QUO-26-0001"],
  );
  assert.equal((await preview(Q)).eligible, false);
  await db.query("delete from costing_headers where quotation_no=$1", [
    "QUO-26-0001",
  ]);
  count++;
  await db.query("insert into external_orders values(gen_random_uuid(),$1)", [
    Q,
  ]);
  p = await preview(Q);
  assert.equal(p.eligible, false);
  await assert.rejects(purge(Q, p), /연결/);
  assert.equal(
    Number((await row("select count(*) as n from external_orders")).n),
    1,
  );
  await db.query("delete from external_orders");
  count++;
  // Failure late in the delete order must restore everything, including cleanup jobs.
  await db.exec(
    `create function inject_purge_failure() returns trigger language plpgsql as $$begin raise exception 'injected purge failure';end$$;create trigger inject_purge_failure before delete on quotation_headers for each row execute function inject_purge_failure();`,
  );
  p = await preview(Q);
  await assert.rejects(purge(Q, p), /injected/);
  assert.equal((await preview(Q)).eligible, true);
  assert.equal(
    Number(
      (await row("select count(*) as n from quotation_file_cleanup_jobs")).n,
    ),
    0,
  );
  await db.exec("drop trigger inject_purge_failure on quotation_headers");
  count++;
  await db.exec("set role service_role");
  p = await preview(Q);
  const done = await purge(Q, p);
  assert.equal(done.deleted, true);
  await db.exec("reset role");
  for (const t of [
    "quotation_headers",
    "quotation_versions",
    "quotation_line_keys",
    "quotation_lines",
    "quotation_items",
    "quotation_variants",
    "quotation_variant_lines",
    "quotation_tiers",
    "quotation_line_attachments",
  ]) {
    if (["quotation_variant_lines", "quotation_tiers"].includes(t))
      assert.equal(Number((await row("select count(*) as n from " + t)).n), 0);
    else
      assert.equal(
        Number(
          (
            await row(
              "select count(*) as n from " +
                t +
                " where " +
                (t === "quotation_headers" ? "id" : "quotation_id") +
                "=$1",
              [Q],
            )
          ).n,
        ),
        0,
      );
  }
  assert.ok(
    (await row("select id from quotation_headers where id=$1", [OTHER])).id,
  );
  count++;
  for (const [column, ref] of [
    ["quotation_id", Q],
    ["quotation_line_id", L],
    ["quotation_no", "QUO-26-0001"],
  ])
    await assert.rejects(
      db.query(
        "insert into costing_headers(id," +
          column +
          ") values(gen_random_uuid(),$1)",
        [ref],
      ),
      /삭제|유효/,
    );
  count++;
  let claim = (
    await row("select quotation_purge_cleanup_claim($1,$2,20) as p", [Q, U])
  ).p;
  assert.equal(claim.retained, 1);
  assert.equal(claim.jobs.length, 0);
  count++;
  await assert.rejects(
    db.query("delete from quotation_headers where id=$1", [OTHER]),
    /보관/,
  );
  count++;
  let doc = document(),
    created = await write("create", null, null, null, doc),
    v = created.version_id,
    id = created.quotation_id;
  p = await preview(id);
  await write("save", id, v, 1, doc);
  await assert.rejects(purge(id, p), /변경/);
  count++;
  await write("sent", id, v, 2);
  p = await preview(id);
  assert.equal(p.eligible, false);
  await assert.rejects(purge(id, p), /발송/);
  count++;
  const revised = (
    await row("select quotation_write($1,$2,$3,$4,$5,$6,$7) as r", [
      "revise",
      id,
      v,
      2,
      JSON.stringify(doc),
      U,
      "Buyer change",
    ])
  ).r;
  p = await preview(id);
  assert.equal(p.eligible, false);
  count++;
  doc = document();
  created = await write("create", null, null, null, doc);
  id = created.quotation_id;
  v = created.version_id;
  await write("archive", id, null, null, null);
  p = await preview(id);
  assert.equal(p.eligible, true);
  await purge(id, p);
  const deletedNo = Number(created.quotation_no.split("-").pop());
  const next = await write("create", null, null, null, document());
  assert.ok(Number(next.quotation_no.split("-").pop()) > deletedNo);
  count++;
  // Canonical attachments are queued once, never removed before the transaction commits.
  const f = {
    line_id: next
      ? (
          await row("select document from quotation_versions where id=$1", [
            next.version_id,
          ])
        ).document.lines[0].id
      : null,
    name: "own.txt",
    path: "unique-own.txt",
    size: 5,
    type: "text/plain",
    email: "a@example.com",
  };
  await db.query("select quotation_write($1,$2,$3,$4,$5,$6,$7,$8)", [
    "file_add",
    next.quotation_id,
    next.version_id,
    1,
    null,
    U,
    "",
    JSON.stringify(f),
  ]);
  p = await preview(next.quotation_id);
  await purge(next.quotation_id, p);
  claim = (
    await row("select quotation_purge_cleanup_claim($1,$2,20) as p", [
      next.quotation_id,
      U,
    ])
  ).p;
  assert.equal(claim.jobs.length, 1);
  const job = claim.jobs[0];
  let concurrent = (
    await row("select quotation_purge_cleanup_claim($1,$2,20) as p", [
      next.quotation_id,
      U,
    ])
  ).p;
  assert.equal(concurrent.jobs.length, 0);
  count++;
  await db.query("select quotation_purge_cleanup_finish($1,$2,$3)", [
    job.id,
    U,
    "temporary storage error",
  ]);
  claim = (
    await row("select quotation_purge_cleanup_claim($1,$2,20) as p", [
      next.quotation_id,
      U,
    ])
  ).p;
  assert.equal(claim.jobs.length, 1);
  await db.query("select quotation_purge_cleanup_finish($1,$2,null)", [
    job.id,
    U,
  ]);
  assert.equal(
    (
      await row("select state from quotation_file_cleanup_jobs where id=$1", [
        job.id,
      ])
    ).state,
    "done",
  );
  count++;
  await db.exec("set role authenticated");
  await assert.rejects(preview(OTHER), /permission denied/);
  await assert.rejects(
    purge(OTHER, { quotation_no: "QUO-26-0002", confirmation_token: "x" }),
    /permission denied/,
  );
  await db.exec("reset role");
  count++;
  assert.ok(
    (
      await row(
        "select quote_id from quotation_number_reservations where quotation_no=$1",
        [created.quotation_no],
      )
    ).quote_id,
  );
  count++;
  await db.exec("set role service_role");
  const serviceQuote = await write("create", null, null, null, document());
  assert.ok(serviceQuote.quotation_no);
  await db.exec("reset role");
  count++;
  console.log(
    JSON.stringify({
      passed: count,
      migrationExecutedTwice: true,
      checks:
        "typed confirmation, stale state, full Draft purge, cascade protection, soft references, rollback, shared-file retention, cleanup retry/lease, no number reuse, client denial",
    }),
  );
  await db.close();
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
