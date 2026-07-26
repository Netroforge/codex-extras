"use strict";

const assert = require("node:assert/strict");
const { mkdtemp, mkdir, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  getCodexHome,
  getSessionIndexPath,
  getSessionsDirectory,
  isPathInsideWorkspace,
  loadSessionWorkspaces,
  parseSessionIndex,
} = require("../session-index");

test("uses CODEX_HOME when it is configured", () => {
  assert.equal(
    getCodexHome({ CODEX_HOME: "/tmp/custom-codex" }, "/home/person"),
    path.resolve("/tmp/custom-codex"),
  );
  assert.equal(
    getSessionIndexPath("/tmp/custom-codex"),
    path.join("/tmp/custom-codex", "session_index.jsonl"),
  );
  assert.equal(
    getSessionsDirectory("/tmp/custom-codex"),
    path.join("/tmp/custom-codex", "sessions"),
  );
});

test("falls back to the default Codex home", () => {
  assert.equal(
    getCodexHome({}, "/home/person"),
    path.join("/home/person", ".codex"),
  );
});

test("parses, deduplicates, and sorts Codex sessions", () => {
  const sessions = parseSessionIndex(
    [
      JSON.stringify({
        id: "older",
        thread_name: "Older title",
        updated_at: "2026-07-20T10:00:00Z",
      }),
      "not JSON",
      JSON.stringify({
        id: "newer",
        thread_name: "  Newer title  ",
        updated_at: "2026-07-21T10:00:00Z",
      }),
      JSON.stringify({
        id: "older",
        thread_name: "Updated older title",
        updated_at: "2026-07-22T10:00:00Z",
      }),
      JSON.stringify({
        id: "../../invalid",
        thread_name: "Invalid ID",
      }),
    ].join("\n"),
  );

  assert.deepEqual(sessions, [
    {
      id: "older",
      title: "Updated older title",
      updatedAt: "2026-07-22T10:00:00Z",
    },
    {
      id: "newer",
      title: "Newer title",
      updatedAt: "2026-07-21T10:00:00Z",
    },
  ]);
});

test("uses a readable fallback for missing titles and dates", () => {
  assert.deepEqual(
    parseSessionIndex(
      `${JSON.stringify({ id: "session_one", thread_name: " " })}\n`,
    ),
    [
      {
        id: "session_one",
        title: "Untitled chat",
        updatedAt: undefined,
      },
    ],
  );
});

test("recognizes chats within the current workspace", () => {
  assert.equal(
    isPathInsideWorkspace(
      "/home/person/project/packages/app",
      "/home/person/project",
    ),
    true,
  );
  assert.equal(
    isPathInsideWorkspace(
      "/home/person/project-other",
      "/home/person/project",
    ),
    false,
  );
});

test("loads only the workspace metadata prefix for requested sessions", async (t) => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "codex-extras-test-"),
  );
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));

  const sessionsDirectory = path.join(
    temporaryDirectory,
    "sessions",
    "2026",
    "07",
    "26",
  );
  await mkdir(sessionsDirectory, { recursive: true });

  const requestedId = "019f9c23-f7ec-72c3-8eb6-0018b17bea4f";
  const ignoredId = "019f9c28-a20f-70f3-9df9-518aaf67a20b";
  await writeFile(
    path.join(
      sessionsDirectory,
      `rollout-2026-07-26T04-57-10-${requestedId}.jsonl`,
    ),
    `${JSON.stringify({
      type: "session_meta",
      payload: {
        id: requestedId,
        cwd: "/home/person/current-project",
      },
    })}\n{"large":"transcript body is not needed"}\n`,
  );
  await writeFile(
    path.join(
      sessionsDirectory,
      `rollout-2026-07-26T05-00-00-${ignoredId}.jsonl`,
    ),
    `${JSON.stringify({
      type: "session_meta",
      payload: {
        id: ignoredId,
        cwd: "/home/person/other-project",
      },
    })}\n`,
  );

  const workspaces = await loadSessionWorkspaces(
    path.join(temporaryDirectory, "sessions"),
    [requestedId],
  );

  assert.deepEqual(
    [...workspaces],
    [[requestedId, "/home/person/current-project"]],
  );
});
