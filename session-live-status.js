"use strict";

const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { pendingQuestionIds, questionPatchMayChange } = require("./session-questions");

// Experimental: this is Codex's internal cross-window protocol, not its public
// app-server API. Reject unknown stream versions rather than infer activity.
const STREAM_VERSION = 11;
const MAX_FRAME_BYTES = 32 * 1024 * 1024;

function runtimeStatus(value) {
  if (value?.type === "active") {
    return value.activeFlags?.length ? "waiting" : "working";
  }
  if (value?.type === "idle") return "idle";
  if (value?.type === "systemError") return "failed";
  return "unconfirmed";
}

class LiveSessionStatus {
  constructor({ codexHome, onChange, connect = net.connect }) {
    this.onChange = onChange;
    this.connect = connect;
    this.endpoint = process.platform === "win32"
      ? "\\\\.\\pipe\\codex-ipc"
      : path.join(codexHome, "ipc", "ipc.sock");
    this.legacyEndpoint = process.platform === "win32" ? undefined
      : path.join(os.tmpdir(), "codex-ipc", process.getuid?.() ? `ipc-${process.getuid()}.sock` : "ipc.sock");
    this.threads = new Set();
    this.states = new Map();
    this.snapshotRequests = new Map();
    this.buffer = Buffer.alloc(0);
    this.disposed = false;
    this.start();
  }

  start(useLegacy = false) {
    if (this.disposed) return;
    this.clientId = undefined;
    this.buffer = Buffer.alloc(0);
    const socket = this.connect(useLegacy ? this.legacyEndpoint : this.endpoint);
    this.socket = socket;
    socket.on("connect", () => {
      this.initializeId = randomUUID();
      this.send({ type: "request", method: "initialize", version: 0,
        requestId: this.initializeId, sourceClientId: "initializing-client",
        params: { clientType: "codex-extras" } });
    });
    socket.on("data", (data) => {
      try {
        this.buffer = Buffer.concat([this.buffer, data]);
        while (this.buffer.length >= 4) {
          const length = this.buffer.readUInt32LE(0);
          if (!length || length > MAX_FRAME_BYTES) throw new Error("Invalid IPC frame");
          if (this.buffer.length < length + 4) break;
          const message = JSON.parse(this.buffer.subarray(4, length + 4));
          this.buffer = this.buffer.length === length + 4
            ? Buffer.alloc(0) : Buffer.from(this.buffer.subarray(length + 4));
          this.receive(message);
        }
      } catch {
        socket.destroy();
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.clientId = undefined;
      this.buffer = Buffer.alloc(0);
      this.states.clear();
      this.clearSnapshotRequests();
      this.onChange();
      if (!this.disposed) {
        this.retry = setTimeout(() => this.start(!useLegacy && !!this.legacyEndpoint), 2000);
        this.retry.unref();
      }
    });
  }

  send(message) {
    if (!this.socket?.writable) return;
    const body = Buffer.from(JSON.stringify(message));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    this.socket.write(Buffer.concat([header, body]));
  }

  follow(id, following) {
    if (!this.clientId) return;
    this.send({ type: "broadcast", method: "thread-stream-following-changed",
      version: 1, sourceClientId: this.clientId,
      params: { hostId: "local", conversationId: id, following } });
  }

  setThreads(ids) {
    const next = new Set(ids);
    for (const id of this.threads) {
      if (!next.has(id)) {
        this.follow(id, false);
        this.states.delete(id);
        clearTimeout(this.snapshotRequests.get(id));
        this.snapshotRequests.delete(id);
      }
    }
    for (const id of next) if (!this.threads.has(id)) this.follow(id, true);
    this.threads = next;
  }

  requestSnapshot(id) {
    if (this.snapshotRequests.has(id)) return;
    const timer = setTimeout(() => {
      this.snapshotRequests.delete(id);
      if (this.threads.has(id)) this.follow(id, true);
    }, 100);
    timer.unref();
    this.snapshotRequests.set(id, timer);
  }

  clearSnapshotRequests() {
    for (const timer of this.snapshotRequests.values()) clearTimeout(timer);
    this.snapshotRequests.clear();
  }

  receive(message) {
    if (message.type === "response" && message.requestId === this.initializeId) {
      if (message.resultType !== "success" || typeof message.result?.clientId !== "string") {
        this.socket.destroy();
        return;
      }
      this.clientId = message.result.clientId;
      for (const id of this.threads) this.follow(id, true);
      return;
    }
    // This client observes state only. Never accept ownership or execution requests.
    if (message.type === "client-discovery-request") {
      this.send({ type: "client-discovery-response", requestId: message.requestId,
        response: { canHandle: false } });
      return;
    }
    if (message.type !== "broadcast") return;
    if (message.targetClientIds && !message.targetClientIds.includes(this.clientId)) return;
    if (message.method === "client-status-changed") {
      if (message.params?.status === "disconnected") {
        for (const [id, state] of this.states) {
          if (state.owner === message.params.clientId) {
            this.states.delete(id);
            clearTimeout(this.snapshotRequests.get(id));
            this.snapshotRequests.delete(id);
          }
        }
        this.onChange();
      }
      return;
    }
    // An existing owner asks followers to announce themselves after reconnecting.
    if (message.method === "thread-stream-following-status-requested") {
      if (message.params?.hostId === "local" && this.threads.has(message.params.conversationId)) {
        this.follow(message.params.conversationId, true);
      }
      return;
    }
    if (message.method !== "thread-stream-state-changed") return;
    const { conversationId: id, hostId, change } = message.params ?? {};
    if (hostId !== "local" || !this.threads.has(id)) return;
    const previous = this.states.get(id);
    if (message.version !== STREAM_VERSION) {
      this.states.delete(id);
      this.onChange();
      return;
    }
    let value;
    let pendingQuestions = previous?.pendingQuestions ?? new Set();
    if (change?.type === "snapshot") {
      // Retain runtime status and unresolved IDs, never question/answer text.
      value = change.conversationState?.threadRuntimeStatus;
      pendingQuestions = pendingQuestionIds(change.conversationState);
      clearTimeout(this.snapshotRequests.get(id));
      this.snapshotRequests.delete(id);
    } else if (change?.type === "patches") {
      if (!previous || previous.owner !== message.sourceClientId ||
          previous.revision !== change.baseRevision) {
        this.states.delete(id);
        this.follow(id, true);
        this.onChange();
        return;
      }
      value = previous.runtime;
      for (const patch of change.patches ?? []) {
        const segments = Array.isArray(patch.path) ? patch.path
          : typeof patch.path === "string" ? patch.path.split("/").slice(1) : [];
        if (questionPatchMayChange(patch, segments)) this.requestSnapshot(id);
        if (!segments.length) {
          value = patch.value?.threadRuntimeStatus;
        } else if (segments[0] === "threadRuntimeStatus") {
          if (segments.length === 1) value = patch.op === "remove" ? undefined : patch.value;
          else if (segments.length === 2 && segments[1] === "type") value = { ...value, type: patch.value };
          else if (segments[1] === "activeFlags") {
            // Request a fresh snapshot for nested flag updates; no history patches needed.
            value = undefined;
            this.follow(id, true);
          }
        }
      }
    } else {
      this.states.delete(id);
      this.onChange();
      return;
    }
    const baseStatus = runtimeStatus(value);
    const status = baseStatus === "waiting" ? "waiting"
      : pendingQuestions.size ? "question" : baseStatus;
    this.states.set(id, {
      owner: message.sourceClientId, revision: change.revision, runtime: value, status, pendingQuestions,
    });
    if (status !== previous?.status) this.onChange();
  }

  get(id) {
    return this.clientId ? this.states.get(id)?.status : undefined;
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.retry);
    this.clearSnapshotRequests();
    for (const id of this.threads) this.follow(id, false);
    this.states.clear();
    this.socket?.destroy();
  }
}

module.exports = { LiveSessionStatus, runtimeStatus };
