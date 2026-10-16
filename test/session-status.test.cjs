"use strict";

const assert = require("node:assert/strict");
const { appendFile, mkdtemp, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { parseSessionStatus, SessionStatusReader } = require("../session-status");

const event = (type, turnId = "turn-1") =>
  JSON.stringify({ timestamp: new Date().toISOString(), type: "event_msg", payload: { type, turn_id: turnId } }) + "\n";

test("tracks explicit starts, completion, interruption, and failure across turns", () => {
  assert.equal(parseSessionStatus(event("task_started")).status, "working");
  assert.equal(parseSessionStatus(event("task_started") + event("task_complete")).status, "completed");
  assert.equal(parseSessionStatus(event("turn_aborted")).status, "interrupted");
  assert.equal(parseSessionStatus(event("task_failed")).status, "failed");
  assert.equal(parseSessionStatus(event("task_complete") + event("task_started", "turn-2")).status, "working");
  assert.equal(parseSessionStatus(event("task_started", "new") + event("task_complete", "old")).status, "working");
});

test("does not infer completion from messages, tool output, or partial JSONL", () => {
  const message = JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant" } }) + "\n";
  assert.equal(parseSessionStatus(message), undefined);
  assert.equal(parseSessionStatus(event("task_started") + message).status, "working");
  assert.equal(parseSessionStatus("not JSON\n" + event("unknown")), undefined);
  assert.equal(parseSessionStatus(event("task_started") + event("task_complete").trimEnd()).status, "working");
});

test("reads bounded tails, retains status while growing, resets on truncation and deletion", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-extras-status-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, "session.jsonl");
  const reader = new SessionStatusReader();
  t.after(() => reader.clear());
  assert.equal(await reader.read(filePath), undefined);
  await writeFile(filePath, event("task_started"));
  assert.equal(await reader.read(filePath), "unconfirmed");
  assert.equal(await reader.read(filePath), "unconfirmed");
  await appendFile(filePath, JSON.stringify({ type: "response_item", text: "x".repeat(300 * 1024) }) + "\n");
  assert.equal(await reader.read(filePath), "unconfirmed", "cached start survives large appended records");
  const freshReader = new SessionStatusReader();
  t.after(() => freshReader.clear());
  assert.equal(await freshReader.read(filePath), undefined, "does not read beyond the tail budget");
  await appendFile(filePath, event("task_complete"));
  assert.equal(await reader.read(filePath), "completed");
  assert.equal(await freshReader.read(filePath), "completed");
  await writeFile(filePath, "{}\n");
  assert.equal(await reader.read(filePath), undefined, "old state cannot survive truncation");
  await rm(filePath);
  assert.equal(await reader.read(filePath), undefined);
  assert.equal(reader.cache.size, 0);
});

test("handles partial writes and UTF-8 without interpreting a partial first record", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-extras-status-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, "session.jsonl");
  const reader = new SessionStatusReader();
  t.after(() => reader.clear());
  await writeFile(filePath, event("task_started") + event("task_complete").trimEnd());
  assert.equal(await reader.read(filePath), "unconfirmed");
  await appendFile(filePath, "\n");
  assert.equal(await reader.read(filePath), "completed");
  await writeFile(filePath, JSON.stringify({ text: "ą".repeat(300 * 1024) }) + "\n" + event("turn_aborted"));
  assert.equal(await new SessionStatusReader().read(filePath), "interrupted");
  reader.retain([]);
  assert.equal(reader.cache.size, 0);
});

test("logs alone never show a spinner, even with fresh token events", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-extras-status-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, "session.jsonl");
  const reader = new SessionStatusReader();
  await writeFile(filePath, event("task_started"));
  assert.equal(await reader.read(filePath), "unconfirmed");
  await appendFile(filePath, event("token_count"));
  assert.equal(await reader.read(filePath), "unconfirmed");
  await appendFile(filePath, event("task_complete"));
  assert.equal(await reader.read(filePath), "completed");
});
