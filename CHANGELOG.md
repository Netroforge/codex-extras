# Changelog

All notable changes to Codex Extras are documented in this file.

## Unreleased

- Add experimental, opt-in session status icons. Use local Codex IPC for live
  work and input/approval waits, and bounded log reads for recorded results.
  Keep the original chat icons and metadata-only reads by default.
- Show unanswered non-blocking questions, resolve replies independently, and
  discard superseded or abandoned questions, including migrated histories.
- Mark new results in green until opened successfully through Codex Extras;
  persist review state and protect newer results from stale clicks.
- Use theme-aware status colors and a small gray dot for reviewed, idle, and
  unknown states, preserving label alignment. Document protocol limitations.

## 1.1.0

- Add a Codex Chats Activity Bar panel with local chat history, automatic
  refresh, and pinned editor-tab opening.
- Show current-workspace chats first, separate chats from other workspaces, and
  use a new geometric Activity Bar icon.
- Open a distinct empty Codex agent when the toolbar button is selected while
  another empty agent is already open.

## 1.0.1

- Add an original code-brackets-and-plus icon for the New Codex Agent toolbar button.
- Delegate the custom toolbar action to the official `chatgpt.newCodexPanel` command.

## 1.0.0

- Initial stable release.
- Add a configurable New Codex Agent button to the editor toolbar.
- Invoke the official `chatgpt.newCodexPanel` command.
- Declare the official Codex extension as an installation dependency.
- Add CI, Marketplace publishing automation, and an original extension icon.
