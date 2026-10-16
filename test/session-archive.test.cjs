"use strict";

const assert = require("node:assert/strict");
const { mkdtemp, mkdir, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { loadArchivedSessionIds, watchArchivedSessions } = require("../session-archive");
const { setTimeout: delay } = require("node:timers/promises");

test("reads nested plain and compressed archive filenames, ignoring unrelated files", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-extras-archive-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual([...await loadArchivedSessionIds(path.join(root, "missing"))], []);
  const nested = path.join(root, "2026", "10");
  await mkdir(nested, { recursive: true });
  const plain = "019f9c23-f7ec-72c3-8eb6-0018b17bea4f";
  const compressed = "019f9c28-a20f-70f3-9df9-518aaf67a20b";
  await writeFile(path.join(root, `rollout-${plain}.jsonl`), "");
  await writeFile(path.join(nested, `rollout-${compressed.toUpperCase()}.jsonl.zst`), "");
  await writeFile(path.join(root, `rollout-${plain}.jsonl.bak`), "");
  await writeFile(path.join(root, "unrelated.jsonl"), "");
  assert.deepEqual([...await loadArchivedSessionIds(root)].sort(), [plain, compressed].sort());
});

function createWatcherHarness(directory, onChange) {
  const watchers = [];
  const vscode = {
    RelativePattern: class RelativePattern {
      constructor(base, pattern) { Object.assign(this, { base, pattern }); }
    },
    workspace: {
      createFileSystemWatcher(pattern, ignoreCreate, ignoreChange, ignoreDelete) {
        const listeners = { create: new Set(), delete: new Set() };
        const subscribe = (type) => (listener) => {
          listeners[type].add(listener);
          return { dispose: () => listeners[type].delete(listener) };
        };
        const watcher = {
          pattern, ignoreCreate, ignoreChange, ignoreDelete, disposed: false,
          onDidCreate: subscribe("create"),
          onDidDelete: subscribe("delete"),
          emit(type, fsPath) { for (const listener of listeners[type]) listener({ fsPath }); },
          dispose() { this.disposed = true; },
        };
        watchers.push(watcher);
        return watcher;
      },
    },
  };
  return { watcher: watchArchivedSessions(directory, onChange, vscode), watchers };
}

test("uses scoped file events, coalesces bursts, and ignores unrelated parent changes", async (t) => {
  const directory = path.resolve(os.tmpdir(), "codex-home", "archived_sessions");
  let changes = 0;
  const { watcher, watchers: [archive, parent] } = createWatcherHarness(directory, () => changes++);
  t.after(() => watcher.dispose());
  assert.deepEqual([archive.pattern.base, archive.pattern.pattern], [directory, "**"]);
  assert.deepEqual([parent.pattern.base, parent.pattern.pattern], [path.dirname(directory), "*"]);
  assert.deepEqual([archive.ignoreCreate, archive.ignoreChange, archive.ignoreDelete], [false, true, false]);
  parent.emit("create", path.join(path.dirname(directory), "state.sqlite-wal"));
  await delay(150);
  assert.equal(changes, 0);
  archive.emit("create", path.join(directory, "2026", "session.jsonl.zst"));
  archive.emit("delete", path.join(directory, "2026", "session.jsonl"));
  await delay(150);
  assert.equal(changes, 1);
  await delay(150);
  assert.equal(changes, 1, "no periodic refresh when idle");
  parent.emit("delete", directory);
  await delay(150);
  assert.equal(changes, 2, "whole archive deletion refreshes the list");
  parent.emit("create", directory);
  await delay(150);
  assert.equal(changes, 3, "whole archive creation refreshes the list");
});

test("disposing watchers cancels a pending refresh and removes event listeners", async () => {
  let changes = 0;
  const directory = path.resolve(os.tmpdir(), "codex-home", "archived_sessions");
  const { watcher, watchers } = createWatcherHarness(directory, () => changes++);
  watchers[0].emit("create", directory);
  watcher.dispose();
  watchers[0].emit("delete", directory);
  watchers[1].emit("create", directory);
  await delay(150);
  assert.equal(changes, 0);
  assert.ok(watchers.every(({ disposed }) => disposed));
});
