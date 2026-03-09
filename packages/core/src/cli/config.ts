import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { createJiti } from "jiti";
import type { OttoConfig } from "@otto/config";
import type { OttoPromptAdapter } from "@otto/ports";

import { ensureDefaultConfigFile } from "../config-scaffold.js";
import { PromptUnavailableError } from "./output.js";
import { pathExists } from "./utils.js";

export async function findNearestOttoConfigPath(startDir: string): Promise<string> {
  let dir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(dir, "otto.config.ts");
    if (await pathExists(candidate)) {
      return candidate;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      return path.join(path.resolve(startDir), "otto.config.ts");
    }
    dir = parent;
  }
}

export async function loadConfigFromCwd(): Promise<{ config: OttoConfig; configPath: string }> {
  const configPath = await findNearestOttoConfigPath(process.cwd());
  await ensureDefaultConfigFile(configPath);
  const config = await loadOttoConfig(configPath);
  return { config, configPath };
}

export async function loadOttoConfig(configPath: string): Promise<OttoConfig> {
  const resolved = path.resolve(configPath);

  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
  });

  const mod = await jiti(pathToFileURL(resolved).href);
  const cfg = (mod?.default ?? mod) as OttoConfig;

  if (!cfg || typeof cfg !== "object") {
    throw new Error(`Invalid otto config at ${resolved}`);
  }

  return cfg;
}

export function isCi(): boolean {
  const ci = process.env.CI;
  if (!ci) return false;
  return ci.toLowerCase() === "true" || ci === "1";
}

export function hasTty(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export function isInteractiveAvailable(): boolean {
  return hasTty() && !isCi();
}

function createHeadlessPromptAdapter(): OttoPromptAdapter {
  const fail = async () => {
    throw new PromptUnavailableError();
  };
  return {
    confirm: fail,
    text: fail,
    select: fail,
  };
}

export async function getPromptAdapter(config: OttoConfig): Promise<OttoPromptAdapter> {
  if (config.prompt?.adapter) return config.prompt.adapter;
  if (!isInteractiveAvailable()) return createHeadlessPromptAdapter();

  const mod = await import("@otto/ui-opentui");
  return mod.createOpentuiPromptAdapter();
}
