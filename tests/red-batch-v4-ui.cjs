const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  ts = require("typescript");
const rendererPath =
  process.env.QUOTATION_TEST_RENDERER_MODULE || "react-test-renderer";
const Renderer = require(rendererPath),
  React = require(
    path.join(
      path.dirname(require.resolve(rendererPath + "/package.json")),
      "../react",
    ),
  ),
  { act } = Renderer;
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
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
      },
    }).outputText;
  vm.runInThisContext("(function(require,module,exports){" + js + "\n})", {
    filename,
  })(
    (s) =>
      s === "react"
        ? React
        : s === "@/components/ui/button"
          ? { Button: (props) => React.createElement("button", props) }
          : s === "@/components/ui/input"
            ? { Input: (props) => React.createElement("input", props) }
            : s === "@/lib/redBatchCode"
              ? load("src/lib/redBatchCode.ts")
              : require(s),
    m,
    m.exports,
  );
  return m.exports;
}
const Component = load("src/app/production/batches/page.tsx").default;
const Q = "11111111-1111-4111-8111-111111111111",
  row = {
    id: Q,
    buyer_code: "RED",
    sku_code: "ASSORT-1",
    vendor_initial: "J",
    mfg_date: "2026-11-19",
    run_no: 1,
    label_type: "M",
    version: 0,
    batch_code: "JZ47DM0",
    po_no: "PO-1",
    guideline_version: "4.0",
    created_at: "2026-11-19",
  };
const button = (r, label) =>
  r.root.findAllByType("button").find((b) => b.children.join("") === label);
const input = (r, id) => r.root.findByProps({ id });
const change = async (r, id, value) =>
  act(async () => input(r, id).props.onChange({ target: { value } }));
const event = { preventDefault() {} };
const response = (data) => ({
  ok: true,
  json: async () => ({ success: true, ...data }),
});
global.window = { scrollTo() {}, confirm: () => true };
function network(rows = [], setupRequired = false) {
  const posts = [];
  global.fetch = async (url, init) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(init.body));
      return response({ row: { ...row, ...posts.at(-1), id: Q } });
    }
    return response({ rows, setupRequired });
  };
  return posts;
}
async function mount() {
  let r;
  await act(async () => {
    r = Renderer.create(React.createElement(Component));
  });
  return r;
}

test("new batch form previews ISO week 53, run 2 and saves label version zero", async () => {
  const posts = network();
  const r = await mount();
  assert.equal(input(r, "label-type").props.value, "");
  await change(r, "sku", "ASSORT-1");
  await change(r, "start-date", "2027-01-01");
  await change(r, "label-type", "M");
  await change(r, "run", "2");
  assert.ok(JSON.stringify(r.toJSON()).includes("JZ53NM0"));
  await act(async () => r.root.findAllByType("form")[0].props.onSubmit(event));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].run_no, 2);
  assert.equal(posts[0].version, 0);
  assert.equal(posts[0].source_id, null);
  r.unmount();
});
test("revision action locks production identity and saves a source-linked label revision", async () => {
  const posts = network([row]);
  const r = await mount();
  await act(async () => button(r, "라벨 수정").props.onClick());
  assert.ok(input(r, "sku").props.disabled);
  assert.ok(input(r, "start-date").props.disabled);
  assert.ok(input(r, "run").props.disabled);
  assert.ok(JSON.stringify(r.toJSON()).includes("JZ47DM1"));
  await act(async () => r.root.findAllByType("form")[0].props.onSubmit(event));
  assert.equal(posts[0].source_id, Q);
  assert.equal(posts[0].version, 1);
  assert.equal(posts[0].run_no, 1);
  r.unmount();
});
test("missing schema disables saving while old batch history stays visible", async () => {
  network([{ ...row, guideline_version: "legacy", sku_code: undefined }], true);
  const r = await mount();
  await change(r, "sku", "ASSORT-1");
  await change(r, "label-type", "M");
  assert.ok(button(r, "생산 배치 저장 (라벨 버전 0)").props.disabled);
  assert.equal(button(r, "라벨 수정"), undefined);
  assert.ok(JSON.stringify(r.toJSON()).includes(row.batch_code));
  r.unmount();
});
test("label version nine prevents further revisions", async () => {
  network([{ ...row, version: 9, batch_code: "JZ47DM9" }]);
  const r = await mount();
  assert.ok(button(r, "라벨 수정").props.disabled);
  r.unmount();
});
