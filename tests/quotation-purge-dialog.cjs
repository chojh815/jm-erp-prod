// Optional component interaction test: use the bundled test-only renderer path.
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("fs"),
  path = require("path"),
  vm = require("vm"),
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
const moduleValue = { exports: {} },
  filename = path.resolve(
    __dirname,
    "../src/components/quotation/QuotationPurgeDialog.tsx",
  );
const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.React,
    esModuleInterop: true,
  },
}).outputText;
const Box = ({ children }) => React.createElement("div", {}, children),
  dialog = {
    Dialog: ({ open, children }) =>
      open ? React.createElement("section", {}, children) : null,
    DialogContent: Box,
    DialogHeader: Box,
    DialogTitle: ({ children }) => React.createElement("h2", {}, children),
  };
vm.runInThisContext(`(function(require,module,exports){${source}\n})`, {
  filename,
})(
  (s) =>
    s === "react"
      ? React
      : s === "@/components/ui/dialog"
        ? dialog
        : require(s),
  moduleValue,
  moduleValue.exports,
);
const Component = moduleValue.exports.default;
const Q = "11111111-1111-4111-8111-111111111111",
  eligible = {
    ok: true,
    eligible: true,
    quotation_no: "QUO-26-0001",
    confirmation_token: "a".repeat(32),
    counts: {
      quotation_versions: 2,
      document_lines: 3,
      quotation_line_attachments: 1,
    },
  };
const response = (b) => ({ ok: true, json: async () => b }),
  button = (r, label) =>
    r.root.findAllByType("button").find((b) => b.children.join("") === label),
  fill = async (r) => {
    await act(async () => {
      r.root
        .findAllByType("input")
        .find((i) => i.props.type !== "checkbox")
        .props.onChange({ target: { value: "QUO-26-0001" } });
    });
    await act(async () =>
      r.root
        .findAllByType("input")
        .find((i) => i.props.type === "checkbox")
        .props.onChange({ target: { checked: true } }),
    );
  };
test("warning, typed number and explicit checkbox all precede a single permanent delete", async () => {
  let posts = 0,
    resolvePost,
    closed = 0;
  global.fetch = async (url, init) => {
    if (!init?.method) return response(eligible);
    posts++;
    return new Promise(
      (r) =>
        (resolvePost = () =>
          r(
            response({
              deleted: true,
              quotation_no: "QUO-26-0001",
              cleanup: { pending: 0 },
            }),
          )),
    );
  };
  let r;
  await act(async () => {
    r = Renderer.create(
      React.createElement(Component, {
        id: Q,
        quotationNo: "QUO-26-0001",
        onDeleted: () => closed++,
      }),
    );
  });
  await act(async () => button(r, "테스트 견적 완전 삭제").props.onClick());
  const text = JSON.stringify(r.toJSON());
  assert.ok(text.includes("이 작업은 되돌릴 수 없습니다."));
  assert.ok(text.includes("보관함에서도 복원할 수 없습니다."));
  assert.ok(button(r, "복구 불가 · 완전 삭제").props.disabled);
  await act(async () =>
    r.root
      .findAllByType("input")
      .find((i) => i.props.type !== "checkbox")
      .props.onChange({ target: { value: "wrong" } }),
  );
  assert.ok(button(r, "복구 불가 · 완전 삭제").props.disabled);
  await fill(r);
  const remove = button(r, "복구 불가 · 완전 삭제");
  assert.equal(remove.props.disabled, false);
  await act(async () => {
    remove.props.onClick();
    remove.props.onClick();
  });
  assert.equal(posts, 1);
  await act(async () => resolvePost());
  assert.ok(JSON.stringify(r.toJSON()).includes("견적 삭제 완료"));
  await act(async () => button(r, "확인").props.onClick());
  assert.equal(closed, 1);
  r.unmount();
});
test("issued or linked quotes display refusal and cannot enable the destructive action", async () => {
  global.fetch = async () =>
    response({
      ...eligible,
      eligible: false,
      reasons: ["발송 이력이 있는 견적은 완전 삭제할 수 없습니다."],
    });
  let r;
  await act(async () => {
    r = Renderer.create(
      React.createElement(Component, {
        id: Q,
        quotationNo: "QUO-26-0001",
        onDeleted: () => {},
      }),
    );
  });
  await act(async () => button(r, "테스트 견적 완전 삭제").props.onClick());
  assert.ok(JSON.stringify(r.toJSON()).includes("발송 이력이 있는 견적"));
  assert.equal(r.root.findAllByType("input").length, 0);
  assert.ok(button(r, "복구 불가 · 완전 삭제").props.disabled);
  r.unmount();
});
test("Storage cleanup failure is shown as pending after successful quote deletion and can be retried", async () => {
  let attempts = 0;
  global.fetch = async (url, init) => {
    if (url.endsWith("purge-cleanup") && ++attempts === 1)
      return { ok: false, json: async () => ({ error: "temporary failure" }) };
    return response(
      !init?.method
        ? eligible
        : url.endsWith("purge-cleanup")
          ? { cleanup: { pending: 0, retained: 0 } }
          : { deleted: true, cleanup: { pending: 2 } },
    );
  };
  let r;
  await act(async () => {
    r = Renderer.create(
      React.createElement(Component, {
        id: Q,
        quotationNo: "QUO-26-0001",
        onDeleted: () => {},
      }),
    );
  });
  await act(async () => button(r, "테스트 견적 완전 삭제").props.onClick());
  await fill(r);
  await act(async () => button(r, "복구 불가 · 완전 삭제").props.onClick());
  assert.ok(button(r, "첨부파일 정리 다시 시도"));
  await act(async () => button(r, "첨부파일 정리 다시 시도").props.onClick());
  assert.ok(JSON.stringify(r.toJSON()).includes("첨부파일 정리를 마쳤습니다."));
  r.unmount();
});
test("user may cancel a read-only eligibility check without deleting anything", async () => {
  let resolvePreview;
  global.fetch = async () =>
    new Promise((r) => (resolvePreview = () => r(response(eligible))));
  let r;
  await act(async () => {
    r = Renderer.create(
      React.createElement(Component, {
        id: Q,
        quotationNo: "QUO-26-0001",
        onDeleted: () => {},
      }),
    );
  });
  await act(async () => button(r, "테스트 견적 완전 삭제").props.onClick());
  assert.equal(button(r, "취소").props.disabled, false);
  await act(async () => button(r, "취소").props.onClick());
  await act(async () => resolvePreview());
  assert.equal(r.root.findAllByType("section").length, 0);
  r.unmount();
});
