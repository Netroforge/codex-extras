"use strict";

const { open } = require("node:fs/promises");
const RESULT_TAIL_BYTES = 256 * 1024;

function parseResultTime(contents, previous = 0) {
  let result = previous;
  for (const line of contents.split("\n").slice(0, -1)) {
    try {
      const event = JSON.parse(line);
      if (event.type !== "event_msg" || event.payload?.type !== "task_complete") continue;
      const time = typeof event.timestamp === "string" ? Date.parse(event.timestamp) : NaN;
      if (Number.isFinite(time) && time > result) result = time;
    } catch {
      // Ignore partial or malformed records; never infer completion from text.
    }
  }
  return result;
}

class SessionResultReader {
  constructor() { this.cache = new Map(); }

  async read(filePath) {
    let handle;
    try {
      handle = await open(filePath, "r");
      const stat = await handle.stat();
      const previous = this.cache.get(filePath);
      if (previous?.size === stat.size && previous.mtimeMs === stat.mtimeMs && previous.ino === stat.ino) return previous.time;
      const growing = previous && previous.ino === stat.ino && stat.size > previous.size;
      const start = Math.max(0, stat.size - RESULT_TAIL_BYTES);
      const buffer = Buffer.alloc(stat.size - start);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      const firstLineEnd = start > 0 ? buffer.indexOf(10) : -1;
      const skip = start > 0 ? (firstLineEnd < 0 ? bytesRead : firstLineEnd + 1) : 0;
      const time = parseResultTime(buffer.toString("utf8", skip, bytesRead), growing ? previous.time : 0);
      this.cache.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino, time });
      return time;
    } catch {
      this.cache.delete(filePath);
      return 0;
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  retain(filePaths) {
    const retained = new Set(filePaths);
    for (const filePath of this.cache.keys()) if (!retained.has(filePath)) this.cache.delete(filePath);
  }

  clear() { this.cache.clear(); }
}

function watchSessionResults(directory, onChange, vscode) {
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(directory, "**/*.jsonl"));
  let timer;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, 100);
  };
  const subscriptions = [watcher.onDidCreate(refresh), watcher.onDidChange(refresh), watcher.onDidDelete(refresh)];
  return { dispose() {
    clearTimeout(timer);
    for (const subscription of subscriptions) subscription.dispose();
    watcher.dispose();
  } };
}

module.exports = { SessionResultReader, parseResultTime, watchSessionResults };
