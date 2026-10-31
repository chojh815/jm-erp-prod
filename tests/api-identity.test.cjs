const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const ts = require("typescript");
let user, profile, rows;
function load(name) {
  const module = { exports: {} };
  const code = ts.transpileModule(
    fs.readFileSync(path.resolve(__dirname, "..", name), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  const request = (name) => {
    if (name === "next/headers")
      return { cookies: () => ({ getAll: () => [], set() {} }) };
    if (name === "@supabase/ssr")
      return {
        createServerClient: () => ({
          auth: { getUser: async () => ({ data: { user }, error: null }) },
        }),
      };
    if (name === "@/lib/supabaseAdmin")
      return {
        supabaseAdmin: {
          from(table) {
            const q = {
              select() {
                return q;
              },
              eq() {
                return q;
              },
              maybeSingle() {
                return q;
              },
              then(resolve) {
                return Promise.resolve({
                  data: table === "user_profiles" ? profile : rows[table] || [],
                  error: null,
                }).then(resolve);
              },
            };
            return q;
          },
        },
      };
    if (name === "@/config/permissions")
      return load("src/config/permissions.ts");
    return require(name);
  };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(
    request,
    module,
    module.exports,
  );
  return module.exports;
}
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon";
const { getApiIdentity } = load("src/lib/apiIdentity.ts");
const { PERMISSIONS, ROLE_DEFAULT_PERMISSIONS } = load(
  "src/config/permissions.ts",
);
function fixture(role = "staff") {
  user = { id: "user-id", email: "auth@example.com" };
  profile = {
    user_id: user.id,
    email: "profile@example.com",
    name: "Staff A",
    role,
    is_active: true,
  };
  rows = {};
}
test("identity rejects anonymous, missing and inactive profiles", async () => {
  fixture();
  user = null;
  await assert.rejects(getApiIdentity(), { status: 401 });
  fixture();
  profile = null;
  await assert.rejects(getApiIdentity(), { status: 404 });
  fixture();
  profile.is_active = false;
  await assert.rejects(getApiIdentity(), { status: 403 });
});
test("admin retains all existing permissions and normalized role", async () => {
  fixture(" ADMIN ");
  const identity = await getApiIdentity();
  assert.equal(identity.role, "admin");
  assert.deepEqual(identity.permissions, PERMISSIONS.map(String));
  assert.equal(identity.user.email, "profile@example.com");
});
test("DB role permissions, overrides and legacy revokes retain their precedence", async () => {
  fixture();
  rows.v_role_permission_codes = [
    { permission_code: "view" },
    { permission_code: "edit" },
  ];
  rows.role_permission_defaults = [{ perm_key: "edit", allowed: false }];
  rows.user_permission_overrides = [
    { perm_key: "edit", allowed: true },
    { perm_key: "view", allowed: false },
  ];
  rows.user_permission_grants = [{ perm_key: "download" }];
  rows.user_permission_revokes = [{ perm_key: "edit" }];
  assert.deepEqual((await getApiIdentity()).permissions, ["download"]);
});
test("missing permission rows retain constants fallback; unknown roles become viewer", async () => {
  fixture();
  assert.deepEqual((await getApiIdentity()).permissions, [
    ...ROLE_DEFAULT_PERMISSIONS.staff,
  ]);
  fixture("unknown");
  const identity = await getApiIdentity();
  assert.equal(identity.role, "viewer");
  assert.deepEqual(identity.permissions, [...ROLE_DEFAULT_PERMISSIONS.viewer]);
});
