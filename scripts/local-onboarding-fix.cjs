"use strict";

// Local repair for OpenAI's extension, NOT part of the Codex Extras runtime.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const version = "26.1007.21434";
const guardBefore = "function FGi(){let{data:e,isLoading:t}=UC(hs.NUX_2025_09_15),{authMethod:n}=Lf();if(!t)return e||n==null?`none`:n===`chatgptAuthTokens`||n===`chatgpt`?`2025-09-15-full-chatgpt-auth`:`2025-09-15-apikey-auth`}";
const guardAfter = guardBefore.replace("isLoading:t", "isSuccess:t").replace("if(!t)", "if(t)");
const pageBefore = "let s=h(),l;e[0]!==s||e[1]!==n||e[2]!==t?";
const pageAfter = "let s=h(),l;X.useEffect(()=>{if(n===`none`)s(`/`)},[n,s]);e[0]!==s||e[1]!==n||e[2]!==t?";
const patches = [
  { file: "app-initial-c014f9ee4429.js", before: guardBefore, after: guardAfter },
  { file: "first-run-afdf3f60ec3c.js", before: pageBefore, after: pageAfter },
];

function transform(source, before, after) {
  if (source.includes(after) && !source.includes(before)) return source;
  if (source.split(before).length !== 2 || source.includes(after)) {
    throw new Error("Unrecognized extension code; refusing to patch");
  }
  return source.replace(before, after);
}

function apply(extensionDirectory, restore = false) {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionDirectory, "package.json"), "utf8"));
  if (manifest.publisher !== "openai" || manifest.name !== "chatgpt" || manifest.version !== version) {
    throw new Error(`Repair supports only openai.chatgpt ${version}`);
  }
  // Validate BOTH files before writing either one. Never overwrite a backup.
  const changes = patches.map(({ file, before, after }) => {
    const target = path.join(extensionDirectory, "webview", "assets", file);
    const backup = `${target}.codex-extras-nux-backup`;
    const original = fs.readFileSync(target, "utf8");
    const repaired = transform(original, before, after);
    if (restore) {
      const saved = fs.readFileSync(backup, "utf8");
      if (transform(saved, before, after) !== original) throw new Error("File changed since repair; refusing restore");
      return { target, content: saved };
    }
    if (fs.existsSync(backup)) {
      if (transform(fs.readFileSync(backup, "utf8"), before, after) !== repaired) {
        throw new Error("Backup does not match installed extension");
      }
    } else if (original !== repaired) {
      return { target, backup, original, content: repaired };
    }
    return { target, content: repaired };
  });
  for (const change of changes) {
    if (change.backup) fs.writeFileSync(change.backup, change.original, { flag: "wx" });
    fs.writeFileSync(change.target, change.content);
    console.log(`${restore ? "Restored" : "Patched"} ${path.basename(change.target)} sha256=${crypto.createHash("sha256").update(change.content).digest("hex")}`);
  }
}

if (require.main === module) {
  if (!process.argv[2]) throw new Error("Usage: node scripts/local-onboarding-fix.cjs EXTENSION_DIRECTORY [--restore]");
  apply(path.resolve(process.argv[2]), process.argv.includes("--restore"));
}

module.exports = { apply, transform, patches, guardBefore, guardAfter, pageAfter, version };
