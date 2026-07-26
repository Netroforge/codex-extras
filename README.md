# Codex Extras

[![CI](https://github.com/netroforge/codex-extras/actions/workflows/ci.yml/badge.svg)](https://github.com/netroforge/codex-extras/actions/workflows/ci.yml)
[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/netroforge.codex-extras)](https://marketplace.visualstudio.com/items?itemName=netroforge.codex-extras)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Small, focused workflow improvements for the official Codex extension in Visual Studio Code.

![Codex Extras icon](assets/icon.png)

## Features

### Codex Chats panel

Adds a **Codex Chats** icon to the Activity Bar. Open it to see local Codex
conversations ordered by their most recent activity.

- Chats for the current workspace appear first in an expanded section.
- Chats from other workspaces stay in a separate collapsed section and show
  their workspace name.
- Select a chat to open it as a pinned Codex editor tab.
- Start a new chat or refresh the list from the panel toolbar.
- New and renamed chats appear automatically while VS Code is running.

The panel reads Codex's local session index from `$CODEX_HOME/session_index.jsonl`
when `CODEX_HOME` is set, or from `~/.codex/session_index.jsonl` otherwise.
It reads only the small metadata prefix needed to identify each chat's workspace;
transcript contents are not parsed or copied.

### New Codex Agent toolbar button

Adds a visible code-brackets-and-plus action to the editor toolbar. Select it to
open a new Codex agent. If an empty Codex agent is already open, selecting the
button again opens another empty agent instead of focusing the existing one.

The button is available without assigning a keyboard shortcut.

## Requirements

- Visual Studio Code 1.96.2 or newer
- [Codex – OpenAI's coding agent](https://marketplace.visualstudio.com/items?itemName=openai.chatgpt)

The official Codex extension is declared as a dependency and is installed automatically when Codex Extras is installed from the Marketplace.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `codexExtras.showNewAgentButton` | `true` | Shows the New Codex Agent button in the editor toolbar. |

## Install

Install **Codex Extras** from the Visual Studio Marketplace, or use:

```sh
code --install-extension netroforge.codex-extras
```

For an unpublished development build:

```sh
npm ci
npm run package
code --install-extension codex-extras-1.1.0.vsix
```

## Privacy

Codex Extras contains no telemetry or network requests. It reads the local Codex
session index to populate the chat list and opens editor panels provided by the
official Codex extension.

## Contributing

Contributions and feature proposals are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Disclaimer

Codex Extras is an independent, unofficial open-source project. It is not affiliated with, endorsed by, or sponsored by OpenAI. Codex, OpenAI, ChatGPT, and related marks are trademarks of their respective owners.

## License

[MIT](LICENSE)
