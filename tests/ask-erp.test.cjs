const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

function load(name, replacements = {}) {
  const source = readFileSync(path.join(__dirname, "../src/app/api/ask-erp", name + ".ts"), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const result = {};
  new Function("exports", "require", outputText)(result, key => replacements[key] ?? require(key));
  return result;
}

test("Ask ERP preserves provider selection boundaries and validates AI output", async t => {
  t.mock.method(global, "fetch", async (url, options) => {
    const body = JSON.parse(options.body);
    assert.match(url, /dashscope\.aliyuncs\.com/);
    assert.equal(body.enable_thinking, false);
    assert.match(body.messages[1].content, /<PO_1>/);
    assert.doesNotMatch(body.messages[1].content, /4500100101/);
    return Response.json({ choices: [{ message: { content: "1" } }] });
  });
  const original = Object.fromEntries(["VERCEL", "OPENAI_API_KEY", "DASHSCOPE_API_KEY", "ASK_ERP_QWEN_WORKSPACE"]
    .map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, { VERCEL: "1", OPENAI_API_KEY: "fake", DASHSCOPE_API_KEY: "fake" });
    delete process.env.ASK_ERP_QWEN_WORKSPACE;
    const provider = load("provider");
    const req = country => new Request("http://localhost", { headers: country ? { "x-vercel-ip-country": country } : {} });
    assert.deepEqual(provider.availableModes(req("KR")), ["openai", "qwen", "direct"]);
    assert.deepEqual(provider.availableModes(req("CN")), ["qwen", "direct"]);
    assert.deepEqual(provider.availableModes(req()), ["qwen", "direct"]);
    const question = "PO 4500100101 的发票在哪里？";
    assert.deepEqual(provider.poCandidates(question), ["4500100101"]);
    assert.equal(await provider.interpretPO("qwen", question, provider.poCandidates(question)), "4500100101");
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Ask ERP checks permissions and supports direct lookup with no AI credentials", async () => {
  class ApiIdentityError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }
  const checks = [];
  let permissions = [];
  const provider = load("provider");
  const route = load("route", {
    "next/server": { NextResponse: { json: (data, init) => Response.json(data, init) } },
    "@/lib/apiIdentity": { ApiIdentityError, getApiIdentity: async () => ({ role: "staff", permissions }) },
    "./provider": { ...provider, availableModes: () => ["direct"] },
    "./trace": { tracePO: async (number, access) => {
      checks.push({ number, access });
      return { po: { number } };
    } },
  });
  const post = question => route.POST(new Request("http://localhost", {
    method: "POST", body: JSON.stringify({ question, mode: "openai" }),
  }));
  assert.equal((await post("4500100101")).status, 403);
  permissions = ["po.view", "shipment.view"];
  assert.equal((await post("PO 4500100101과 4500100102")).status, 400);
  const response = await post("PO ４５００１００１０１ 的发票在哪里？");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).mode, "direct");
  assert.deepEqual(checks, [{
    number: "4500100101", access: { shipment: true, invoice: false, packing: false },
  }]);
});
