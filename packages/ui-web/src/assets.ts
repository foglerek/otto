import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { UI_WEB_STYLES } from "./styles.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(moduleDir, "..");
const bundlePath = path.join(packageRoot, "dist", "client.bundle.js");
const clientEntry = path.join(packageRoot, "src", "client.tsx");

async function ensureBundle(): Promise<void> {
  try {
    await fs.access(bundlePath);
    return;
  } catch {
    await fs.mkdir(path.dirname(bundlePath), { recursive: true });
    await build({
      entryPoints: [clientEntry],
      outfile: bundlePath,
      bundle: true,
      format: "esm",
      platform: "browser",
      target: ["es2022"],
      jsx: "automatic",
      sourcemap: false,
      minify: false,
      logLevel: "silent",
    });
  }
}

export async function loadUiWebAssets(): Promise<{
  javascript: string;
  stylesheet: string;
}> {
  await ensureBundle();
  return {
    javascript: await fs.readFile(bundlePath, "utf8"),
    stylesheet: UI_WEB_STYLES,
  };
}
