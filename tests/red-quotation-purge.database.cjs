const { PGlite } = require(
  process.env.RED_TEST_PGLITE_MODULE || "@electric-sql/pglite",
);
const fs = require("fs"),
  assert = require("node:assert/strict");
(async () => {
  const db = new PGlite();
  const prior = fs.readFileSync("tests/red-quotation.database.cjs", "utf8");
  const schema = prior.match(/await db.exec\(`([\s\S]*?)`\);/)[1];
  await db.exec(schema);
  await db.exec(
    `create table red_quotation_images(id uuid primary key default gen_random_uuid(),quotation_id uuid references red_quotations(id),path text);create table red_soft_link(id uuid primary key default gen_random_uuid(),red_quotation_id uuid);create table red_external(id uuid primary key default gen_random_uuid(),red_quotation_id uuid references red_quotations(id) on delete cascade);`,
  );
  await db.exec(
    fs.readFileSync(
      "supabase/migrations/20261031000200_red_quotation_integrity.sql",
      "utf8",
    ),
  );
  const sql = fs.readFileSync(
    "supabase/migrations/20261101000300_red_quotation_test_purge.sql",
    "utf8",
  );
  await db.exec(sql);
  await db.exec(sql);
  const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const actor = "33333333-3333-4333-8333-333333333333";
  const create = async () =>
    (
      await scalar("select red_create_quotation($1,$2,$3) r", [
        JSON.stringify({ title: "test" }),
        JSON.stringify({ header: {}, packages: { A: { cells: [] } } }),
        actor,
      ])
    ).r;
  const preview = async (q) =>
    (await scalar("select red_purge_preview($1) r", [q])).r;
  const purge = async (q, p, no = p.quotation_no) =>
    (
      await scalar("select red_purge_commit($1,$2,$3,$4) r", [
        q,
        no,
        p.confirmation_token,
        actor,
      ])
    ).r;
  let count = 1;
  const q = await create();
  await db.query(
    "insert into red_quotation_images(quotation_id,path) values($1,$2)",
    [q.id, "quotations/" + q.id + "/x.png"],
  );
  const rev = (
    await scalar("select red_create_revision($1,$2,$3,$4,$5) r", [
      q.version_id,
      JSON.stringify({ header: {}, packages: { A: { cells: [] } } }),
      1,
      "second draft",
      actor,
    ])
  ).r;
  await db.exec(
    "alter table red_quotation_price_matrix disable trigger red_guard_legacy_price",
  );
  await db.query(
    "insert into red_quotation_price_matrix(quotation_id,price_fob_per_pkg) values($1,12)",
    [q.id],
  );
  await db.exec(
    "alter table red_quotation_price_matrix enable trigger red_guard_legacy_price",
  );
  let p = await preview(q.id);
  assert.equal(p.eligible, true);
  assert.equal(p.counts.quotation_versions, 2);
  assert.equal(p.counts.quotation_line_attachments, 1);
  count++;
  await assert.rejects(purge(q.id, p, "WRONG"), /견적번호/);
  count++;
  await db.query("update red_quotations set title='changed' where id=$1", [
    q.id,
  ]);
  await assert.rejects(purge(q.id, p), /변경/);
  p = await preview(q.id);
  count++;
  await db.query("insert into red_external(red_quotation_id) values($1)", [
    q.id,
  ]);
  assert.equal((await preview(q.id)).eligible, false);
  await assert.rejects(purge(q.id, await preview(q.id)), /연결/);
  await db.query("delete from red_external where red_quotation_id=$1", [q.id]);
  count++;
  await db.exec(
    `create function fail_purge() returns trigger language plpgsql as $$begin raise exception 'late failure';end$$;create trigger fail_purge before delete on red_quotations for each row execute function fail_purge();`,
  );
  await assert.rejects(purge(q.id, await preview(q.id)), /late failure/);
  assert.equal(
    (await scalar("select count(*) n from red_quotation_documents")).n,
    2,
  );
  assert.equal(
    (await scalar("select count(*) n from red_quotation_file_cleanup_jobs")).n,
    0,
  );
  await db.exec("drop trigger fail_purge on red_quotations");
  count++;
  const deleted = await purge(q.id, await preview(q.id));
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.cleanup_pending, 1);
  for (const t of [
    "red_quotations",
    "red_quotation_versions",
    "red_quotation_documents",
    "red_quotation_images",
  ])
    assert.equal((await scalar("select count(*) n from " + t)).n, 0);
  count++;
  await assert.rejects(
    db.query("insert into red_soft_link(red_quotation_id) values($1)", [q.id]),
    /삭제/,
  );
  count++;
  const next = await create();
  assert.notEqual(next.red_quotation_no, q.red_quotation_no);
  count++;
  await db.query(
    "insert into red_quotation_images(quotation_id,path) values($1,$2)",
    [next.id, "quotations/" + q.id + "/x.png"],
  );
  const shared = (
    await scalar("select red_purge_cleanup_claim($1,$2) r", [q.id, actor])
  ).r;
  assert.equal(shared.retained, 1);
  assert.equal(shared.jobs.length, 0);
  count++;
  await db.query(
    "update red_quotation_versions set status='SENT',sent_at=now() where id=$1",
    [next.version_id],
  );
  assert.equal((await preview(next.id)).eligible, false);
  await assert.rejects(purge(next.id, await preview(next.id)), /발송/);
  await assert.rejects(
    db.query("delete from red_quotations where id=$1", [next.id]),
    /보관/,
  );
  count++;
  await db.exec("set role authenticated");
  await assert.rejects(preview(next.id), /permission/);
  await db.exec("reset role");
  count++;
  const revisedSent = (
    await scalar("select red_create_revision($1,$2,$3,$4,$5) r", [
      next.version_id,
      JSON.stringify({ header: {}, packages: { A: { cells: [] } } }),
      1,
      "new draft",
      actor,
    ])
  ).r;
  assert.equal((await preview(next.id)).eligible, false);
  count++;
  const clean = await create();
  const d = await purge(clean.id, await preview(clean.id));
  assert.equal(d.deleted, true);
  assert.ok(await preview(next.id));
  count++;
  console.log(
    JSON.stringify({
      passed: count,
      migrationExecutedTwice: true,
      checks:
        "typed confirmation, stale state, sent blocks, cascade references, atomic rollback, image jobs, sharing, number reservations, client denial",
    }),
  );
  await db.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
