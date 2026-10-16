"use strict";

const fs = require("node:fs");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");
const { SessionStatusReader, watchSessionStatus } = require("./session-status");
const { LiveSessionStatus } = require("./session-live-status");
const {
  getSessionIndexPath,
  getSessionsDirectory,
  isPathInsideWorkspace,
  loadSessionFiles,
  loadSessionWorkspaces,
  parseSessionIndex,
} = require("./session-index");

const COMMAND_ID = "codexExtras.newCodexAgent";
const NEW_CHAT_COMMAND_ID = "codexExtras.newChat";
const OPEN_CHAT_COMMAND_ID = "codexExtras.openChat";
const REFRESH_CHATS_COMMAND_ID = "codexExtras.refreshChats";
const CHAT_HISTORY_VIEW_ID = "codexExtras.chatHistory";
const OFFICIAL_CODEX_COMMAND_ID = "chatgpt.newCodexPanel";
const VSCODE_OPEN_WITH_COMMAND_ID = "vscode.openWith";
const CODEX_EDITOR_VIEW_TYPE = "chatgpt.conversationEditor";
const CODEX_NEW_PANEL_SCHEME = "openai-codex";
const CODEX_ROUTE_AUTHORITY = "route";
const CODEX_NEW_PANEL_PATH = "/extension/panel/new";
const REVIEWED_RESULTS_KEY = "codexExtras.reviewedResults";
const EMPTY_STATUS_ICON = {
  light: path.join(__dirname, "assets", "status-empty.svg"),
  dark: path.join(__dirname, "assets", "status-empty.svg"),
};

let panelSequence = 0;
let openQueue = Promise.resolve();

const SESSION_STATUSES = {
  working: { icon: "loading~spin", color: "charts.blue", label: "Working (live)" },
  waiting: { icon: "bell", color: "charts.yellow", label: "Waiting for input or approval (live)" },
  question: { icon: "question", color: "charts.yellow", label: "Unanswered non-blocking question (agent may still be working)" },
  idle: { label: "Idle (live)" },
  unconfirmed: { icon: "clock", color: "descriptionForeground", label: "Activity unconfirmed" },
  completed: { icon: "pass", color: "testing.iconPassed", label: "New result to review" },
  reviewed: { label: "Result reviewed" },
  interrupted: { icon: "debug-stop", color: "charts.orange", label: "Interrupted" },
  failed: { icon: "error", color: "errorForeground", label: "Failed" },
};

class CodexChatItem extends vscode.TreeItem {
  constructor(session) {
    super(session.title, vscode.TreeItemCollapsibleState.None);

    this.id = session.id;
    this.resultKey = session.status === "completed" ? session.resultKey : null;
    const status = session.showStatusIcons
      ? SESSION_STATUSES[session.status] ?? {
        label: "Status unknown",
      }
      : undefined;
    this.description = [session.workspaceName, formatUpdatedAt(session.updatedAt)]
      .filter(Boolean)
      .join(" · ");
    this.tooltip = [
      session.title,
      status ? `Status: ${status.label}` : undefined,
      session.status === "unconfirmed" && status
        ? "Live status is unavailable. An unfinished log does not confirm the task is still running."
        : undefined,
      session.workspacePath ? `Workspace: ${session.workspacePath}` : undefined,
      session.updatedAt
        ? `Updated: ${new Date(session.updatedAt).toLocaleString()}`
        : undefined,
    ]
      .filter(Boolean)
      .join("\n");
    this.iconPath = status && !status.icon ? EMPTY_STATUS_ICON : new vscode.ThemeIcon(
      status?.icon ?? "comment-discussion",
      status ? new vscode.ThemeColor(status.color) : undefined,
    );
    this.contextValue = "codexChat";
    this.command = {
      command: OPEN_CHAT_COMMAND_ID,
      title: "Open Codex Chat",
      arguments: [{ id: session.id, resultKey: this.resultKey }],
    };
    this.accessibilityInformation = {
      label: `${session.title}, Codex chat${status ? `, ${status.label}` : ""}`,
    };
  }
}

class CodexChatGroupItem extends vscode.TreeItem {
  constructor(label, sessions, options = {}) {
    super(
      label,
      options.expanded
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed,
    );

    this.sessions = sessions;
    this.id = options.id;
    this.description = `${sessions.length} ${
      sessions.length === 1 ? "chat" : "chats"
    }${options.detail ? ` · ${options.detail}` : ""}`;
    this.iconPath = new vscode.ThemeIcon(options.icon ?? "folder");
    this.contextValue = "codexChatGroup";
  }
}

class CodexChatHistoryProvider {
  constructor(sessionIndexPath, sessionsDirectory, getWorkspaceFolders, getReviewedResults) {
    this.sessionIndexPath = sessionIndexPath;
    this.sessionsDirectory = sessionsDirectory;
    this.getWorkspaceFolders = getWorkspaceFolders;
    this.getReviewedResults = getReviewedResults;
    this.displayedResults = new Map();
    this.workspaceBySessionId = new Map();
    this.showStatusIcons = false;
    this.sessionStatusReader = new SessionStatusReader();
    this.changeEmitter = new vscode.EventEmitter();
    this.statusEmitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changeEmitter.event;
    this.onDidChangeStatus = this.statusEmitter.event;
  }

  refresh() {
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(item) {
    return item;
  }

  async getChildren(item) {
    if (item instanceof CodexChatGroupItem) {
      return item.sessions.map((session) => new CodexChatItem(session));
    }

    if (item) {
      return [];
    }

    try {
      const contents = await readFile(this.sessionIndexPath, "utf8");
      const sessions = parseSessionIndex(contents);
      const missingWorkspaceIds = sessions
        .filter((session) => !this.workspaceBySessionId.has(session.id))
        .map((session) => session.id);
      const showStatusIcons = this.showStatusIcons;
      this.liveStatus?.setThreads(sessions.map(({ id }) => id));
      const sessionFiles = showStatusIcons
        ? await loadSessionFiles(this.sessionsDirectory, sessions.map(({ id }) => id))
        : undefined;
      const loadedWorkspaces = await loadSessionWorkspaces(
        this.sessionsDirectory,
        missingWorkspaceIds,
        sessionFiles,
      );

      for (const [sessionId, workspacePath] of loadedWorkspaces) {
        this.workspaceBySessionId.set(sessionId, workspacePath);
      }

      const workspaceFolders = this.getWorkspaceFolders();
      const enrichedSessions = await Promise.all(sessions.map(async (session) => {
        const historicalStatus = sessionFiles?.has(session.id)
          ? await this.sessionStatusReader.read(sessionFiles.get(session.id))
          : undefined;
        const liveStatus = this.liveStatus?.get(session.id);
        const resultKey = sessionFiles?.has(session.id)
          ? this.sessionStatusReader.resultKey(sessionFiles.get(session.id)) : undefined;
        let status = liveStatus && liveStatus !== "idle" ? liveStatus
          : liveStatus === "idle" && historicalStatus === "unconfirmed" ? "idle"
          : historicalStatus ?? liveStatus;
        if (status === "completed" && resultKey === this.getReviewedResults()[session.id]) {
          status = "reviewed";
        }
        return {
          ...session,
          workspacePath: this.workspaceBySessionId.get(session.id),
          showStatusIcons,
          status,
          resultKey,
        };
      }));
      this.displayedResults = new Map(enrichedSessions.map((session) => [
        session.id, session.status === "completed" ? session.resultKey : undefined,
      ]));
      if (sessionFiles) this.sessionStatusReader.retain(sessionFiles.values());

      this.statusEmitter.fire(undefined);
      return createChatGroups(enrichedSessions, workspaceFolders);
    } catch (error) {
      if (error?.code === "ENOENT") {
        this.statusEmitter.fire(undefined);
        return [];
      }

      this.statusEmitter.fire("Codex chat history could not be loaded.");
      return [];
    }
  }

  dispose() {
    this.sessionStatusReader.clear();
    this.changeEmitter.dispose();
    this.statusEmitter.dispose();
  }
}

function createChatGroups(sessions, workspaceFolders) {
  if (sessions.length === 0) {
    return [];
  }

  if (workspaceFolders.length === 0) {
    return [
      new CodexChatGroupItem(
        "All Chats",
        sessions.map((session) => ({
          ...session,
          workspaceName: getWorkspaceName(session.workspacePath),
        })),
        {
          expanded: true,
          icon: "comment-discussion",
          id: "all-chats",
        },
      ),
    ];
  }

  const currentSessions = [];
  const otherSessions = [];

  for (const session of sessions) {
    const currentFolder = workspaceFolders.find((folder) =>
      isPathInsideWorkspace(session.workspacePath, folder.uri.fsPath),
    );

    if (currentFolder) {
      currentSessions.push({
        ...session,
        workspaceName: undefined,
      });
    } else {
      otherSessions.push({
        ...session,
        workspaceName: getWorkspaceName(session.workspacePath),
      });
    }
  }

  const currentWorkspaceDetail =
    workspaceFolders.length === 1
      ? workspaceFolders[0].name
      : `${workspaceFolders.length} folders`;
  const groups = [
    new CodexChatGroupItem("Current Workspace", currentSessions, {
      expanded: true,
      icon: "root-folder-opened",
      detail: currentWorkspaceDetail,
      id: "current-workspace",
    }),
  ];

  if (otherSessions.length > 0) {
    groups.push(
      new CodexChatGroupItem("Other Workspaces", otherSessions, {
        expanded: false,
        icon: "folder-library",
        id: "other-workspaces",
      }),
    );
  }

  return groups;
}

function getWorkspaceName(workspacePath) {
  return workspacePath ? path.basename(workspacePath) : "Unknown workspace";
}

function formatUpdatedAt(updatedAt) {
  if (!updatedAt) {
    return undefined;
  }

  const date = new Date(updatedAt);
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();

  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], {
        year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
        month: "short",
        day: "numeric",
      });
}

function hasOpenEmptyCodexPanel() {
  return vscode.window.tabGroups.all.some((group) =>
    group.tabs.some((tab) => {
      const uri = tab.input?.uri;

      return (
        uri?.scheme === CODEX_NEW_PANEL_SCHEME &&
        uri.authority === CODEX_ROUTE_AUTHORITY &&
        uri.path === CODEX_NEW_PANEL_PATH
      );
    }),
  );
}

function createUniqueNewPanelUri() {
  panelSequence += 1;

  return vscode.Uri.from({
    scheme: CODEX_NEW_PANEL_SCHEME,
    authority: CODEX_ROUTE_AUTHORITY,
    path: CODEX_NEW_PANEL_PATH,
    query: `codexExtras=${Date.now()}-${panelSequence}`,
  });
}

async function openNewCodexAgent() {
  if (!hasOpenEmptyCodexPanel()) {
    return vscode.commands.executeCommand(OFFICIAL_CODEX_COMMAND_ID);
  }

  const uri = createUniqueNewPanelUri();
  const viewColumn =
    vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Active;

  return vscode.commands.executeCommand(
    VSCODE_OPEN_WITH_COMMAND_ID,
    uri,
    CODEX_EDITOR_VIEW_TYPE,
    {
      viewColumn,
      preserveFocus: false,
      preview: false,
    },
  );
}

function createConversationUri(sessionId) {
  return vscode.Uri.from({
    scheme: CODEX_NEW_PANEL_SCHEME,
    authority: CODEX_ROUTE_AUTHORITY,
    path: `/local/${sessionId}`,
  });
}

function openCodexChat(session) {
  const sessionId = typeof session === "string" ? session : session?.id;

  if (
    typeof sessionId !== "string" ||
    !/^[a-zA-Z0-9_-]+$/.test(sessionId)
  ) {
    return undefined;
  }

  return vscode.commands.executeCommand(
    VSCODE_OPEN_WITH_COMMAND_ID,
    createConversationUri(sessionId),
    CODEX_EDITOR_VIEW_TYPE,
    {
      viewColumn: vscode.ViewColumn.Active,
      preserveFocus: false,
      preview: false,
    },
  );
}

function watchSessionIndex(sessionIndexPath, onChange) {
  const listener = (current, previous) => {
    if (
      current.mtimeMs !== previous.mtimeMs ||
      current.size !== previous.size ||
      current.ino !== previous.ino
    ) {
      onChange();
    }
  };

  fs.watchFile(
    sessionIndexPath,
    { interval: 1_000, persistent: false },
    listener,
  );

  return {
    dispose() {
      fs.unwatchFile(sessionIndexPath, listener);
    },
  };
}

/**
 * Registers the branded toolbar action and Codex chat history view.
 *
 * The official command uses a stable URI for a new Codex panel, so VS Code
 * focuses an existing empty panel instead of opening another one. Preserve the
 * official path for the first panel, then add a unique query value whenever an
 * empty panel is already open. Codex ignores the query when resolving its route.
 *
 * @param {import("vscode").ExtensionContext} context
 */
function activate(context) {
  let reviewedResults = context.globalState.get(REVIEWED_RESULTS_KEY, {});
  let reviewQueue = Promise.resolve();
  const openNewChat = () => {
    openQueue = openQueue.catch(() => undefined).then(openNewCodexAgent);
    return openQueue;
  };
  const sessionIndexPath = getSessionIndexPath();
  const historyProvider = new CodexChatHistoryProvider(
    sessionIndexPath,
    getSessionsDirectory(),
    () => vscode.workspace.workspaceFolders ?? [],
    () => reviewedResults,
  );
  const openChat = async (session) => {
    const id = typeof session === "string" ? session : session?.id;
    // Capture the displayed result before opening: a newer turn may finish
    // while the editor is being created and must remain unread.
    const resultKey = session && typeof session === "object" && "resultKey" in session
      ? session.resultKey : historyProvider.displayedResults.get(id);
    await openCodexChat(session);
    if (!resultKey || !vscode.window.tabGroups.all.some((group) => group.tabs.some((tab) => {
      const uri = tab.input?.uri;
      return uri?.scheme === CODEX_NEW_PANEL_SCHEME && uri.authority === CODEX_ROUTE_AUTHORITY &&
        uri.path === `/local/${id}`;
    }))) return;
    reviewQueue = reviewQueue.catch(() => {}).then(async () => {
      const next = { ...reviewedResults, [id]: resultKey };
      await context.globalState.update(REVIEWED_RESULTS_KEY, next);
      reviewedResults = next;
      historyProvider.refresh();
    });
    await reviewQueue;
  };
  const historyView = vscode.window.createTreeView(CHAT_HISTORY_VIEW_ID, {
    treeDataProvider: historyProvider,
    showCollapseAll: false,
  });
  const statusSubscription = historyProvider.onDidChangeStatus((message) => {
    historyView.message = message;
  });
  const visibilitySubscription = historyView.onDidChangeVisibility(
    ({ visible }) => {
      if (visible) {
        historyProvider.refresh();
      }
    },
  );
  const workspaceSubscription = vscode.workspace.onDidChangeWorkspaceFolders(
    () => historyProvider.refresh(),
  );
  let sessionStatusWatcher;
  const updateStatusIcons = () => {
    const enabled = vscode.workspace.getConfiguration("codexExtras")
      .get("showSessionStatusIcons", false);
    sessionStatusWatcher?.dispose();
    historyProvider.liveStatus?.dispose();
    historyProvider.liveStatus = undefined;
    sessionStatusWatcher = undefined;
    historyProvider.showStatusIcons = enabled;
    historyProvider.sessionStatusReader.clear();
    if (enabled) {
      historyProvider.liveStatus = new LiveSessionStatus({
        codexHome: path.dirname(sessionIndexPath), onChange: () => historyProvider.refresh(),
      });
      sessionStatusWatcher = watchSessionStatus(
        historyProvider.sessionsDirectory, () => historyProvider.refresh(), vscode,
      );
    }
    historyProvider.refresh();
  };
  const configurationSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("codexExtras.showSessionStatusIcons")) updateStatusIcons();
  });
  updateStatusIcons();

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_ID, openNewChat),
    vscode.commands.registerCommand(NEW_CHAT_COMMAND_ID, openNewChat),
    vscode.commands.registerCommand(OPEN_CHAT_COMMAND_ID, openChat),
    vscode.commands.registerCommand(REFRESH_CHATS_COMMAND_ID, () =>
      historyProvider.refresh(),
    ),
    historyProvider,
    historyView,
    statusSubscription,
    visibilitySubscription,
    workspaceSubscription,
    configurationSubscription,
    { dispose() {
      sessionStatusWatcher?.dispose();
      historyProvider.liveStatus?.dispose();
    } },
    watchSessionIndex(sessionIndexPath, () => historyProvider.refresh()),
  );
}

module.exports = { activate };
