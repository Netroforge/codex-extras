"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { apply, transform, patches, guardBefore, guardAfter, pageAfter, version } = require("../scripts/local-onboarding-fix.cjs");

function decide(source, query, authMethod = "chatgpt") {
  return vm.runInNewContext(`${source}; FGi()`, {
    UC: () => query, hs: { NUX_2025_09_15: "completed" }, Lf: () => ({ authMethod }),
  });
}

test("regression: a paused or failed read must never reopen onboarding", () => {
  for (const query of [
    { data: undefined, isLoading: false, isSuccess: false, isPending: true, fetchStatus: "paused" },
    { data: undefined, isLoading: false, isSuccess: false, isError: true },
  ]) {
    assert.equal(decide(guardBefore, query), "2025-09-15-full-chatgpt-auth");
    assert.equal(decide(guardAfter, query), undefined);
  }
});

test("successful reads preserve genuine first use and completed onboarding", () => {
  assert.equal(decide(guardAfter, { data: true, isSuccess: true }), "none");
  assert.equal(decide(guardAfter, { data: false, isSuccess: true }), "2025-09-15-full-chatgpt-auth");
  assert.equal(decide(guardAfter, { data: false, isSuccess: true }, "apikey"), "2025-09-15-apikey-auth");
  assert.equal(decide(guardAfter, { data: false, isSuccess: true }, null), "none");
  assert.equal(decide(guardAfter, { data: undefined, isSuccess: false, isLoading: true }), undefined);
});

test("an already open welcome page exits after a successful completion read", () => {
  const effect = pageAfter.slice(pageAfter.indexOf("X.useEffect"), pageAfter.indexOf(";e[0]"));
  for (const state of [undefined, "2025-09-15-full-chatgpt-auth", "none"]) {
    const routes = [];
    vm.runInNewContext(effect, { X: { useEffect: (fn) => fn() }, n: state, s: (route) => routes.push(route) });
    assert.deepEqual(routes, state === "none" ? ["/"] : []);
  }
});

test("local deployment is version checked, idempotent, backed up and reversible", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-nux-fix-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "webview", "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ publisher: "openai", name: "chatgpt", version }));
  for (const patch of patches) fs.writeFileSync(path.join(dir, "webview", "assets", patch.file), patch.before);
  apply(dir);
  apply(dir);
  for (const patch of patches) assert.equal(fs.readFileSync(path.join(dir, "webview", "assets", patch.file), "utf8"), patch.after);
  apply(dir, true);
  for (const patch of patches) assert.equal(fs.readFileSync(path.join(dir, "webview", "assets", patch.file), "utf8"), patch.before);
  fs.writeFileSync(path.join(dir, "webview", "assets", patches[1].file), "unexpected build");
  assert.throws(() => apply(dir), /Unrecognized/);
  assert.equal(fs.readFileSync(path.join(dir, "webview", "assets", patches[0].file), "utf8"), patches[0].before);
  assert.throws(() => transform("unknown", patches[0].before, patches[0].after), /Unrecognized/);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ publisher: "openai", name: "chatgpt", version: "other" }));
  assert.throws(() => apply(dir), /supports only/);
});
