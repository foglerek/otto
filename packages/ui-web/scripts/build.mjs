import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const distDir = path.join(packageRoot, "dist");

const tsc = spawnSync("npx", ["tsc", "-p", "tsconfig.json"], {
  cwd: packageRoot,
  stdio: "inherit",
});

if (tsc.status !== 0) {
  process.exit(tsc.status ?? 1);
}

await mkdir(distDir, { recursive: true });

await build({
  entryPoints: [path.join(packageRoot, "src", "client.tsx")],
  outfile: path.join(distDir, "client.bundle.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  jsx: "automatic",
  sourcemap: false,
  minify: false,
  logLevel: "info",
});
