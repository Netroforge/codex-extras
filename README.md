# Codex Extras

[![CI](https://github.com/netroforge/codex-extras/actions/workflows/ci.yml/badge.svg)](https://github.com/netroforge/codex-extras/actions/workflows/ci.yml)
[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/netroforge.codex-extras)](https://marketplace.visualstudio.com/items?itemName=netroforge.codex-extras)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Small, focused workflow improvements for the official Codex extension in Visual Studio Code.

![Codex Extras icon](assets/icon.png)

## Features

### New Codex Agent toolbar button

Adds a visible `+` action to the editor toolbar. Select it to execute the official Codex command `chatgpt.newCodexPanel` and open a new Codex agent.

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
code --install-extension codex-extras-1.0.0.vsix
```

## Privacy

Codex Extras contains no telemetry, network requests, or runtime code. It contributes a menu item that invokes a command provided by the official Codex extension.

## Contributing

Contributions and feature proposals are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Disclaimer

Codex Extras is an independent, unofficial open-source project. It is not affiliated with, endorsed by, or sponsored by OpenAI. Codex, OpenAI, ChatGPT, and related marks are trademarks of their respective owners.

## License

[MIT](LICENSE)
