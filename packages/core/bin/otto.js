#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

function isRunnable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    if (process.platform !== "win32") {
      fs.accessSync(filePath, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const platform = process.platform === "win32" ? "windows" : process.platform;
const arch = process.arch;
const exeExt = process.platform === "win32" ? ".exe" : "";

function resolveInstalledBinary(pkgName) {
  try {
    const pkgJsonPath = require.resolve(`${pkgName}/package.json`);
    const pkgDir = path.dirname(pkgJsonPath);
    const binPath = path.join(pkgDir, "bin", `otto${exeExt}`);
    return isRunnable(binPath) ? binPath : null;
  } catch {
    return null;
  }
}

const candidates = [];
if (process.env.OTTO_BIN_PATH) {
  candidates.push(process.env.OTTO_BIN_PATH);
}

// Installed optional dependency (published binary package).
const platformPackageName = `@otto/core-${platform}-${arch}`;
const installed = resolveInstalledBinary(platformPackageName);
if (installed) {
  candidates.push(installed);
}

// Local dev/default build output.
candidates.push(path.join(__dirname, `otto-${platform}-${arch}${exeExt}`));

const args = process.argv.slice(2);
for (const candidate of candidates) {
  if (!candidate) continue;
  if (!isRunnable(candidate)) continue;

  const result = spawnSync(candidate, args, {
    stdio: "inherit",
    windowsHide: true,
  });

  process.exit(result.status ?? 1);
}

process.stderr.write(
  [
    "Otto binary not found.",
    "",
    "If developing locally:",
    "  bun run otto:compile",
    "",
    "If installed from npm, your platform package may be missing:",
    `  expected optional dependency: ${platformPackageName}`,
    "",
    "Or set an explicit path:",
    "  OTTO_BIN_PATH=/path/to/otto-<platform>-<arch> otto ...",
    "",
  ].join("\n"),
);
process.exit(1);
