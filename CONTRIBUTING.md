# Contributing

Thanks for helping improve Codex Extras.

## Development

Requirements:

- Node.js 22 or newer
- npm
- Visual Studio Code
- The official `openai.chatgpt` extension

Install dependencies and run the checks:

```sh
npm ci
npm test
```

Package an installable development build:

```sh
npm run package
```

Install the resulting `.vsix` from the Extensions view with **Install from VSIX...**.

## Changes

1. Open an issue for substantial features before implementation.
2. Keep each pull request focused.
3. Add or update validation for manifest behavior.
4. Update `README.md` and `CHANGELOG.md` when behavior changes.
5. Run `npm test` and `npm run package` before opening a pull request.

By contributing, you agree that your contribution is licensed under the MIT License.
