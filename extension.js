"use strict";

const vscode = require("vscode");

const COMMAND_ID = "codexExtras.newCodexAgent";
const OFFICIAL_CODEX_COMMAND_ID = "chatgpt.newCodexPanel";

/**
 * Registers the branded toolbar action and delegates its behavior to the
 * official Codex extension.
 *
 * @param {import("vscode").ExtensionContext} context
 */
function activate(context) {
  const command = vscode.commands.registerCommand(COMMAND_ID, () =>
    vscode.commands.executeCommand(OFFICIAL_CODEX_COMMAND_ID),
  );

  context.subscriptions.push(command);
}

module.exports = { activate };
