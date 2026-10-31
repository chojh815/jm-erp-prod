const { PGlite } = require(
  process.env.RED_TEST_PGLITE_MODULE || "@electric-sql/pglite",
);
const fs = require("fs"),
  assert = require("node:assert/strict");
const actor = "33333333-3333-4333-8333-333333333333";
const doc = {
  inputs: {
    unit_price_per_piece: 1,
    unit_price_currency: "CNY",
    fx_cny_per_usd: 7.2,
    margin_pct: 20,
  },
  header: {},
  packages: {
    A: {
      packaging_costs: [{ moq: 1000, packaging_cost_per_pkg: 2 }],
      cells: [
        {
          package_code: "A",
          pcs_per_pkg: 3,
          moq_packages: 1000,
          price_fob_per_pkg: 72,
          override_price_fob_per_pkg: null,
          offer_usd: 12.5,
        },
      ],
    },
  },
};
(async () => {
  const db = new PGlite();
  let count = 0;
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table red_quotations(id uuid primary key default gen_random_uuid(),red_quotation_no text unique,title text,buyer_name text,style_no text,ship_from_code text,currency text,incoterm text,status text,updated_at timestamptz default now());
 create table red_quotation_versions(id uuid primary key default gen_random_uuid(),red_quotation_id uuid references red_quotations(id),version_no int,status text,revision_of_version_id uuid,change_summary text,updated_at timestamptz default now(),unique(red_quotation_id,version_no));
 create table red_quotation_price_matrix(id uuid primary key default gen_random_uuid(),quotation_id uuid,price_fob_per_pkg numeric);
 create table red_quotation_price_matrix_v2(id uuid primary key default gen_random_uuid(),quotation_id uuid,version_key text,quotation_version_id uuid,price_fob_per_pkg numeric);
 create table red_quotation_cost_inputs(id uuid primary key default gen_random_uuid(),red_quotation_version_id uuid,unit_price_per_piece numeric);
 create table red_quotation_packaging_costs_v2(id uuid primary key default gen_random_uuid(),red_quotation_version_id uuid,packaging_cost_per_pkg numeric);`);
  const sql = fs.readFileSync(
    require("node:path").join(
      __dirname,
      "../supabase/migrations/20261031000200_red_quotation_integrity.sql",
    ),
    "utf8",
  );
  await db.exec(sql);
  await db.exec(sql);
  count++;
  const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const create = async (d = doc) =>
    (
      await scalar("select red_create_quotation($1,$2,$3) as r", [
        JSON.stringify({ title: "COLLAR", buyer_name: "RED", style_no: "C1" }),
        JSON.stringify(d),
        actor,
      ])
    ).r;
  const made = await create();
  const v = made.version_id,
    q = made.id;
  assert.ok(v);
  count++;
  const save = async (id, d, revision) =>
    (
      await scalar("select red_save_document($1,$2,$3,$4) as r", [
        id,
        JSON.stringify(d),
        revision,
        actor,
      ])
    ).r;
  const saved = await save(v, doc, 1);
  assert.equal(saved.revision, 2);
  assert.ok(saved.document.header.quotation_date);
  count++;
  await assert.rejects(save(v, doc, 1), /다른 사용자가/);
  assert.equal(
    (
      await scalar(
        "select revision from red_quotation_documents where version_id=$1",
        [v],
      )
    ).revision,
    2,
  );
  count++;
  // Failure after the document upsert must roll back the entire SQL statement.
  await db.exec(
    `create function simulate_red_failure() returns trigger language plpgsql as $$begin raise exception 'injected downstream failure';end$$;create trigger simulate_red_failure before update on red_quotation_versions for each row execute function simulate_red_failure();`,
  );
  const changed = structuredClone(doc);
  changed.packages.A.cells[0].price_fob_per_pkg = 99;
  await assert.rejects(save(v, changed, 2), /injected/);
  assert.equal(
    (
      await scalar(
        "select document,revision from red_quotation_documents where version_id=$1",
        [v],
      )
    ).document.packages.A.cells[0].price_fob_per_pkg,
    72,
  );
  count++;
  await db.exec("drop trigger simulate_red_failure on red_quotation_versions");
  await db.query("select red_mark_sent($1,$2,$3)", [v, 2, actor]);
  await assert.rejects(save(v, changed, 2), /발송/);
  count++;
  await assert.rejects(
    db.query("update red_quotation_versions set status='DRAFT' where id=$1", [
      v,
    ]),
    /immutable/,
  );
  count++;
  await assert.rejects(
    db.query("delete from red_quotations where id=$1", [q]),
    /보관/,
  );
  await assert.rejects(
    db.query("delete from red_quotation_versions where id=$1", [v]),
    /archive/,
  );
  await assert.rejects(
    db.query("delete from red_quotation_documents where version_id=$1", [v]),
    /cannot be deleted/,
  );
  count++;
  await assert.rejects(
    db.query(
      "insert into red_quotation_price_matrix_v2(quotation_id,version_key,quotation_version_id,price_fob_per_pkg) values($1,'v1',$2,999)",
      [q, v],
    ),
    /locked/,
  );
  count++;
  await assert.rejects(
    db.query(
      "insert into red_quotation_cost_inputs(red_quotation_version_id,unit_price_per_piece) values($1,999)",
      [v],
    ),
    /locked/,
  );
  count++;
  const copy = async (base, revision) =>
    (
      await scalar("select red_create_revision($1,$2,$3,$4,$5) as r", [
        base,
        JSON.stringify(doc),
        revision,
        "Buyer negotiation",
        actor,
      ])
    ).r;
  const copied = await copy(v, 2);
  assert.equal(copied.version_no, 2);
  const copiedDoc = await scalar(
    "select document from red_quotation_documents where version_id=$1",
    [copied.id],
  );
  assert.deepEqual(copiedDoc.document, saved.document);
  count++;
  assert.equal((await copy(v, 2)).version_no, 3);
  count++;
  await db.query("update red_quotations set archived_at=now() where id=$1", [
    q,
  ]);
  await assert.rejects(save(copied.id, doc, 1), /보관/);
  await assert.rejects(copy(v, 2), /보관/);
  count++;
  await db.query("update red_quotations set archived_at=null where id=$1", [q]);
  assert.equal((await save(copied.id, doc, 1)).revision, 2);
  count++;
  const empty = await create({
    ...doc,
    packages: { A: { cells: [], packaging_costs: [] } },
  });
  await assert.rejects(
    db.query("select red_mark_sent($1,1,$2)", [empty.version_id, actor]),
    /오퍼/,
  );
  count++;
  const before = (await scalar("select count(*)::int as n from red_quotations"))
    .n;
  await assert.rejects(create([]));
  assert.equal(
    (await scalar("select count(*)::int as n from red_quotations")).n,
    before,
  );
  count++;
  await db.exec("set role authenticated");
  await assert.rejects(
    db.query("select red_save_document($1,$2,2,$3)", [
      copied.id,
      JSON.stringify(doc),
      actor,
    ]),
    /permission denied/,
  );
  await db.exec("reset role");
  count++;
  await db.exec("set role service_role");
  const serviceCreated = await create();
  assert.ok(serviceCreated.version_id);
  assert.equal((await save(serviceCreated.version_id, doc, 1)).revision, 2);
  await db.exec("reset role");
  count++;
  console.log(
    JSON.stringify({
      passed: count,
      migrationExecutedTwice: true,
      checks:
        "atomic rollback, conflict detection, sent locks, legacy bypass rejection, complete revision copy, archive/restore, no hard deletes, client RPC denial",
    }),
  );
  await db.close();
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
