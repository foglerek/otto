#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgDir = path.resolve(__dirname, "..");

const entrypoint = path.resolve(pkgDir, "dist/cli.js");
if (!fs.existsSync(entrypoint)) {
  process.stderr.write(
    `Missing ${entrypoint}. Run \"bun run build\" (or \"bun run otto:build\") first.\n`,
  );
  process.exit(1);
}

const binDir = path.resolve(pkgDir, "bin");
fs.mkdirSync(binDir, { recursive: true });

const platform = process.platform === "win32" ? "windows" : process.platform;
const arch = process.arch;
const exeExt = process.platform === "win32" ? ".exe" : "";
const outfile = path.resolve(binDir, `otto-${platform}-${arch}${exeExt}`);

const result = spawnSync(
  "bun",
  ["build", "--compile", entrypoint, "--outfile", outfile],
  {
    stdio: "inherit",
    windowsHide: true,
  },
);

process.exit(result.status ?? 1);
