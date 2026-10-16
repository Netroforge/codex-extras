"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { LiveSessionStatus, runtimeStatus } = require("../session-live-status");

function frame(message) {
  const body = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}

function harness(t) {
  class Socket extends EventEmitter {
    writable = true;
    writes = [];
    write(buffer) { this.writes.push(JSON.parse(buffer.subarray(4))); }
    destroy() {
      if (!this.writable) return;
      this.writable = false;
      this.emit("close");
    }
  }
  const socket = new Socket();
  let changes = 0;
  const live = new LiveSessionStatus({
    codexHome: "/tmp/codex-extras-test-home",
    onChange: () => changes++,
    connect: () => socket,
  });
  t.after(() => live.dispose());
  live.setThreads(["thread-one"]);
  socket.emit("connect");
  const initialize = socket.writes[0];
  socket.emit("data", frame({ type: "response", requestId: initialize.requestId,
    method: "initialize", resultType: "success", result: { clientId: "observer" } }));
  const snapshot = (runtime, revision = 1, extra = {}) => ({
    type: "broadcast", method: "thread-stream-state-changed", version: 11,
    sourceClientId: "owner", params: {
      hostId: "local", conversationId: "thread-one",
      change: { type: "snapshot", revision, conversationState: { threadRuntimeStatus: runtime } },
    }, ...extra,
  });
  return { live, socket, snapshot, changes: () => changes };
}

test("maps runtime activity, approval waits, idle, errors, and unknown states", () => {
  assert.equal(runtimeStatus({ type: "active", activeFlags: [] }), "working");
  assert.equal(runtimeStatus({ type: "active", activeFlags: ["waitingOnApproval"] }), "waiting");
  assert.equal(runtimeStatus({ type: "idle" }), "idle");
  assert.equal(runtimeStatus({ type: "systemError" }), "failed");
  assert.equal(runtimeStatus({ type: "notLoaded" }), "unconfirmed");
  assert.equal(runtimeStatus({ type: "future-state" }), "unconfirmed");
});

test("initializes an observer and decodes split and combined IPC frames", (t) => {
  const { live, socket, snapshot } = harness(t);
  assert.equal(socket.writes[0].method, "initialize");
  assert.deepEqual(socket.writes[1].params, {
    hostId: "local", conversationId: "thread-one", following: true,
  });
  const message = frame(snapshot({ type: "active", activeFlags: [] }));
  socket.emit("data", message.subarray(0, 2));
  assert.equal(live.get("thread-one"), undefined);
  socket.emit("data", message.subarray(2));
  assert.equal(live.get("thread-one"), "working");
  socket.emit("data", Buffer.concat([
    frame(snapshot({ type: "idle" }, 2)),
    frame(snapshot({ type: "systemError" }, 3)),
  ]));
  assert.equal(live.get("thread-one"), "failed");
  socket.emit("data", frame({ type: "client-discovery-request", requestId: "discovery" }));
  assert.deepEqual(socket.writes.at(-1).response, { canHandle: false });
});

test("owner disconnection and IPC loss immediately invalidate the spinner", (t) => {
  const { live, socket, snapshot } = harness(t);
  socket.emit("data", frame(snapshot({ type: "active", activeFlags: [] })));
  socket.emit("data", frame({ type: "broadcast", method: "client-status-changed",
    params: { clientId: "owner", status: "disconnected" } }));
  assert.equal(live.get("thread-one"), undefined);
  socket.emit("data", frame(snapshot({ type: "active", activeFlags: [] })));
  assert.equal(live.get("thread-one"), "working");
  socket.destroy();
  assert.equal(live.get("thread-one"), undefined);
});

test("applies runtime patches and invalidates gaps or unsupported protocol versions", (t) => {
  const { live, socket, snapshot } = harness(t);
  socket.emit("data", frame(snapshot({ type: "active", activeFlags: [] })));
  const patch = (baseRevision, revision, patches) => ({
    type: "broadcast", method: "thread-stream-state-changed", version: 11,
    sourceClientId: "owner", params: { hostId: "local", conversationId: "thread-one",
      change: { type: "patches", baseRevision, revision, patches } },
  });
  socket.emit("data", frame(patch(1, 2, [{ op: "replace", path: ["threadRuntimeStatus"], value: { type: "idle" } }])));
  assert.equal(live.get("thread-one"), "idle");
  socket.emit("data", frame(patch(2, 3, [{ op: "replace", path: "/threadRuntimeStatus", value: { type: "active", activeFlags: [] } }])));
  assert.equal(live.get("thread-one"), "working");
  socket.emit("data", frame(patch(4, 5, [])));
  assert.equal(live.get("thread-one"), undefined);
  assert.equal(socket.writes.at(-1).params.following, true, "revision gaps request a fresh snapshot");
  socket.emit("data", frame(snapshot({ type: "active", activeFlags: [] })));
  socket.emit("data", frame(snapshot({ type: "active", activeFlags: [] }, 2, { version: 999 })));
  assert.equal(live.get("thread-one"), undefined, "unsupported versions cannot retain a spinner");
});

test("ignores messages for other clients, threads, and hosts; retains no transcript", (t) => {
  const { live, socket, snapshot } = harness(t);
  socket.emit("data", frame(snapshot({ type: "active" }, 1, { targetClientIds: ["someone-else"] })));
  assert.equal(live.get("thread-one"), undefined);
  const other = snapshot({ type: "active" });
  other.params.hostId = "remote";
  socket.emit("data", frame(other));
  assert.equal(live.get("thread-one"), undefined);
  const valid = snapshot({ type: "active", activeFlags: [] });
  valid.params.change.conversationState.turns = [{ text: "private transcript" }];
  socket.emit("data", frame(valid));
  assert.equal(JSON.stringify([...live.states]).includes("private transcript"), false);
  live.setThreads([]);
  assert.equal(live.states.size, 0);
  assert.equal(socket.writes.at(-1).params.following, false);
});

test("rejects oversized frames and closes the connection on dispose", (t) => {
  const { live, socket, snapshot } = harness(t);
  socket.emit("data", frame(snapshot({ type: "active", activeFlags: [] })));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(33 * 1024 * 1024);
  socket.emit("data", header);
  assert.equal(socket.writable, false);
  assert.equal(live.get("thread-one"), undefined);
  live.dispose();
  assert.equal(live.states.size, 0);
});
