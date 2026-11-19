const { PGlite } = require(
  process.env.RED_TEST_PGLITE_MODULE || "@electric-sql/pglite",
);
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
(async () => {
  const db = new PGlite();
  let passed = 0;
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table companies(id uuid primary key default gen_random_uuid(),company_type text,code text);
 create table po_headers(id uuid primary key default gen_random_uuid(),po_no text,buyer_id uuid references companies(id),buyer_name text,status text,is_deleted boolean,shipping_origin_code text,origin_code text,created_at timestamptz default now());
 create table po_lines(id uuid primary key default gen_random_uuid(),po_header_id uuid references po_headers(id),line_no integer,buyer_style_no text,buyer_style_code text,upc text,color text,size text,description text,is_deleted boolean,qty numeric,qty_cancelled numeric);
 create table shipments(id uuid primary key default gen_random_uuid(),status text,is_deleted boolean);
 create table shipment_lines(id uuid primary key default gen_random_uuid(),shipment_id uuid references shipments(id),po_line_id uuid references po_lines(id),shipped_qty numeric,is_deleted boolean);
 create table production_batches(id uuid primary key default gen_random_uuid(),po_no text,buyer_code text,batch_code text);`);
    await db.exec(
      fs.readFileSync(
        path.join(
          __dirname,
          "../supabase/migrations/20261119000100_kiss_batch_v4.sql",
        ),
        "utf8",
      ),
    );
    const migration = fs.readFileSync(
      path.join(
        __dirname,
        "../supabase/migrations/20261119000200_red_batch_pending_options.sql",
      ),
      "utf8",
    );
    await db.exec(migration);
    await db.exec(migration);
    passed++;
    const q = async (s, args = []) => (await db.query(s, args)).rows;
    const red = (
      await q(
        "insert into companies(company_type,code) values('buyer','RBK') returning id",
      )
    )[0].id;
    const other = (
      await q(
        "insert into companies(company_type,code) values('buyer','LDC') returning id",
      )
    )[0].id;
    const po = async (
      name,
      buyer = red,
      status = "CONFIRMED",
      deleted = false,
    ) =>
      (
        await q(
          "insert into po_headers(po_no,buyer_id,status,is_deleted,shipping_origin_code) values($1,$2,$3,$4,$5) returning id",
          [name, buyer, status, deleted, "CN_QINGDAO"],
        )
      )[0].id;
    const line = async (id, sku, qty = 100, cancelled = 0, deleted = false) =>
      (
        await q(
          "insert into po_lines(po_header_id,buyer_style_no,qty,qty_cancelled,is_deleted) values($1,$2,$3,$4,$5) returning id",
          [id, sku, qty, cancelled, deleted],
        )
      )[0].id;
    const ship = async (
      id,
      qty,
      status = "SHIPPED",
      deleted = false,
      lineDeleted = false,
    ) => {
      const shipment = (
        await q(
          "insert into shipments(status,is_deleted) values($1,$2) returning id",
          [status, deleted],
        )
      )[0].id;
      await q(
        "insert into shipment_lines(shipment_id,po_line_id,shipped_qty,is_deleted) values($1,$2,$3,$4)",
        [shipment, id, qty, lineDeleted],
      );
    };
    const pending = await po("PENDING");
    await line(pending, "A", 100, 10);
    const partial = await po("PARTIAL");
    const a = await line(partial, "A", 50);
    await line(partial, "B", 50);
    await ship(a, 30);
    await ship(a, 5, "DRAFT");
    const done = await po("DONE");
    await ship(await line(done, "A"), 100, "CONFIRMED");
    const cancelledQty = await po("CANCELLED-QTY");
    await line(cancelledQty, "A", 100, 100);
    const cancelled = await po("CANCELLED", red, "CANCELLED");
    await line(cancelled, "A");
    const foreign = await po("OTHER-BUYER", other);
    await line(foreign, "A");
    const deleted = await po("DELETED", red, "CONFIRMED", true);
    await line(deleted, "A");
    const cancelledShip = await po("SHIP-CANCELLED");
    const cs = await line(cancelledShip, "A");
    await ship(cs, 60, "CANCELLED");
    await ship(cs, 20, "SHIPPED", true);
    await ship(cs, 10, "SHIPPED", false, true);
    const removedLine = await po("LINE-REMOVED");
    await line(removedLine, "A", 100, 0, true);
    const row = async (id) => {
      const result = (
        await q("select * from v_red_batch_po_options where id=$1", [id])
      )[0];
      return result
        ? { ...result, pending_qty: Number(result.pending_qty) }
        : undefined;
    };
    assert.equal((await row(pending)).pending_qty, 90);
    passed++;
    assert.equal((await row(partial)).pending_qty, 70);
    passed++;
    assert.equal((await row(done)).pending_qty, 0);
    passed++;
    assert.equal((await row(cancelledQty)).pending_qty, 0);
    passed++;
    for (const id of [cancelled, foreign, deleted])
      assert.equal(await row(id), undefined);
    passed++;
    assert.equal((await row(cancelledShip)).pending_qty, 100);
    passed++;
    assert.equal((await row(removedLine)).pending_qty, 0);
    passed++;
    const user = "33333333-3333-4333-8333-333333333333";
    const batch = async (poNo, sku, vendor = "Q") =>
      q("select * from create_kiss_batch_v4($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
        sku,
        "2026-11-19",
        vendor,
        1,
        "M",
        0,
        poNo,
        null,
        user,
      ]);
    await batch("PARTIAL", "A");
    assert.equal((await row(partial)).unbatched_pending_line_count, 1);
    passed++;
    await q(
      "insert into production_batches(po_no,buyer_code,batch_code) values('PARTIAL','RED','JZ47DM0')",
    );
    assert.equal((await row(partial)).has_legacy_batch, true);
    assert.equal((await row(partial)).unbatched_pending_line_count, 1);
    passed++;
    await batch("PARTIAL", "B", "J");
    assert.equal((await row(partial)).unbatched_pending_line_count, 1);
    passed++;
    await batch("PARTIAL", "B", "Q");
    assert.equal((await row(partial)).unbatched_pending_line_count, 0);
    passed++;
    const eligible = (
      await q(
        "select po_no from v_red_batch_po_options where pending_qty>0 order by po_no",
      )
    ).map((row) => row.po_no);
    assert.deepEqual(eligible, ["PARTIAL", "PENDING", "SHIP-CANCELLED"]);
    passed++;
    const missing = (
      await q(
        "select po_no from v_red_batch_po_options where pending_qty>0 and unbatched_pending_line_count>0 order by po_no",
      )
    ).map((row) => row.po_no);
    assert.deepEqual(missing, ["PENDING", "SHIP-CANCELLED"]);
    passed++;
    await db.exec("set role authenticated");
    await assert.rejects(
      q("select * from v_red_batch_po_options"),
      /permission denied/,
    );
    await assert.rejects(
      q("select * from v_red_batch_po_lines"),
      /permission denied/,
    );
    await db.exec("reset role;set role service_role");
    assert.ok((await q("select * from v_red_batch_po_options")).length);
    await db.exec("reset role");
    passed++;
    for (let i = 0; i < 55; i++) {
      const id = await po("OLD-" + i);
      await ship(await line(id, "OLD"), 100);
    }
    assert.equal(
      (
        await q(
          "select * from v_red_batch_po_options where pending_qty>0 limit 50",
        )
      ).length,
      3,
    );
    passed++;
    console.log(
      JSON.stringify({
        passed,
        migrationExecutedTwice: true,
        checks:
          "RED-only, pending quantity, partial shipments, Cancel Qty, cancelled/deleted shipments, per-item registration, vendor match, legacy ambiguity, filter before pagination, client denial",
      }),
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
