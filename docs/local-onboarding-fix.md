# Local OpenAI Codex onboarding repair

This is a development repair of `openai.chatgpt` version `26.1007.21434`.
It is not part of the Codex Extras runtime or VSIX. Do not publish this as an
Extras feature: the defective onboarding decision belongs to OpenAI's webview.

The installed extension's `FGi()` checks `isLoading` before reading the saved
completion flag. Failed and paused requests can have `isLoading: false` without
successful data, so they incorrectly select onboarding. The repair requires
`isSuccess` instead. It also makes an already open onboarding page navigate home
when the saved completion flag becomes available and says onboarding is complete.
A failed read remains on the loading screen until a successful refetch; this
repair does not diagnose or repair the underlying request failure.

Local inspection confirmed both saved completion flags were true. Isolated tests
reproduce the incorrect decision in the original installed code. The particular
request failure triggering the user's repeated welcome screen is not yet proven.
After applying the repair and reloading VS Code, the reporter confirmed that the repeated welcome screen stopped appearing. The exact triggering request failure remains unverified.

## Apply

From the repository root, pass the absolute installed extension directory:

```powershell
node scripts/local-onboarding-fix.cjs "$env:USERPROFILE/.vscode/extensions/openai.chatgpt-26.1007.21434-win32-x64"
```

Both target files are validated before writes. Original files are saved alongside
them with `.codex-extras-nux-backup` appended. The script rejects unsupported
versions and unexpected code. Reapplying the repair is safe.

Run **Developer: Reload Window** from the VS Code command palette. Then open a
new agent through both the Extras toolbar and the Codex Chats plus button,
including while another empty agent is open. Repeat after another window reload.
The welcome screen should not return and existing conversations should still open.

An OpenAI extension update may replace these files. Do not automatically reapply
the repair to another version; inspect and test its code first.

## Restore

```powershell
node scripts/local-onboarding-fix.cjs "$env:USERPROFILE/.vscode/extensions/openai.chatgpt-26.1007.21434-win32-x64" --restore
```

Reload the VS Code window again. Restore refuses to overwrite files that changed
after the repair.

## Tests

```powershell
node --test test/local-onboarding-fix.test.cjs
npm.cmd test
```

The focused tests cover the original regression, legitimate first use, completion,
an already open welcome page, version validation, backup, idempotence and restore.
