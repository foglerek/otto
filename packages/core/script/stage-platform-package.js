#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const corePkgDir = path.resolve(repoRoot, "packages", "core");

const platform = process.platform === "win32" ? "windows" : process.platform;
const arch = process.arch;
const exeExt = process.platform === "win32" ? ".exe" : "";

const src = path.resolve(
  corePkgDir,
  "bin",
  `otto-${platform}-${arch}${exeExt}`,
);
if (!fs.existsSync(src)) {
  process.stderr.write(
    [`Missing ${src}.`, 'Run "bun run otto:compile" first.', ""].join("\n"),
  );
  process.exit(1);
}

const targetPkgDir = path.resolve(
  repoRoot,
  "packages",
  `core-${platform}-${arch}`,
);
if (!fs.existsSync(path.join(targetPkgDir, "package.json"))) {
  process.stderr.write(
    [
      `Missing ${path.join(targetPkgDir, "package.json")}.`,
      "This repo expects a platform package directory to exist.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const outDir = path.resolve(targetPkgDir, "bin");
fs.mkdirSync(outDir, { recursive: true });
const dest = path.resolve(outDir, `otto${exeExt}`);
fs.copyFileSync(src, dest);
if (process.platform !== "win32") {
  fs.chmodSync(dest, 0o755);
}

process.stdout.write(
  [`Staged binary:`, `- from: ${src}`, `- to:   ${dest}`, ""].join("\n"),
);
