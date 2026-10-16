"use strict";

const assert = require("node:assert/strict");
const { mkdtemp, mkdir, rm, writeFile } = require("node:fs/promises");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { setTimeout: delay } = require("node:timers/promises");

const extensionPath = path.resolve(__dirname, "..", "extension.js");
const originalLoad = Module._load;

test("hides an already archived session that remains in the index", async (t) => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-extras-archived-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  const id = "019f9c23-f7ec-72c3-8eb6-0018b17bea4f";
  await mkdir(path.join(codexHome, "archived_sessions"));
  await writeFile(path.join(codexHome, "archived_sessions", `rollout-${id}.jsonl`), "");
  await writeFile(path.join(codexHome, "session_index.jsonl"), JSON.stringify({ id }));
  const harness = createHarness(t, [], { codexHome, workspaceFolders: [] });
  assert.deepEqual(await harness.treeViews[0].options.treeDataProvider.getChildren(), []);
});

test("hides archived chats and refreshes on archive and restore without index changes", async (t) => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-extras-archive-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  const id = "019f9c23-f7ec-72c3-8eb6-0018b17bea4f";
  const index = JSON.stringify({ id, thread_name: "Archived regression" });
  await writeFile(path.join(codexHome, "session_index.jsonl"), index);
  const harness = createHarness(t, [], { codexHome, workspaceFolders: [] });
  const provider = harness.treeViews[0].options.treeDataProvider;
  let changes = 0;
  provider.onDidChangeTreeData(() => changes++);
  const waitForChange = async (previous) => {
    const deadline = Date.now() + 5000;
    while (changes === previous && Date.now() < deadline) await delay(25);
    assert.ok(changes > previous, "archive changes must refresh the panel");
  };
  assert.equal((await provider.getChildren())[0].sessions.length, 1);
  const archive = path.join(codexHome, "archived_sessions", "2026", "10");
  await mkdir(archive, { recursive: true });
  let previous = changes;
  const archivedFile = path.join(archive, `rollout-${id}.jsonl.zst`);
  await writeFile(archivedFile, "compressed contents need not be read");
  await waitForChange(previous);
  assert.deepEqual(await provider.getChildren(), []);
  previous = changes;
  await rm(archivedFile);
  await waitForChange(previous);
  assert.equal((await provider.getChildren())[0].sessions[0].id, id);
  const { readFile } = require("node:fs/promises");
  assert.equal(await readFile(path.join(codexHome, "session_index.jsonl"), "utf8"), index);
});

function loadExtension(vscode) {
  delete require.cache[extensionPath];
  Module._load = function load(request, parent, isMain) {
    if (request === "vscode") {
      return vscode;
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(extensionPath);
  } finally {
    Module._load = originalLoad;
  }
}

function createHarness(t, tabs = [], options = {}) {
  const calls = [];
  const commandHandlers = new Map();
  const disposable = { dispose() {} };
  const treeViews = [];

  class EventEmitter {
    constructor() {
      this.listeners = new Set();
      this.event = (listener) => {
        this.listeners.add(listener);
        return {
          dispose: () => this.listeners.delete(listener),
        };
      };
    }

    fire(value) {
      for (const listener of this.listeners) {
        listener(value);
      }
    }

    dispose() {
      this.listeners.clear();
    }
  }

  class TreeItem {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }

  const vscode = {
    RelativePattern: class RelativePattern {
      constructor(base, pattern) {
        this.base = base;
        this.pattern = pattern;
      }
    },
    commands: {
      registerCommand(command, handler) {
        commandHandlers.set(command, handler);
        return disposable;
      },
      async executeCommand(...args) {
        calls.push(args);
      },
    },
    Uri: {
      from(value) {
        return { ...value };
      },
    },
    ViewColumn: {
      Active: -1,
    },
    EventEmitter,
    ThemeIcon: class ThemeIcon {
      constructor(id) {
        this.id = id;
      }
    },
    TreeItem,
    TreeItemCollapsibleState: {
      None: 0,
      Collapsed: 1,
      Expanded: 2,
    },
    workspace: {
      createFileSystemWatcher(pattern) {
        const created = new EventEmitter();
        const deleted = new EventEmitter();
        // Exercise real filesystem changes in the temporary Codex home. The
        // production extension delegates watcher lifecycle to VS Code.
        let nativeWatcher;
        if (options.codexHome) {
          nativeWatcher = require("node:fs").watch(
            options.codexHome, { recursive: true }, (event, filename) => {
              if (event !== "rename" || !filename) return;
              const fsPath = path.join(options.codexHome, filename);
              const relative = path.relative(pattern.base, fsPath);
              const matches = pattern.pattern === "*"
                ? relative !== "" && !relative.includes(path.sep) && !relative.startsWith("..")
                : relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
              if (matches) created.fire({ fsPath });
            },
          );
          nativeWatcher.on("error", () => {});
        }
        return {
          onDidCreate: created.event,
          onDidDelete: deleted.event,
          dispose() {
            nativeWatcher?.close();
            created.dispose();
            deleted.dispose();
          },
        };
      },
      workspaceFolders: options.workspaceFolders ?? [
        {
          name: "codex-extras",
          uri: {
            fsPath: "/home/person/codex-extras",
          },
        },
      ],
      onDidChangeWorkspaceFolders() {
        return disposable;
      },
    },
    window: {
      activeTextEditor: undefined,
      tabGroups: {
        all: [{ tabs }],
      },
      createTreeView(id, options) {
        const view = {
          id,
          options,
          dispose() {},
          onDidChangeVisibility() {
            return disposable;
          },
        };
        treeViews.push(view);
        return view;
      },
    },
  };
  const context = { subscriptions: [] };
  const originalCodexHome = process.env.CODEX_HOME;

  if (options.codexHome) {
    process.env.CODEX_HOME = options.codexHome;
  }

  try {
    loadExtension(vscode).activate(context);
  } finally {
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }
  }

  t.after(() => {
    for (const subscription of context.subscriptions) {
      subscription.dispose();
    }
  });

  return {
    calls,
    commandHandlers,
    treeViews,
    runCommand: (command = "codexExtras.newCodexAgent", ...args) =>
      commandHandlers.get(command)(...args),
  };
}

function emptyCodexTab(query = "") {
  return {
    input: {
      uri: {
        scheme: "openai-codex",
        authority: "route",
        path: "/extension/panel/new",
        query,
      },
    },
  };
}

test("delegates the first panel to the official Codex command", async (t) => {
  const harness = createHarness(t);

  await harness.runCommand();

  assert.deepEqual(harness.calls, [["chatgpt.newCodexPanel"]]);
});

test("opens a distinct Codex route when an empty panel already exists", async (t) => {
  const harness = createHarness(t, [emptyCodexTab()]);

  await harness.runCommand();

  assert.equal(harness.calls.length, 1);
  const [command, uri, viewType, options] = harness.calls[0];
  assert.equal(command, "vscode.openWith");
  assert.equal(uri.scheme, "openai-codex");
  assert.equal(uri.authority, "route");
  assert.equal(uri.path, "/extension/panel/new");
  assert.match(uri.query, /^codexExtras=\d+-\d+$/);
  assert.equal(viewType, "chatgpt.conversationEditor");
  assert.deepEqual(options, {
    viewColumn: -1,
    preserveFocus: false,
    preview: false,
  });
});

test("uses a unique URI for every additional empty panel", async (t) => {
  const harness = createHarness(t, [emptyCodexTab()]);

  await harness.runCommand();
  await harness.runCommand();

  assert.notEqual(harness.calls[0][1].query, harness.calls[1][1].query);
});

test("does not treat an existing conversation as an empty panel", async (t) => {
  const conversationTab = {
    input: {
      uri: {
        scheme: "openai-codex",
        authority: "route",
        path: "/local/conversation-id",
      },
    },
  };
  const harness = createHarness(t, [conversationTab]);

  await harness.runCommand();

  assert.deepEqual(harness.calls, [["chatgpt.newCodexPanel"]]);
});

test("registers the Codex chat history tree view", (t) => {
  const harness = createHarness(t);

  assert.equal(harness.treeViews.length, 1);
  assert.equal(harness.treeViews[0].id, "codexExtras.chatHistory");
  assert.equal(
    typeof harness.treeViews[0].options.treeDataProvider.getChildren,
    "function",
  );
  assert.ok(harness.commandHandlers.has("codexExtras.newChat"));
  assert.ok(harness.commandHandlers.has("codexExtras.openChat"));
  assert.ok(harness.commandHandlers.has("codexExtras.refreshChats"));
});

test("opens a selected Codex chat as a pinned editor tab", async (t) => {
  const harness = createHarness(t);
  const sessionId = "019f9c23-f7ec-72c3-8eb6-0018b17bea4f";

  await harness.runCommand("codexExtras.openChat", sessionId);

  assert.deepEqual(harness.calls, [
    [
      "vscode.openWith",
      {
        scheme: "openai-codex",
        authority: "route",
        path: `/local/${sessionId}`,
      },
      "chatgpt.conversationEditor",
      {
        viewColumn: -1,
        preserveFocus: false,
        preview: false,
      },
    ],
  ]);
});

test("opens a chat from its inline tree action", async (t) => {
  const harness = createHarness(t);

  await harness.runCommand("codexExtras.openChat", {
    id: "session-from-tree",
  });

  assert.equal(harness.calls[0][1].path, "/local/session-from-tree");
});

test("groups current workspace chats before other workspaces", async (t) => {
  const codexHome = await mkdtemp(
    path.join(os.tmpdir(), "codex-extras-extension-test-"),
  );
  t.after(() => rm(codexHome, { recursive: true, force: true }));

  const sessionsDirectory = path.join(
    codexHome,
    "sessions",
    "2026",
    "07",
    "26",
  );
  await mkdir(sessionsDirectory, { recursive: true });

  const currentId = "019f9c23-f7ec-72c3-8eb6-0018b17bea4f";
  const otherId = "019f9c28-a20f-70f3-9df9-518aaf67a20b";
  await writeFile(
    path.join(codexHome, "session_index.jsonl"),
    [
      JSON.stringify({
        id: currentId,
        thread_name: "Current chat",
        updated_at: "2026-07-26T05:00:00Z",
      }),
      JSON.stringify({
        id: otherId,
        thread_name: "Other chat",
        updated_at: "2026-07-26T04:00:00Z",
      }),
    ].join("\n"),
  );

  for (const [sessionId, cwd] of [
    [currentId, "/work/current/packages/app"],
    [otherId, "/work/other"],
  ]) {
    await writeFile(
      path.join(
        sessionsDirectory,
        `rollout-2026-07-26T05-00-00-${sessionId}.jsonl`,
      ),
      `${JSON.stringify({
        type: "session_meta",
        payload: { id: sessionId, cwd },
      })}\n`,
    );
  }

  const harness = createHarness(t, [], {
    codexHome,
    workspaceFolders: [
      {
        name: "current",
        uri: { fsPath: "/work/current" },
      },
    ],
  });
  const provider = harness.treeViews[0].options.treeDataProvider;
  const groups = await provider.getChildren();
  const currentChats = await provider.getChildren(groups[0]);
  const otherChats = await provider.getChildren(groups[1]);

  assert.deepEqual(
    groups.map(({ label, collapsibleState }) => [label, collapsibleState]),
    [
      ["Current Workspace", 2],
      ["Other Workspaces", 1],
    ],
  );
  assert.equal(currentChats[0].label, "Current chat");
  assert.equal(otherChats[0].label, "Other chat");
  assert.match(otherChats[0].description, /^other · /);
});
