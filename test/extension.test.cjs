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

  const tabsChanged = new EventEmitter();
  const tabGroupsChanged = new EventEmitter();
  const tabGroup = { tabs, activeTab: options.activeTab };
  const vscode = {
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
        all: [tabGroup],
        activeTabGroup: tabGroup,
        onDidChangeTabs: tabsChanged.event,
        onDidChangeTabGroups: tabGroupsChanged.event,
      },
      createTreeView(id, options) {
        const view = {
          id,
          options,
          visible: true,
          selection: [],
          reveals: [],
          async reveal(item, revealOptions) {
            this.reveals.push({ item, options: revealOptions });
            if (revealOptions.select) this.selection = [item];
          },
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
    setActiveTab(tab, groupEvent = false) {
      tabGroup.activeTab = tab;
      (groupEvent ? tabGroupsChanged : tabsChanged).fire({});
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

test("tracks the active conversation across tab groups without moving editor focus", async (t) => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-extras-active-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  const index = path.join(codexHome, "session_index.jsonl");
  await writeFile(index, ["first", "second"].map((id) => JSON.stringify({ id, thread_name: id })).join("\n"));
  const conversationTab = (id) => ({ input: { uri: {
    scheme: "openai-codex", authority: "route", path: `/local/${id}`,
  } } });
  const first = conversationTab("first");
  const harness = createHarness(t, [first], { codexHome, workspaceFolders: [], activeTab: first });
  const view = harness.treeViews[0];
  const provider = view.options.treeDataProvider;
  await provider.getChildren();
  await delay(25);
  assert.equal(view.selection[0].sessionId, "first");
  assert.equal(provider.getParent(view.selection[0]).id, "all-chats");
  assert.deepEqual(view.reveals.at(-1).options, { select: true, focus: false, expand: false });
  await harness.runCommand("codexExtras.openChat", view.selection[0]);
  assert.equal(harness.calls.at(-1)[1].path, "/local/first", "inline actions use the session ID, not the tree identity");
  harness.calls.length = 0;
  const rootId = provider.groups[0].id;
  harness.setActiveTab(conversationTab("second"), true);
  await provider.getChildren();
  await delay(25);
  assert.equal(view.selection[0].sessionId, "second");
  assert.equal(provider.groups[0].id, rootId, "tab switches preserve group identity");
  const previousSelection = view.selection[0].id;
  const revealCount = view.reveals.length;
  harness.setActiveTab(emptyCodexTab());
  const [group] = await provider.getChildren();
  const rows = await provider.getChildren(group);
  await delay(25);
  assert.ok(rows.every((row) => row.id !== previousSelection), "new panels invalidate stale native selection");
  assert.equal(view.reveals.length, revealCount, "never guess a new panel's conversation from its title or timestamp");
  assert.deepEqual(harness.calls, [], "selection sync must not open, close, or rename editors");
});

test("reconciles a known active tab after its session appears or title changes in the index", async (t) => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-extras-active-index-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  const index = path.join(codexHome, "session_index.jsonl");
  await writeFile(index, "");
  const activeTab = { input: { uri: { scheme: "openai-codex", authority: "route", path: "/local/new-session" } } };
  const harness = createHarness(t, [activeTab], { codexHome, workspaceFolders: [], activeTab });
  const view = harness.treeViews[0];
  const provider = view.options.treeDataProvider;
  await provider.getChildren();
  await delay(25);
  assert.equal(view.reveals.length, 0);
  await writeFile(index, JSON.stringify({ id: "new-session", thread_name: "Generated title" }));
  await provider.getChildren();
  await delay(25);
  assert.equal(view.selection[0].label, "Generated title");
  const selectionId = view.selection[0].id;
  provider.refresh();
  await provider.getChildren();
  await delay(25);
  assert.equal(view.selection[0].id, selectionId, "status refreshes keep leaf identity stable");
  assert.equal(view.reveals.length, 1, "status refreshes must not repeatedly scroll the list");
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
