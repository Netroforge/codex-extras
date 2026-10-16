# Experimental session status icons

`codexExtras.showSessionStatusIcons` is off by default. The original chat icon,
metadata-only reads, and watcher behavior remain the default.

## Sources of status

- Live state: Codex's internal cross-window IPC, not a separate app-server process.
  A different app-server instance cannot reliably report another instance's work.
- Historical results: at most the trailing 256 KiB of a local JSONL session file,
  cached by file identity, size, and modification time. Only `event_msg` lifecycle
  records count. Unfinished logs always return unconfirmed activity.
- No status polling or inactivity-based completion. File events refresh log
  results; IPC messages update runtime status. Reconnection uses a delayed retry
  only after the IPC connection closes.

The public app-server protocol documents `thread/status/changed` and runtime
thread status: <https://learn.chatgpt.com/docs/app-server#track-thread-status-changes>.
The installed IDE extension owns a stdio app-server connection and does not
export a public status subscription for other VS Code extensions.

## Internal IPC contract observed locally

Verified with `openai.chatgpt` version `26.1007.21434` on Windows. Sources of
confirmation: installed extension implementation, successful observer handshake,
read-only ownership discovery, and repeated runtime-state snapshots.

- Windows endpoint: `\\.\pipe\codex-ipc`.
- Unix endpoints: `$CODEX_HOME/ipc/ipc.sock` and the legacy per-user socket under
  the operating system temporary directory. Unix paths are derived from the
  installed implementation; live connectivity was verified on Windows only.
- Framing: 4-byte little-endian byte length followed by UTF-8 JSON.
- Initialize: `initialize`, version 0; receives a client ID.
- Subscribe/unsubscribe: `thread-stream-following-changed`, version 1,
  `{hostId: "local", conversationId, following}`.
- Runtime stream: `thread-stream-state-changed`, version 11. Snapshots contain
  `change.conversationState.threadRuntimeStatus`. Patches carry base and new
  revisions. Only runtime-status fields are retained; transcript patches are ignored.
- `active` means working; nonempty `activeFlags` means waiting for input/approval.
  `idle` means idle, `systemError` means failed, other states are unconfirmed.
- An owner-disconnection event or lost IPC connection clears live states.
- A revision gap requests a fresh snapshot. Unsupported versions cannot retain
  a running indicator. Discovery requests are answered with `canHandle: false`.

The adapter never becomes an owner and sends no task-control requests. Receiving
snapshots can temporarily decode conversation data in memory; it keeps no messages
and does not write source logs, configuration, or transcripts.

## Limits

This is an undocumented protocol and may change with Codex updates. A socket
connection and the last runtime state cannot prove progress if an owner remains
connected but stops responding. IPC disconnections are handled immediately;
silent hangs cannot be ruled out. A missing log result remains unknown rather
than becoming a successful completion. Remote hosts and compressed active logs
are not currently supported for status discovery.

Tests cover option toggling, log parsing and bounds, incomplete writes, live
snapshots and runtime patches, waiting states, owner and transport disconnection,
revision mismatch, protocol mismatch, frame bounds, and observer-only behavior.
