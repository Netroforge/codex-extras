import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const tag = process.argv[2];
assert.ok(tag, "Usage: node scripts/check-release.mjs <tag>");

const manifest = JSON.parse(await readFile("package.json", "utf8"));
assert.equal(
  tag,
  `v${manifest.version}`,
  `Tag ${tag} does not match package version ${manifest.version}`,
);

console.log(`Release tag ${tag} matches package version ${manifest.version}.`);
