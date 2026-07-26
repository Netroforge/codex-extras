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

const editorTitleItems = manifest.contributes?.menus?.["editor/title"] ?? [];
const newAgentButton = editorTitleItems.find(
  ({ command }) => command === "chatgpt.newCodexPanel",
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
