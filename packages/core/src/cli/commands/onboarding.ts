import process from "node:process";

import { ensureRepoSetup } from "../../repo-setup.js";
import { loadConfigFromCwd } from "../config.js";
import { output } from "../output.js";
import { getProjectLeadRunner } from "../runner-gating.js";

function formatRoleRunners(configByRole: Record<string, { id?: string }>): string {
  const entries = Object.entries(configByRole);
  if (entries.length === 0) {
    return "(none)";
  }
  return entries
    .map(([role, runner]) => `${role}=${runner.id ?? "(unknown)"}`)
    .join(", ");
}

function formatSubagentRoles(subagentByRole: Record<string, { id?: string }>): string {
  const entries = Object.entries(subagentByRole);
  if (entries.length === 0) {
    return "(none)";
  }
  return entries
    .map(([role, runner]) => `${role}=${runner.id ?? "(unknown)"}`)
    .join(", ");
}

export async function handleOnboardingCommand(): Promise<void> {
  const { config, configPath } = await loadConfigFromCwd();
  const mainRepoPath = await config.worktree.adapter.getMainRepoPath(process.cwd());
  const { artifactPaths, worktreesDir } = await ensureRepoSetup({
    mainRepoPath,
    config,
  });

  const hasUsableProjectLeadRunner = Boolean(getProjectLeadRunner(config));
  const roleRunners = formatRoleRunners(config.runners.byRole ?? {});
  const subagentRunners = formatSubagentRoles(config.subagents?.byRole ?? {});

  output(
    {
      action: "onboarding",
      path: configPath,
      mainRepoPath,
      artifactRootDir: artifactPaths.rootDir,
      worktreesDir,
      defaultRunner: config.runners.default.id,
      roleRunners,
      projectLeadRunnerUsable: hasUsableProjectLeadRunner,
      subagentsEnabled: config.subagents?.enabled ?? false,
      subagentRoleRunners: subagentRunners,
    },
    [
      "Otto onboarding:",
      `- Config: ${configPath}`,
      `- Main repo: ${mainRepoPath}`,
      `- Artifact root: ${artifactPaths.rootDir}`,
      `- Worktrees dir: ${worktreesDir}`,
      `- Default runner: ${config.runners.default.id}`,
      `- Role runners: ${roleRunners}`,
      `- Project lead runner usable: ${hasUsableProjectLeadRunner ? "yes" : "no"}`,
      `- Subagents enabled: ${config.subagents?.enabled ? "yes" : "no"}`,
      `- Subagent role runners: ${subagentRunners}`,
      "",
      "Next:",
      "1) otto create \"<ticket request>\"",
      "2) otto start <ticket-id>",
      "3) otto active",
      "",
    ],
  );
}
