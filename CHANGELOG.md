# Changelog

All notable changes to Codex Extras are documented in this file.

## Unreleased

- Show a yellow question mark for unanswered async questions, with blocking waits
  taking priority. Match replies by question ID and keep unknown status distinct.
- Treat green check marks as new results to review. Hide a specific result's icon
  after its editor opens successfully, persist review state across reloads, and
  show green again for a newer completed turn.

- Apply consistent, theme-aware colors to status icons for working, completed,
  waiting, interrupted, failed, and inactive/unknown states.

- Add opt-in session status icons, using experimental local Codex IPC for live
  activity and bounded log reads for recorded results. Never infer running from
  unfinished logs; invalidate live activity on disconnection. Keep the original
  conversation icons by default.

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
