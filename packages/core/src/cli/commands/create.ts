import { ensureRepoSetup } from "../../repo-setup.js";
import { output, fail, failNoRunner } from "../output.js";
import { loadConfigFromCwd } from "../config.js";
import { getProjectLeadRunner } from "../runner-gating.js";
import { runTicketCreate } from "./tickets.js";

export async function handleCreateCommand(args: string[]): Promise<void> {
  const ticketText = args.join(" ").trim();
  if (!ticketText) {
    fail("otto create requires <ticket-prompt>");
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
  const result = await runTicketCreate({
    repoPath,
    runner,
    ticketText,
  });

  output(
    {
      action: "create",
      ticketId: result.ticketId,
      filePath: result.filePath,
    },
    ["Ticket created.", `- Id: ${result.ticketId}`, `- Path: ${result.filePath}`, ""],
  );
}
