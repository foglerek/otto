import { ensureRepoSetup } from "../../repo-setup.js";
import { listRuns } from "../../runs/listing.js";
import { output } from "../output.js";
import { loadConfigFromCwd } from "../config.js";

export async function handleActiveCommand(): Promise<void> {
  const { config } = await loadConfigFromCwd();

  const mainRepoPath = await config.worktree.adapter.getMainRepoPath(process.cwd());
  const { artifactPaths } = await ensureRepoSetup({ mainRepoPath, config });
  const runs = await listRuns({ artifactRootDir: artifactPaths.rootDir });
  const active = runs.filter((r) => r.process.status === "active");
  if (active.length === 0) {
    output({ action: "active", runs: [] }, ["No active runs.", ""]);
    return;
  }
  output(
    {
      action: "active",
      runs: active.map((r) => ({ runId: r.state.runId })),
    },
    ["Active runs:", ...active.map((r) => `- ${r.state.runId}`), ""],
  );
}
