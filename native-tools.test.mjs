import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
async function tools(stubs = {}, read) {
  const bundle = await build({ entryPoints: ["server/native-tools.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "fixture-services", setup(build) { build.onResolve({ filter: /^\./ }, args => Object.hasOwn(stubs, args.path) ? { path: "fixture:" + args.path, external: true } : undefined); } }] });
  const module = { exports: {} };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(id => id.startsWith("fixture:") ? stubs[id.slice(8)] : require(id), module, module.exports);
  let open;
  module.exports.contributeAgentTools({ before(name, handler) { assert.equal(name, "agent.session_open"); open = handler; return () => {}; } }, read);
  const request = { purpose: "interactive", provider: "claude", labels: {}, workspaceId: "w1", tools: [] };
  return { definitions: open({ request }).tools, module: module.exports };
}
const context = () => ({ agent: { id: "caller", workspaceId: "w1", provider: "claude", cwd: "/fixture", title: "Fixture" }, paseo: {}, signal: new AbortController().signal });
async function call(tool, input, ctx = context()) { return tool.execute(tool.input.parse(input), ctx); }
test("vitals includes agents after the first 200 and honors cancellation", async () => {
  const { definitions } = await tools({ "./collect.ts": { collectVitals: agents => ({ ids: agents.map(a => a.id) }) } });
  const ctx = context(), requests = [];
  ctx.paseo = { agents: { async list(options) { requests.push(options); return options.page.cursor ? { entries: [{ agent: { id: "last" } }], pageInfo: { nextCursor: null } } : { entries: Array.from({ length: 200 }, (_, i) => ({ agent: { id: String(i) } })), pageInfo: { nextCursor: "next" } }; } } };
  const result = (await call(definitions[0], {}, ctx)).structuredContent;
  assert.equal(result.ids.length, 201); assert.equal(result.ids.at(-1), "last"); assert.equal(requests[1].page.cursor, "next");
  const controller = new AbortController(); controller.abort(); ctx.signal = controller.signal;
  await assert.rejects(call(definitions[0], {}, ctx), /cancelled/);
});
