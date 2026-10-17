"use strict";

const assert = require("node:assert/strict");
const { mkdtemp, writeFile, appendFile, rm } = require("node:fs/promises");
const { setTimeout: delay } = require("node:timers/promises");
const path = require("node:path");
const os = require("node:os");
const test = require("node:test");
const { SessionResultReader, parseResultTime, watchSessionResults } = require("../session-results");
const { EventEmitter } = require("node:events");
const record = (type, timestamp = "2026-01-01T00:00:00Z") => JSON.stringify({ type: "event_msg", timestamp, payload: { type } }) + "\n";

test("only valid explicit completion records advance delivery time", () => {
  const time = Date.parse("2026-01-01T00:00:00Z");
  assert.equal(parseResultTime(record("task_complete")), time);
  assert.equal(parseResultTime(record("task_started") + record("turn_aborted") + record("task_failed")), 0);
  assert.equal(parseResultTime(record("task_complete", "invalid")), 0);
  assert.equal(parseResultTime(record("task_complete").trimEnd()), 0);
  assert.equal(parseResultTime("invalid JSON\n"), 0);
  assert.equal(parseResultTime(record("task_complete"), time + 1), time + 1);
});

test("bounded cached reads retain a result through new work and streaming, resetting on deletion or truncation", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-extras-results-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "session.jsonl"), reader = new SessionResultReader();
  const time = Date.parse("2026-01-01T00:00:00Z");
  assert.equal(await reader.read(file), 0);
  await writeFile(file, record("task_complete"));
  assert.equal(await reader.read(file), time);
  assert.equal(await reader.read(file), time);
  await appendFile(file, record("task_started") + JSON.stringify({ type: "response_item", text: "a".repeat(300 * 1024) }) + "\n");
  assert.equal(await reader.read(file), time);
  assert.equal(await new SessionResultReader().read(file), 0, "cold reads must not exceed the tail budget");
  await appendFile(file, record("task_complete", "2026-02-01T00:00:00Z"));
  assert.equal(await reader.read(file), Date.parse("2026-02-01T00:00:00Z"));
  reader.retain([]);
  assert.equal(reader.cache.size, 0);
  await writeFile(file, "{}\n");
  assert.equal(await reader.read(file), 0);
  await rm(file);
  assert.equal(await reader.read(file), 0);
  assert.equal(reader.cache.size, 0);
});

test("result watchers coalesce file events and cancel refresh after disposal", async () => {
  const emitter = new EventEmitter();
  const event = (name) => (listener) => { emitter.on(name, listener); return { dispose: () => emitter.off(name, listener) }; };
  let changes = 0, closed = false;
  const watcher = watchSessionResults("/sessions", () => changes++, {
    RelativePattern: class { constructor(base, pattern) { assert.equal(base, "/sessions"); assert.equal(pattern, "**/*.jsonl"); } },
    workspace: { createFileSystemWatcher: () => ({ onDidCreate: event("create"), onDidChange: event("change"), onDidDelete: event("delete"), dispose() { closed = true; } }) },
  });
  emitter.emit("create"); emitter.emit("change"); emitter.emit("delete");
  await delay(150);
  assert.equal(changes, 1);
  emitter.emit("change"); watcher.dispose();
  await delay(150);
  assert.equal(changes, 1);
  assert.ok(closed);
});
