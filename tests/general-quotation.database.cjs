const { PGlite } = require(
  process.env.RED_TEST_PGLITE_MODULE || "@electric-sql/pglite",
);
const fs = require("fs"),
  path = require("path"),
  assert = require("node:assert/strict");
const A = "33333333-3333-4333-8333-333333333333",
  L = "44444444-4444-4444-8444-444444444444",
  OLD = "11111111-1111-4111-8111-111111111111";
const document = () => ({
  header: {
    buyer_id: null,
    buyer_name: "Buyer A",
    subject: "Offer A",
    quotation_date: "2026-11-01",
    received_at: "2026-11-01",
    currency: "USD",
    incoterm: "FOB",
    remarks: "",
    valid_until: "",
  },
  lines: [
    {
      id: L,
      style_no: "C1",
      qty: 100,
      offer_price: 12.5,
      unit: "pc",
      internal: {
        costing_snapshot: {
          version: 3,
          offer_usd: 12.5,
          fx_cny_per_usd: 7.2,
          target_margin_pct: 20,
        },
      },
      tiers: [],
    },
  ],
  requires_review: false,
  source_note: "",
});
(async () => {
  const db = new PGlite();
  let checks = 0;
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);create table storage.objects(id uuid,bucket_id text);
create table companies(id uuid primary key,company_name text,code text);create table quote_accounts(id uuid primary key,buyer_id uuid,display_name text);
create table quotation_headers(id uuid primary key default gen_random_uuid(),quotation_no text unique,status text default 'DRAFT',quote_account_id uuid,buyer_id uuid,buyer_code text,buyer_name text,subject text,currency text,incoterm text,remarks text,received_at date default current_date,quotation_date date,valid_until date,is_deleted boolean default false,deleted_at timestamptz,sent_at timestamptz,is_sent boolean default false,created_at timestamptz default now(),updated_at timestamptz default now(),created_by uuid,buyer_brand_name text,style_no text);
create table quotation_lines(id uuid primary key,quotation_id uuid);create table quotation_items(id uuid primary key,quotation_id uuid);create table quotation_variants(id uuid primary key,quotation_id uuid);create table quotation_variant_lines(id uuid primary key);create table costing_headers(id uuid primary key);
create table quotation_line_attachments(id uuid primary key default gen_random_uuid(),quotation_id uuid,quotation_line_id uuid,file_name text,file_path text,mime_type text,file_size bigint,created_by uuid,created_by_email text,created_at timestamptz default now(),is_deleted boolean default false,deleted_at timestamptz);
insert into quotation_headers(id,quotation_no,status,buyer_name,subject) values('${OLD}','OLD1','SENT','Old Buyer','Frozen header');`);
  const sql = fs.readFileSync(
    path.join(
      __dirname,
      "../supabase/migrations/20261101000100_general_quotation_integrity.sql",
    ),
    "utf8",
  );
  await db.exec(sql);
  await db.exec(sql);
  checks++;
  const row = async (q, a = []) => (await db.query(q, a)).rows[0],
    call = async (
      action,
      q = null,
      v = null,
      revision = null,
      d = null,
      file = null,
      note = "",
    ) =>
      (
        await row("select quotation_write($1,$2,$3,$4,$5,$6,$7,$8) as r", [
          action,
          q,
          v,
          revision,
          d ? JSON.stringify(d) : null,
          A,
          note,
          file ? JSON.stringify(file) : null,
        ])
      ).r;
  assert.equal(
    (
      await row("select status from quotation_versions where quotation_id=$1", [
        OLD,
      ])
    ).status,
    "SENT",
  );
  checks++;
  await db.exec("set role service_role");
  const created = await call("create", null, null, null, document());
  assert.ok(created.version_id);
  await db.exec("reset role");
  checks++;
  let v = created.version_id,
    q = created.quotation_id;
  const stored = await row(
    "select document from quotation_versions where id=$1",
    [v],
  );
  assert.equal(stored.document.lines[0].internal.costing_snapshot.version, 3);
  checks++;
  await assert.rejects(call("save", q, v, 0, document()), /다른 사용자가/);
  checks++;
  await db.exec(
    `create function injected_failure() returns trigger language plpgsql as $$begin raise exception 'injected header projection failure';end$$;create trigger injected_failure before update on quotation_headers for each row execute function injected_failure();`,
  );
  const changed = document();
  changed.lines[0].offer_price = 99;
  await assert.rejects(call("save", q, v, 1, changed), /injected/);
  assert.equal(
    (
      await row(
        "select revision,document from quotation_versions where id=$1",
        [v],
      )
    ).document.lines[0].offer_price,
    12.5,
  );
  await db.exec("drop trigger injected_failure on quotation_headers");
  checks++;
  assert.equal((await call("save", q, v, 1, document())).revision, 2);
  checks++;
  const counts = async () =>
    Number((await row("select count(*) as n from quotation_headers")).n);
  const before = await counts();
  await assert.rejects(
    call("create", null, null, null, document()),
    /다른 견적의 행/,
  );
  assert.equal(await counts(), before);
  checks++;
  const file = {
    line_id: L,
    name: "offer.txt",
    size: 4,
    path: "q/v/u/a.txt",
    type: "text/plain",
    email: "staff@example.com",
  };
  assert.equal((await call("file_add", q, v, 2, null, file)).revision, 3);
  checks++;
  await assert.rejects(call("file_add", q, v, 3, null, file), /이미 등록/);
  checks++;
  await call("sent", q, v, 3);
  assert.equal(
    (await row("select status from quotation_versions where id=$1", [v]))
      .status,
    "SENT",
  );
  checks++;
  await assert.rejects(call("save", q, v, 3, changed), /발송/);
  await assert.rejects(
    call("file_remove", q, v, 3, null, {
      line_id: L,
      id: "99999999-9999-4999-8999-999999999999",
    }),
    /발송/,
  );
  checks++;
  const revised = await call(
    "revise",
    q,
    v,
    3,
    null,
    null,
    "Buyer negotiation",
  );
  assert.equal(revised.version_no, 2);
  const v2 = await row("select * from quotation_versions where id=$1", [
    revised.version_id,
  ]);
  assert.equal(v2.previous_version_id, v);
  assert.equal(v2.change_note, "Buyer negotiation");
  assert.deepEqual(
    v2.document,
    (await row("select document from quotation_versions where id=$1", [v]))
      .document,
  );
  checks++;
  assert.equal(
    Number(
      (
        await row(
          "select count(*) as n from quotation_line_attachments where version_id=$1",
          [revised.version_id],
        )
      ).n,
    ),
    1,
  );
  checks++;
  await call("archive", q);
  await assert.rejects(
    call("save", q, revised.version_id, 1, changed),
    /보管|보관/,
  );
  await call("restore", q);
  assert.equal(
    (await call("save", q, revised.version_id, 1, changed)).revision,
    2,
  );
  checks++;
  await assert.rejects(
    db.query("delete from quotation_headers where id=$1", [q]),
    /보관/,
  );
  await assert.rejects(
    db.query("update quotation_versions set status='DRAFT' where id=$1", [v]),
    /통합/,
  );
  await assert.rejects(
    db.query(
      "insert into quotation_lines(id,quotation_id) values(gen_random_uuid(),$1)",
      [q],
    ),
    /보존/,
  );
  checks++;
  await db.exec("set role authenticated");
  await assert.rejects(call("archive", q), /permission denied/);
  await db.exec("reset role");
  checks++;
  const unknown = document();
  unknown.lines[0].id = "55555555-5555-4555-8555-555555555555";
  unknown.requires_review = true;
  const pending = await call("create", null, null, null, unknown);
  await assert.rejects(
    call("sent", pending.quotation_id, pending.version_id, 1),
    /확인/,
  );
  checks++;
  const malformed = document();
  malformed.lines[0].id = "bad-id";
  const n = await counts();
  await assert.rejects(call("create", null, null, null, malformed));
  assert.equal(await counts(), n);
  checks++;
  console.log(
    JSON.stringify({
      passed: checks,
      migrationExecutedTwice: true,
      checks:
        "rollback, source snapshot, foreign IDs, revision conflicts, sent/file locks, archive/restore, copy with files, client denial",
    }),
  );
  await db.close();
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
