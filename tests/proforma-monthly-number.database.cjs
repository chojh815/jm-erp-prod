const { PGlite } = require(process.env.PROFORMA_TEST_PGLITE_MODULE || "@electric-sql/pglite");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20261123000100_proforma_monthly_number.sql"),
  "utf8",
);
const red = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const noCode = "00000000-0000-4000-8000-000000000003";
const testSchema = [
  "create role anon; create role authenticated; create role service_role bypassrls;",
  "create table companies(id uuid primary key, code text);",
  "create table proforma_headers (",
  " id uuid primary key default gen_random_uuid(), invoice_no text not null, invoice_date date,",
  " po_no text, buyer_id uuid, buyer_name text, currency text not null, payment_term text,",
  " ship_mode text, destination text, incoterm text, created_by uuid, created_by_email text,",
  " created_at timestamptz not null default now(), shipping_origin_code text, origin_code text,",
  " is_deleted boolean not null default false, deleted_at timestamptz);",
  "create table proforma_lines (",
  " id uuid primary key default gen_random_uuid(), proforma_header_id uuid not null references proforma_headers(id),",
  " line_no integer not null, buyer_style_no text, jm_style_no text, description text,",
  " color text, size text, hs_code text, qty numeric not null, uom text, unit_price numeric not null,",
  " currency text, amount numeric not null, upc_code text, is_deleted boolean not null default false,",
  " unique(proforma_header_id, line_no));",
].join("\n");

(async () => {
  const db = new PGlite();
  try {
    await db.exec(testSchema);
    await db.exec(migration);
    const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
    const save = async (poNo, buyer = red, lines = [{ line_no: 1, qty: 1, unit_price: 2, amount: 2 }]) =>
      (await rows("select save_proforma_with_monthly_number($1::jsonb,$2::jsonb) as saved",
        [JSON.stringify({ po_no: poNo, buyer_id: buyer, currency: "USD" }), JSON.stringify(lines)]))[0].saved;
    await rows("insert into companies(id,code) values($1,' rbk '),($2,'LDC'),($3,null)", [red, other, noCode]);
    await rows("insert into proforma_headers(invoice_no,po_no,buyer_id,currency,invoice_date) values('JM-RBK-PI-20261123-091148','legacy',$1,'USD','2026-11-23')", [red]);

    const period = (await rows("select to_char(clock_timestamp() at time zone 'Asia/Seoul','YYMM') as period"))[0].period;
    await db.exec("insert into proforma_number_counters values ('RBK',(date_trunc('month',clock_timestamp() at time zone 'Asia/Seoul')-interval '1 month')::date,11)");

    const legacy = await save("legacy");
    assert.equal(legacy.invoice_no, "JM-RBK-PI-20261123-091148");
    assert.equal(legacy.updated, true);
    assert.equal((await rows("select invoice_date::text as issue_date from proforma_headers where id=$1", [legacy.header_id]))[0].issue_date, "2026-11-23");

    const one = await save("one");
    assert.equal(one.invoice_no, "PI-RBK-" + period + "-001");
    assert.equal(one.updated, false);
    const two = await save("two");
    assert.equal(two.invoice_no, "PI-RBK-" + period + "-002");
    assert.equal((await save("other", other)).invoice_no, "PI-LDC-" + period + "-001");
    assert.equal((await save("no-code", noCode)).invoice_no, "PI-" + period + "-001");

    const edited = await save("one", red, [{ line_no: 1, qty: 8, unit_price: 2, amount: 16 }]);
    assert.deepEqual(edited, { ...one, updated: true });
    assert.equal((await rows("select qty::int from proforma_lines where proforma_header_id=$1", [one.header_id]))[0].qty, 8);

    await assert.rejects(save("one", red, [{ line_no: 1, qty: null, unit_price: 2, amount: 2 }]), { code: "23502" });
    assert.equal((await rows("select qty::int from proforma_lines where proforma_header_id=$1", [one.header_id]))[0].qty, 8);

    await assert.rejects(save("failed-new", red, [{ line_no: 1, qty: null, unit_price: 2, amount: 2 }]), { code: "23502" });
    assert.equal((await save("after-failure")).invoice_no, "PI-RBK-" + period + "-003");
    assert.equal((await rows("select count(*)::int as n from proforma_headers where po_no='failed-new'"))[0].n, 0);

    await rows("insert into proforma_headers(invoice_no,po_no,buyer_id,currency) values($1,'already-issued',$2,'USD')", ["PI-RBK-" + period + "-004", red]);
    assert.equal((await save("after-manual")).invoice_no, "PI-RBK-" + period + "-005");
    await db.exec("update proforma_number_counters set last_number=999 where buyer_code='RBK' and last_number=5");
    assert.equal((await save("thousand")).invoice_no, "PI-RBK-" + period + "-1000");
    assert.equal((await rows("select has_function_privilege('authenticated','public.save_proforma_with_monthly_number(jsonb,jsonb)','execute') as allowed"))[0].allowed, false);
    assert.equal((await rows("select has_function_privilege('service_role','public.save_proforma_with_monthly_number(jsonb,jsonb)','execute') as allowed"))[0].allowed, true);
    const retirementMigration = fs.readFileSync(
      path.join(__dirname, "../supabase/migrations/20261123000200_proforma_retirement.sql"),
      "utf8",
    );
    await db.exec(retirementMigration);
    await db.exec(retirementMigration);
    const retire = (item, action, reason = null) =>
      rows("select retire_proforma($1,$2,$3,$4)", [item.header_id, action, reason, red]);
    const status = async (item) =>
      (await rows("select * from proforma_headers where id=$1", [item.header_id]))[0];

    await retire(one, "delete");
    await retire(one, "delete");
    assert.equal((await status(one)).is_deleted, true);
    assert.equal((await status(one)).deleted_by, red);
    assert.ok((await status(one)).deleted_at);
    assert.equal((await rows("select qty::int from proforma_lines where proforma_header_id=$1", [one.header_id]))[0].qty, 8);
    await assert.rejects(retire(one, "void", "wrong action"), { code: "55000" });

    const reissued = await save("one");
    assert.notEqual(reissued.header_id, one.header_id);
    assert.equal(reissued.invoice_no, "PI-RBK-" + period + "-1001");
    assert.equal((await save("one")).invoice_no, reissued.invoice_no);

    await assert.rejects(retire(legacy, "void", "  "), { code: "22023" });
    assert.equal((await status(legacy)).voided_at, null);
    await retire(legacy, "void", "  Superseded after buyer review.  ");
    await retire(legacy, "void", "Retry must preserve the original reason");
    assert.equal((await status(legacy)).void_reason, "Superseded after buyer review.");
    assert.equal((await status(legacy)).voided_by, red);
    assert.ok((await status(legacy)).voided_at);
    assert.equal((await status(legacy)).is_deleted, false);
    assert.equal((await save("legacy")).invoice_no, "PI-RBK-" + period + "-1002");
    assert.equal((await status(legacy)).invoice_no, legacy.invoice_no);

    assert.equal((await rows("select has_function_privilege('authenticated','public.retire_proforma(uuid,text,text,uuid)','execute') as allowed"))[0].allowed, false);
    assert.equal((await rows("select has_function_privilege('service_role','public.retire_proforma(uuid,text,text,uuid)','execute') as allowed"))[0].allowed, true);
    console.log("PI monthly numbering, retirement, reissue, permissions and transaction rollback passed.");
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
