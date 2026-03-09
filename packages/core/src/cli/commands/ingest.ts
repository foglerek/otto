import { ensureRepoSetup } from "../../repo-setup.js";
import { output, fail, failNoRunner } from "../output.js";
import { loadConfigFromCwd } from "../config.js";
import { getProjectLeadRunner } from "../runner-gating.js";
import { runTicketIngest } from "./tickets.js";

export async function handleIngestCommand(args: string[]): Promise<void> {
  const sourceFilePath = args.join(" ").trim();
  if (!sourceFilePath) {
    fail("otto ingest requires <path-to-ticket>");
    return;
  }

  const { config } = await loadConfigFromCwd();
  const runner = getProjectLeadRunner(config);
  if (!runner) {
    failNoRunner();
    return;
  }

  const repoPath = await config.worktree.adapter.getMainRepoPath(process.cwd());
  await ensureRepoSetup({ mainRepoPath: repoPath, config });
  const result = await runTicketIngest({
    repoPath,
    runner,
    sourceFilePath,
  });

  output(
    {
      action: "ingest",
      ticketId: result.ticketId,
      filePath: result.filePath,
    },
    ["Ticket ingested.", `- Id: ${result.ticketId}`, `- Path: ${result.filePath}`, ""],
  );
}
