import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);

assert.equal(manifest.name, "codex-extras");
assert.equal(manifest.displayName, "Codex Extras");
assert.equal(manifest.publisher, "netroforge");
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(manifest.license, "MIT");
assert.equal(manifest.repository.url, "https://github.com/netroforge/codex-extras.git");
assert.ok(manifest.extensionDependencies.includes("openai.chatgpt"));
assert.equal(manifest.main, "./extension.js");
assert.ok(
  manifest.activationEvents.includes("onCommand:codexExtras.newCodexAgent"),
);

const newAgentCommand = manifest.contributes?.commands?.find(
  ({ command }) => command === "codexExtras.newCodexAgent",
);

assert.ok(newAgentCommand, "New Codex Agent command contribution is missing");
assert.deepEqual(newAgentCommand.icon, {
  light: "assets/toolbar-light.svg",
  dark: "assets/toolbar-dark.svg",
});

const editorTitleItems = manifest.contributes?.menus?.["editor/title"] ?? [];
const newAgentButton = editorTitleItems.find(
  ({ command }) => command === "codexExtras.newCodexAgent",
);

assert.ok(newAgentButton, "New Codex Agent toolbar contribution is missing");
assert.match(
  newAgentButton.group,
  /^navigation(?:@-?\d+)?$/,
  "Toolbar command must use the visible navigation group",
);
assert.equal(
  newAgentButton.when,
  "config.codexExtras.showNewAgentButton",
);
assert.equal(
  manifest.contributes.configuration.properties[
    "codexExtras.showNewAgentButton"
  ].default,
  true,
);

const commandPaletteItems =
  manifest.contributes?.menus?.commandPalette ?? [];
assert.ok(
  commandPaletteItems.some(
    ({ command, when }) =>
      command === "codexExtras.newCodexAgent" && when === "false",
  ),
  "Wrapper command must stay hidden from the Command Palette",
);

const extensionSource = await readFile(
  path.join(root, manifest.main),
  "utf8",
);
assert.match(
  extensionSource,
  /registerCommand\(COMMAND_ID/,
  "Extension must register its wrapper command",
);
assert.match(
  extensionSource,
  /executeCommand\(OFFICIAL_CODEX_COMMAND_ID\)/,
  "Wrapper command must delegate to the official Codex command",
);

for (const [theme, iconPath] of Object.entries(newAgentCommand.icon)) {
  const toolbarIcon = await readFile(path.join(root, iconPath), "utf8");
  assert.match(toolbarIcon, /viewBox="0 0 16 16"/);
  assert.match(toolbarIcon, /stroke-width="1\.5"/);
  assert.match(
    toolbarIcon,
    theme === "light" ? /stroke="#424242"/ : /stroke="#C5C5C5"/,
  );
}

const icon = await readFile(path.join(root, manifest.icon));
assert.equal(icon.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
assert.ok(icon.length >= 24, "Icon is not a valid PNG");
const width = icon.readUInt32BE(16);
const height = icon.readUInt32BE(20);
assert.ok(width >= 128 && height >= 128, "Marketplace icon must be at least 128px");
assert.equal(width, height, "Marketplace icon must be square");

console.log(
  `Validated ${manifest.publisher}.${manifest.name} ${manifest.version} with a ${width}x${height} icon.`,
);
