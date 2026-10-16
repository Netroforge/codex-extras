"use strict";

const { open } = require("node:fs/promises");

const STATUS_TAIL_BYTES = 256 * 1024;
const STATUS_BY_EVENT = new Map([
  ["task_started", "working"],
  ["task_complete", "completed"],
  ["turn_aborted", "interrupted"],
  ["task_failed", "failed"],
]);

// Only lifecycle events count. An assistant message or a quiet log does not
// mean a turn has ended. Ignore incomplete JSONL records while Codex writes.
function parseSessionStatus(contents, startOffset = 0, previous) {
  let result = previous;
  let offset = startOffset;
  const lines = contents.split("\n");
  for (const line of lines.slice(0, -1)) {
    const eventOffset = offset;
    offset += Buffer.byteLength(line) + 1;
    if (previous && eventOffset <= previous.offset) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type !== "event_msg") continue;
    const status = STATUS_BY_EVENT.get(event.payload?.type);
    if (!status) continue;
    const turnId = event.payload.turn_id;
    if (status !== "working" && result?.status === "working" &&
        turnId && result.turnId && turnId !== result.turnId) continue;
    result = { status, turnId, offset: eventOffset };
  }
  return result;
}

class SessionStatusReader {
  constructor() {
    this.cache = new Map();
  }

  displayStatus(entry) {
    // Logs provide history, not liveness. Only IPC may produce a spinner.
    return entry.event?.status === "working" ? "unconfirmed" : entry.event?.status;
  }

  async read(filePath) {
    let handle;
    try {
      handle = await open(filePath, "r");
      const stat = await handle.stat();
      const cached = this.cache.get(filePath);
      if (cached?.size === stat.size && cached.mtimeMs === stat.mtimeMs &&
          cached.ino === stat.ino) return this.displayStatus(cached);
      const growing = cached && cached.ino === stat.ino && stat.size > cached.size;
      const previous = growing ? cached.event : undefined;
      const start = Math.max(0, stat.size - STATUS_TAIL_BYTES);
      const buffer = Buffer.alloc(stat.size - start);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      // A tail may begin in a JSON string. Skip its first partial record.
      const firstLineEnd = start > 0 ? buffer.indexOf(10) : -1;
      const skip = start > 0 ? (firstLineEnd < 0 ? bytesRead : firstLineEnd + 1) : 0;
      const event = parseSessionStatus(
        buffer.toString("utf8", skip, bytesRead), start + skip, previous,
      );
      const entry = { size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino, event };
      this.cache.set(filePath, entry);
      return this.displayStatus(entry);
    } catch {
      this.cache.delete(filePath);
      return undefined;
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  retain(filePaths) {
    const retained = new Set(filePaths);
    for (const filePath of this.cache.keys()) {
      if (!retained.has(filePath)) {
        this.cache.delete(filePath);
      }
    }
  }

  resultKey(filePath) {
    const entry = this.cache.get(filePath);
    if (entry?.event?.status !== "completed") return undefined;
    return JSON.stringify([filePath, entry.event.turnId ?? entry.event.offset]);
  }

  clear() {
    this.cache.clear();
  }
}

function watchSessionStatus(directory, onChange, vscode) {
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(directory, "**/*.jsonl"),
  );
  let timer;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, 100);
  };
  const subscriptions = [
    watcher.onDidCreate(refresh),
    watcher.onDidChange(refresh),
    watcher.onDidDelete(refresh),
  ];
  return {
    dispose() {
      clearTimeout(timer);
      for (const subscription of subscriptions) subscription.dispose();
      watcher.dispose();
    },
  };
}

module.exports = { parseSessionStatus, SessionStatusReader, watchSessionStatus };
