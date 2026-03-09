import process from "node:process";

import { ensureRepoSetup } from "../../repo-setup.js";
import { listManagedTicketIds } from "../../tickets/list.js";
import { listRuns } from "../../runs/listing.js";
import { printNonInteractiveSnippet, failNoRunner } from "../output.js";
import { loadConfigFromCwd, getPromptAdapter, isInteractiveAvailable } from "../config.js";
import { getProjectLeadRunner } from "../runner-gating.js";
import { LOGO } from "../logo.js";
import { handleConfigCommand } from "./config.js";
import { handleStartCommand } from "./start.js";
import { handleResumeCommand } from "./resume.js";
import { handleDeleteCommand } from "./delete.js";
import { handleOnboardingCommand } from "./onboarding.js";
import { runTicketAmend, runTicketCreate } from "./tickets.js";

export async function handleRootCommand(): Promise<void> {
  if (!isInteractiveAvailable()) {
    printNonInteractiveSnippet();
    process.exitCode = 1;
    return;
  }

  const { config } = await loadConfigFromCwd();
  const runner = getProjectLeadRunner(config);
  if (!runner) {
    failNoRunner();
    return;
  }

  const mainRepoPath = await config.worktree.adapter.getMainRepoPath(process.cwd());
  const { artifactPaths } = await ensureRepoSetup({ mainRepoPath, config });
  const prompt = await getPromptAdapter(config);

  while (true) {
    const action = await prompt.select([LOGO, "", "Select an action:"].join("\n"), {
      choices: [
        "Create Ticket",
        "Start Run",
        "Resume Run",
        "Delete Run",
        "Onboarding",
        "Config",
        "Exit",
      ],
    });

    if (action === "Exit") return;

    if (action === "Config") {
      await handleConfigCommand();
      continue;
    }

    if (action === "Onboarding") {
      await handleOnboardingCommand();
      continue;
    }

    if (action === "Create Ticket") {
      const ticketText = (await prompt.text("Enter ticket request:", {})).trim();
      if (!ticketText) continue;
      const created = await runTicketCreate({
        repoPath: mainRepoPath,
        runner,
        ticketText,
      });
      const next = await prompt.select(`Ticket created: ${created.ticketId}`, {
        choices: ["Start Run", "Amend Ticket", "Back"],
      });
      if (next === "Start Run") {
        await handleStartCommand([created.ticketId]);
      }
      if (next === "Amend Ticket") {
        const amendInstructions = (await prompt.text("Amend instructions:", {})).trim();
        if (!amendInstructions) continue;
        await runTicketAmend({
          repoPath: mainRepoPath,
          runner,
          ticketId: created.ticketId,
          amendInstructions,
        });
      }
      continue;
    }

    if (action === "Start Run") {
      const tickets = await listManagedTicketIds(mainRepoPath);
      const runs = await listRuns({ artifactRootDir: artifactPaths.rootDir });
      const started = new Set(runs.map((r) => r.state.runId));
      const available = tickets.filter((t) => !started.has(t));
      if (available.length === 0) {
        await prompt.confirm("No tickets available to start.", { defaultValue: true });
        continue;
      }
      const ticketId = await prompt.select("Select a ticket:", { choices: available });
      await handleStartCommand([ticketId]);
      continue;
    }

    if (action === "Resume Run") {
      const runs = await listRuns({ artifactRootDir: artifactPaths.rootDir });
      const inactive = runs.filter((r) => r.process.status !== "active");
      if (inactive.length === 0) {
        await prompt.confirm("No resumable runs.", { defaultValue: true });
        continue;
      }
      const runId = await prompt.select("Select a run:", {
        choices: inactive.map((r) => r.state.runId),
      });
      await handleResumeCommand([runId]);
      continue;
    }

    if (action === "Delete Run") {
      const runs = await listRuns({ artifactRootDir: artifactPaths.rootDir });
      if (runs.length === 0) {
        await prompt.confirm("No runs to delete.", { defaultValue: true });
        continue;
      }
      const runId = await prompt.select("Select a run to delete:", {
        choices: runs.map((r) => r.state.runId),
      });
      const ok = await prompt.confirm(`Delete run ${runId}? (ticket will be preserved)`, {
        defaultValue: false,
      });
      if (!ok) continue;
      await handleDeleteCommand([runId]);
      continue;
    }
  }
}
