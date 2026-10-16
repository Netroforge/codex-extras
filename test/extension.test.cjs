"use strict";

const assert = require("node:assert/strict");
const { appendFile, mkdtemp, mkdir, rm, writeFile } = require("node:fs/promises");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const extensionPath = path.resolve(__dirname, "..", "extension.js");
const originalLoad = Module._load;

function loadExtension(vscode, LiveStatus) {
  delete require.cache[extensionPath];
  Module._load = function load(request, parent, isMain) {
    if (request === "vscode") {
      return vscode;
    }
    if (request === "./session-live-status" && LiveStatus) {
      return { LiveSessionStatus: LiveStatus };
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

  const configurationChanged = new EventEmitter();
  let showStatusIcons = options.showSessionStatusIcons ?? false;
  const fileWatchers = [];
  const liveMonitors = [];
  class LiveStatus {
    constructor({ onChange }) {
      this.states = new Map();
      this.onChange = onChange;
      liveMonitors.push(this);
    }
    setThreads(ids) { this.threads = new Set(ids); }
    get(id) { return this.states.get(id); }
    dispose() { this.disposed = true; this.states.clear(); }
  }

  const vscode = {
    RelativePattern: class RelativePattern {
      constructor(base, pattern) { this.base = base; this.pattern = pattern; }
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
      constructor(id, color) {
        this.id = id;
        this.color = color;
      }
    },
    ThemeColor: class ThemeColor {
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
      getConfiguration(section) {
        assert.equal(section, "codexExtras");
        return { get: (key, fallback) => key === "showSessionStatusIcons" ? showStatusIcons : fallback };
      },
      onDidChangeConfiguration: configurationChanged.event,
      createFileSystemWatcher(pattern) {
        const created = new EventEmitter();
        const changed = new EventEmitter();
        const deleted = new EventEmitter();
        // Exercise real filesystem changes in the temporary Codex home. The
        // production extension delegates watcher lifecycle to VS Code.
        let nativeWatcher;
        if (options.codexHome) {
          nativeWatcher = require("node:fs").watch(
            options.codexHome, { recursive: true }, (event, filename) => {
              if (!filename) return;
              const fsPath = path.join(options.codexHome, filename);
              const relative = path.relative(pattern.base, fsPath);
              const matches = pattern.pattern === "*"
                ? relative !== "" && !relative.includes(path.sep) && !relative.startsWith("..")
                : relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
              if (matches) {
                const emitter = event === "change" ? changed
                  : require("node:fs").existsSync(fsPath) ? created : deleted;
                emitter.fire({ fsPath });
              }
            },
          );
          nativeWatcher.on("error", () => {});
        }
        const watcher = {
          pattern,
          disposed: false,
          onDidCreate: created.event,
          onDidChange: changed.event,
          onDidDelete: deleted.event,
          dispose() {
            this.disposed = true;
            nativeWatcher?.close();
            created.dispose();
            changed.dispose();
            deleted.dispose();
          },
        };
        fileWatchers.push(watcher);
        return watcher;
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
    loadExtension(vscode, LiveStatus).activate(context);
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
    fileWatchers,
    liveMonitors,
    setStatusIcons(value) {
      showStatusIcons = value;
      configurationChanged.fire({
        affectsConfiguration: (key) => key === "codexExtras.showSessionStatusIcons",
      });
    },
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

test("status icons are opt-in, update on live events, and toggle without reloading", async (t) => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-extras-status-ui-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  const sessions = path.join(codexHome, "sessions");
  await mkdir(sessions);
  const id = "019f9c23-f7ec-72c3-8eb6-0018b17bea4f";
  const filePath = path.join(sessions, `rollout-${id}.jsonl`);
  const lifecycle = (type) => JSON.stringify({
    timestamp: new Date().toISOString(), type: "event_msg", payload: { type, turn_id: "one" },
  }) + "\n";
  await writeFile(filePath, '{"type":"session_meta","payload":{"cwd":"/work/current"}}\n' + lifecycle("task_complete"));
  await writeFile(path.join(codexHome, "session_index.jsonl"), JSON.stringify({ id, thread_name: "Status test" }));
  const harness = createHarness(t, [], { codexHome, workspaceFolders: [] });
  const provider = harness.treeViews[0].options.treeDataProvider;
  let reads = 0;
  const read = provider.sessionStatusReader.read.bind(provider.sessionStatusReader);
  provider.sessionStatusReader.read = (...args) => { reads++; return read(...args); };
  const item = async () => {
    const groups = await provider.getChildren();
    return (await provider.getChildren(groups[0]))[0];
  };
  assert.equal((await item()).iconPath.id, "comment-discussion");
  assert.equal((await item()).iconPath.color, undefined);
  assert.equal(reads, 0, "disabled mode must not read status logs");
  assert.equal(harness.fileWatchers.length, 2, "only archive watchers when disabled");
  assert.equal(harness.liveMonitors.length, 0, "no IPC connection when disabled");
  harness.setStatusIcons(true);
  assert.equal((await item()).iconPath.id, "pass");
  assert.equal((await item()).iconPath.color.id, "testing.iconPassed");
  const watcher = harness.fileWatchers.at(-1);
  assert.equal(watcher.pattern.base, sessions);
  assert.equal(watcher.pattern.pattern, "**/*.jsonl");
  let changes = 0;
  provider.onDidChangeTreeData(() => changes++);
  const waitForRefresh = async (previous) => {
    const deadline = Date.now() + 5000;
    while (changes === previous && Date.now() < deadline) await delay(25);
    assert.ok(changes > previous, "session log changes should refresh icons");
  };
  let previous = changes;
  await appendFile(filePath, lifecycle("task_started"));
  await waitForRefresh(previous);
  assert.equal((await item()).iconPath.id, "clock", "log starts alone must not spin");
  const live = harness.liveMonitors.at(-1);
  live.states.set(id, "working");
  live.onChange();
  assert.equal((await item()).iconPath.id, "loading~spin");
  assert.equal((await item()).iconPath.color.id, "charts.blue");
  assert.match((await item()).accessibilityInformation.label, /Working/);
  for (const [state, icon, color] of [
    ["waiting", "bell", "charts.yellow"],
    ["idle", "circle-outline", "descriptionForeground"],
  ]) {
    live.states.set(id, state);
    const chat = await item();
    assert.equal(chat.iconPath.id, icon);
    assert.equal(chat.iconPath.color.id, color);
  }
  live.states.clear();
  live.onChange();
  assert.equal((await item()).iconPath.id, "clock", "losing live status removes spinner");
  assert.equal((await item()).iconPath.color.id, "descriptionForeground");
  previous = changes;
  await appendFile(filePath, lifecycle("turn_aborted"));
  await waitForRefresh(previous);
  assert.equal((await item()).iconPath.id, "debug-stop");
  assert.equal((await item()).iconPath.color.id, "charts.orange");
  await appendFile(filePath, lifecycle("task_failed"));
  assert.equal((await item()).iconPath.id, "error");
  assert.equal((await item()).iconPath.color.id, "errorForeground");
  await writeFile(filePath, "{}\n");
  assert.equal((await item()).iconPath.id, "question");
  assert.equal((await item()).iconPath.color.id, "descriptionForeground");
  harness.setStatusIcons(false);
  assert.ok(watcher.disposed);
  assert.ok(live.disposed);
  const previousReads = reads;
  assert.equal((await item()).iconPath.id, "comment-discussion");
  assert.equal(reads, previousReads);
  assert.equal(provider.sessionStatusReader.cache.size, 0);
});
