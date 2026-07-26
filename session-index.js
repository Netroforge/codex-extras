"use strict";

const { open, readdir } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const SESSION_INDEX_FILENAME = "session_index.jsonl";
const SESSIONS_DIRECTORY_NAME = "sessions";
const SESSION_METADATA_PREFIX_BYTES = 64 * 1024;
const SESSION_ID_IN_FILENAME =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

function getCodexHome(environment = process.env, homeDirectory = os.homedir()) {
  const configuredHome = environment.CODEX_HOME?.trim();

  return configuredHome
    ? path.resolve(configuredHome)
    : path.join(homeDirectory, ".codex");
}

function getSessionIndexPath(codexHome = getCodexHome()) {
  return path.join(codexHome, SESSION_INDEX_FILENAME);
}

function getSessionsDirectory(codexHome = getCodexHome()) {
  return path.join(codexHome, SESSIONS_DIRECTORY_NAME);
}

function parseSessionIndex(contents) {
  const sessionsById = new Map();

  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    let value;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }

    if (
      typeof value?.id !== "string" ||
      !/^[a-zA-Z0-9_-]+$/.test(value.id)
    ) {
      continue;
    }

    const updatedAt =
      typeof value.updated_at === "string" &&
      Number.isFinite(Date.parse(value.updated_at))
        ? value.updated_at
        : undefined;
    const title =
      typeof value.thread_name === "string" && value.thread_name.trim()
        ? value.thread_name.trim()
        : "Untitled chat";
    const existing = sessionsById.get(value.id);

    if (
      !existing ||
      (updatedAt &&
        (!existing.updatedAt ||
          Date.parse(updatedAt) >= Date.parse(existing.updatedAt)))
    ) {
      sessionsById.set(value.id, {
        id: value.id,
        title,
        updatedAt,
      });
    }
  }

  return [...sessionsById.values()].sort((left, right) => {
    const timeDifference =
      (right.updatedAt ? Date.parse(right.updatedAt) : 0) -
      (left.updatedAt ? Date.parse(left.updatedAt) : 0);

    return timeDifference || left.title.localeCompare(right.title);
  });
}

async function readSessionWorkspace(filePath) {
  let handle;

  try {
    handle = await open(filePath, "r");
    const buffer = Buffer.alloc(SESSION_METADATA_PREFIX_BYTES);
    const { bytesRead } = await handle.read(
      buffer,
      0,
      buffer.length,
      0,
    );
    const prefix = buffer.toString("utf8", 0, bytesRead);
    const cwdMatch = prefix.match(/"cwd":("(?:\\.|[^"\\])*")/);

    return cwdMatch ? JSON.parse(cwdMatch[1]) : undefined;
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function findSessionFiles(directory, requestedSessionIds, results) {
  let entries;

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await findSessionFiles(entryPath, requestedSessionIds, results);
        return;
      }

      const sessionId = entry.name.match(SESSION_ID_IN_FILENAME)?.[1];
      if (
        sessionId &&
        requestedSessionIds.has(sessionId) &&
        !results.has(sessionId)
      ) {
        const workspacePath = await readSessionWorkspace(entryPath);
        if (workspacePath) {
          results.set(sessionId, workspacePath);
        }
      }
    }),
  );
}

async function loadSessionWorkspaces(sessionsDirectory, sessionIds) {
  const requestedSessionIds = new Set(sessionIds);
  const results = new Map();

  if (requestedSessionIds.size > 0) {
    await findSessionFiles(sessionsDirectory, requestedSessionIds, results);
  }

  return results;
}

function isPathInsideWorkspace(candidatePath, workspacePath) {
  if (!candidatePath || !workspacePath) {
    return false;
  }

  const relativePath = path.relative(
    path.resolve(workspacePath),
    path.resolve(candidatePath),
  );

  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

module.exports = {
  SESSION_INDEX_FILENAME,
  getCodexHome,
  getSessionIndexPath,
  getSessionsDirectory,
  isPathInsideWorkspace,
  loadSessionWorkspaces,
  parseSessionIndex,
};
