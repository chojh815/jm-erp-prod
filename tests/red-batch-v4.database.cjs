const { PGlite } = require(
  process.env.RED_TEST_PGLITE_MODULE || "@electric-sql/pglite",
);
const fs = require("node:fs"),
  vm = require("node:vm"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  ts = require("typescript");
(async () => {
  const db = new PGlite();
  let passed = 0;
  try {
    await db.exec(
      "create role anon;create role authenticated;create role service_role bypassrls;",
    );
    const sql = fs.readFileSync(
      path.join(
        __dirname,
        "../supabase/migrations/20261119000100_kiss_batch_v4.sql",
      ),
      "utf8",
    );
    await db.exec(sql);
    await db.exec(sql);
    passed++;
    const module = { exports: {} };
    const js = ts.transpileModule(
      fs.readFileSync(
        path.join(__dirname, "../src/lib/redBatchCode.ts"),
        "utf8",
      ),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText;
    vm.runInThisContext("(function(module,exports){" + js + "})")(
      module,
      module.exports,
    );
    const make = module.exports.makeRedBatchCode;
    const q = async (s, p = []) => (await db.query(s, p)).rows;
    for (let year = 2016; year <= 2037; year++)
      for (const suffix of ["01-04", "06-15", "12-28", "12-31"])
        for (let run = 1; run <= 3; run++) {
          const date = year + "-" + suffix,
            code = make({ mfgDate: date, runNo: run, labelType: "V" });
          assert.equal(
            (
              await q("select kiss_batch_code_v4($1,$2,$3,$4,$5) code", [
                date,
                "J",
                run,
                "V",
                0,
              ])
            )[0].code,
            code,
          );
        }
    passed++;
    const U = "33333333-3333-4333-8333-333333333333";
    const create = async (o = {}) => {
      const p = {
        sku: "ASSORT-1",
        date: "2026-11-19",
        vendor: "J",
        run: 1,
        type: "M",
        version: 0,
        po: "PO-1",
        source: null,
        ...o,
      };
      return (
        await q(
          "select * from create_kiss_batch_v4($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            p.sku,
            p.date,
            p.vendor,
            p.run,
            p.type,
            p.version,
            p.po,
            p.source,
            U,
          ],
        )
      )[0];
    };
    await db.exec("set role authenticated");
    await assert.rejects(create(), /permission denied/);
    await db.exec("reset role");
    passed++;
    await db.exec("set role service_role");
    const first = await create({ sku: " assort-1 " });
    assert.equal(first.batch_code, "JZ47DM0");
    assert.equal(first.sku_code, "ASSORT-1");
    passed++;
    const second = await create({ run: 2 });
    assert.equal(second.batch_code, "JZ47LM0");
    passed++;
    const third = await create({ run: 3 });
    assert.equal(third.batch_code, "JZ47UM0");
    passed++;
    await assert.rejects(create(), /duplicate key/);
    await assert.rejects(create({ type: "V" }), /duplicate key/);
    passed++;
    const other = await create({ sku: "ASSORT-2" });
    assert.equal(other.batch_code, first.batch_code);
    passed++;
    const revised = await create({ source: first.id, version: 1 });
    assert.equal(revised.batch_code, "JZ47DM1");
    assert.equal(revised.base_batch_id, first.id);
    passed++;
    await assert.rejects(create({ source: first.id, version: 1 }), /최신/);
    passed++;
    await assert.rejects(
      create({ source: revised.id, sku: "OTHER", version: 2 }),
      /원본/,
    );
    passed++;
    await assert.rejects(
      create({ source: revised.id, type: "V", version: 2 }),
      /원본/,
    );
    passed++;
    await assert.rejects(create({ source: null, version: 1 }), /버전 0/);
    passed++;
    await assert.rejects(
      create({ source: "00000000-0000-4000-8000-000000000000", version: 1 }),
      /없습니다/,
    );
    passed++;
    await assert.rejects(create({ sku: "X", run: 4 }), /Invalid KISS/);
    await assert.rejects(
      create({ sku: "X", version: 10, source: other.id }),
      /원본|최신|Invalid KISS/,
    );
    passed++;
    await assert.rejects(
      q("update production_batches_v4 set sku_code='CHANGED' where id=$1", [
        first.id,
      ]),
      /변경/,
    );
    passed++;
    await q("update production_batches_v4 set po_no='PO-UPDATED' where id=$1", [
      first.id,
    ]);
    assert.equal(
      (
        await q("select po_no from production_batches_v4 where id=$1", [
          first.id,
        ])
      )[0].po_no,
      "PO-UPDATED",
    );
    passed++;
    await assert.rejects(
      q("delete from production_batches_v4 where id=$1", [first.id]),
      /foreign key/,
    );
    passed++;
    const boundary = await create({
      sku: "YEAR-END",
      date: "2027-01-01",
      type: "V",
    });
    assert.equal(boundary.batch_code, "JZ53EV0");
    passed++;
    let latest = revised;
    for (let version = 2; version <= 9; version++)
      latest = await create({ source: latest.id, version });
    assert.equal(latest.batch_code, "JZ47DM9");
    await assert.rejects(
      create({ source: latest.id, version: 10 }),
      /Invalid KISS/,
    );
    passed++;
    await assert.rejects(
      db.exec(
        "insert into production_batches_v4(sku_code,mfg_date,vendor_initial,run_no,label_type,version,batch_code,created_by) values('FORGED','2026-11-19','J',1,'M',0,'JZ47DM0','33333333-3333-4333-8333-333333333333')",
      ),
      /permission denied/,
    );
    passed++;
    console.log(
      JSON.stringify({
        passed,
        isoComparisons: 264,
        migrationExecutedTwice: true,
      }),
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
