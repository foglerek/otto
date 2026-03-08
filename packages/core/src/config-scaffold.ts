import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_CONFIG = `import { defineOttoConfig } from "@otto/config";
import { createGitWorktreeAdapter } from "@otto/adapter-git-worktree";
import { createEchoRunner } from "@otto/runner-echo";

export default defineOttoConfig({
  worktree: {
    baseBranch: "main",
    branchNamer: ({ ticket }) => \`otto-\${ticket.date}-\${ticket.slug}\`,
    adapter: createGitWorktreeAdapter(),
    afterCreate: async () => {},
  },
  runners: {
    default: createEchoRunner(),
  },
});
`;

export async function ensureDefaultConfigFile(configPath: string): Promise<boolean> {
  try {
    await fs.stat(configPath);
    return false;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw error;
  }

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  try {
    await fs.writeFile(configPath, DEFAULT_CONFIG, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "EEXIST") return false;
    throw error;
  }
}
