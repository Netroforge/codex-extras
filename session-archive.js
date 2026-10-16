"use strict";

const { readdir } = require("node:fs/promises");
const path = require("node:path");
const SESSION_ID_IN_FILENAME =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl(?:\.zst)?$/i;

// Read names only; archived transcripts may be compressed.
async function loadArchivedSessionIds(directory) {
  const ids = new Set();
  async function visit(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await visit(path.join(current, entry.name));
      } else if (entry.isFile()) {
        const id = entry.name.match(SESSION_ID_IN_FILENAME)?.[1];
        if (id) ids.add(id.toLowerCase());
      }
    }
  }
  await visit(directory);
  return ids;
}

// Watch the archive recursively, plus its parent non-recursively so creating
// or replacing the entire archive also refreshes the list. VS Code handles
// attaching the recursive watcher when a missing directory is created.
function watchArchivedSessions(directory, onChange, vscode) {
  let timer;
  const scheduleRefresh = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, 100);
  };
  const archiveWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(directory, "**"), false, true, false,
  );
  const parentWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(path.dirname(directory), "*"), false, true, false,
  );
  const onParentChange = (uri) => {
    if (path.relative(directory, uri.fsPath) === "") scheduleRefresh();
  };
  const subscriptions = [
    archiveWatcher.onDidCreate(scheduleRefresh),
    archiveWatcher.onDidDelete(scheduleRefresh),
    parentWatcher.onDidCreate(onParentChange),
    parentWatcher.onDidDelete(onParentChange),
  ];
  return {
    dispose() {
      clearTimeout(timer);
      for (const subscription of subscriptions) subscription.dispose();
      archiveWatcher.dispose();
      parentWatcher.dispose();
    },
  };
}

module.exports = { loadArchivedSessionIds, watchArchivedSessions };
