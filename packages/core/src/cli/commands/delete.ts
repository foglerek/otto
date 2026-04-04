import { ensureRepoSetup } from "../../repo-setup.js";
import { listRuns } from "../../runs/listing.js";
import { deleteManagedRun } from "../../services/actions.js";
import { output, fail } from "../output.js";
import { loadConfigFromCwd } from "../config.js";
import { resolveStateFilePath } from "./common.js";
import { pathExists } from "../utils.js";

function resolveRunIdForDelete(arg: string, stateFilePath: string): string {
  if (!arg.includes("/") && !arg.includes("\\") && !arg.endsWith(".json")) {
    return arg;
  }

  const name = stateFilePath.split(/[\\/]/).pop() ?? "";
  return name.replace(/^run-/, "").replace(/\.json$/, "");
}

export async function handleDeleteCommand(args: string[]): Promise<void> {
  const { config } = await loadConfigFromCwd();

  const mainRepoPath = await config.worktree.adapter.getMainRepoPath(process.cwd());
  const { artifactPaths } = await ensureRepoSetup({ mainRepoPath, config });

  const arg = (args[0] ?? "").trim();
  if (!arg) {
    const runs = await listRuns({ artifactRootDir: artifactPaths.rootDir });
    if (runs.length === 0) {
      output({ action: "delete", runs: [] }, ["No runs found.", ""]);
      return;
    }
    output(
      {
        action: "delete",
        runs: runs.map((r) => ({
          runId: r.state.runId,
          active: r.process.status === "active",
        })),
        error: "otto delete requires <ticket|state>",
      },
      [
        "Runs:",
        ...runs.map((r) => `- ${r.state.runId}${r.process.status === "active" ? " (active)" : ""}`),
        "",
        "otto delete requires <ticket|state>",
        "",
      ],
    );
    process.exitCode = 1;
    return;
  }

  const stateFilePath = resolveStateFilePath({
    arg,
    artifactRootDir: artifactPaths.rootDir,
  });

  if (!(await pathExists(stateFilePath))) {
    const runs = await listRuns({ artifactRootDir: artifactPaths.rootDir });
    const candidates = runs.map((r) => r.state.runId);
    const suffix =
      candidates.length > 0
        ? `\nKnown runs:\n${candidates.map((id) => `- ${id}`).join("\n")}`
        : "";
    fail(`State not found: ${arg}${suffix}`);
    return;
  }

  const result = await deleteManagedRun({
    cwd: process.cwd(),
    runId: resolveRunIdForDelete(arg, stateFilePath),
  });

  output(
    {
      action: "delete",
      runId: result.runId,
      preservedTicketPath: result.preservedTicketPath,
    },
    [
      `Deleted run: ${result.runId}`,
      `Preserved ticket: ${result.preservedTicketPath}`,
      "",
    ],
  );
}
