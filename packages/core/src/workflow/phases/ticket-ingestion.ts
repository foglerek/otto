import fs from "node:fs/promises";

import type { OttoWorkflowRuntime } from "../runtime.js";
import { getTechLeadSystemReminder } from "../system-reminders.js";
import { fileExistsAndHasContent } from "../file-utils.js";
import {
  getDecisionCardsPath,
  getPlanFilePath,
  getRunDir,
  getWorktreePlanFilePath,
} from "../paths.js";
import { sessionMicroRetry, techLeadMicroRetry } from "../micro-retry.js";
import { generateDecisionCards } from "../decision-cards.js";
import { hasOkSentinel } from "../sentinels.js";

function ensureWorkflowState(
  runtime: OttoWorkflowRuntime,
): NonNullable<OttoWorkflowRuntime["state"]["workflow"]> {
  if (!runtime.state.workflow) {
    runtime.state.workflow = {
      phase: "ticket-created",
      needsUserInput: false,
      taskQueue: [],
      taskAgentSessions: {},
      reviewerSessions: {},
    };
  }
  if (!runtime.state.workflow.phase) {
    runtime.state.workflow.phase = "ticket-created";
  }
  if (!runtime.state.workflow.taskQueue) {
    runtime.state.workflow.taskQueue = [];
  }
  if (!runtime.state.workflow.taskAgentSessions) {
    runtime.state.workflow.taskAgentSessions = {};
  }
  if (!runtime.state.workflow.reviewerSessions) {
    runtime.state.workflow.reviewerSessions = {};
  }
  return runtime.state.workflow;
}

function buildTicketIngestionPrompt(args: {
  runtime: OttoWorkflowRuntime;
  ticketText: string;
  runDir: string;
  planFilePath: string;
}): string {
  return [
    getTechLeadSystemReminder(args.runtime, "planning"),
    "",
    "<INSTRUCTIONS>",
    "1. **ALWAYS** read `@AGENTS.md` before planning or work.",
    "2. Read the user ticket in <INPUT>.",
    "3. Analyze the existing repo in the worktree.",
    `4. Create the run folder at: ${args.runDir}`,
    `5. Create the plan file at: ${args.planFilePath}`,
    "   - It should include context, assumptions, and acceptance criteria.",
    "   - It should be specific enough to drive task splitting.",
    "",
    "Reply with <OK> only when you have completed the above.",
    "</INSTRUCTIONS>",
    "",
    "<system-reminder>Use the exact paths given to you to read and write the input and output files.</system-reminder>",
    "",
    "<INPUT>",
    args.ticketText.trimEnd(),
    "</INPUT>",
    "",
  ].join("\n");
}

export async function runTicketIngestionPhase(args: {
  runtime: OttoWorkflowRuntime;
}): Promise<void> {
  const wf = ensureWorkflowState(args.runtime);

  const runDir = getRunDir(args.runtime.state);
  const planFilePath = getPlanFilePath(args.runtime.state);
  const decisionCardsPath = getDecisionCardsPath(args.runtime.state);

  await args.runtime.stateStore.update((draft) => {
    if (!draft.workflow) draft.workflow = wf;
    draft.workflow.runDir = runDir;
    draft.workflow.planFilePath = planFilePath;
    draft.workflow.decisionCardsPath = decisionCardsPath;
  });

  const ticketText = await fs.readFile(
    args.runtime.state.ticket.filePath,
    "utf8",
  );
  const prompt = buildTicketIngestionPrompt({
    runtime: args.runtime,
    ticketText,
    runDir,
    planFilePath,
  });

  const runOnce = async (sessionId?: string) =>
    await args.runtime.runners.lead.run({
      role: "lead",
      phaseName: "ticket-ingestion",
      prompt,
      cwd: args.runtime.state.worktree.worktreePath,
      exec: args.runtime.exec,
      sessionId,
      timeoutMs: 15 * 60_000,
    });

  let sessionId = wf.techLeadSessionId;
  let result = await runOnce(sessionId);
  if (sessionId && result.contextOverflow) {
    delete wf.techLeadSessionId;
    await args.runtime.stateStore.save();
    sessionId = undefined;
    result = await runOnce(undefined);
  }

  if (!result.success) {
    throw new Error(result.error ?? "Ticket ingestion failed.");
  }

  if (!hasOkSentinel(result.outputText)) {
    const ok = await sessionMicroRetry({
      runtime: args.runtime,
      role: "lead",
      sessionId: result.sessionId ?? sessionId ?? null,
      message: "Reply with <OK> only when ticket ingestion is complete.",
    });
    if (!ok) {
      throw new Error("Ticket ingestion missing <OK> sentinel.");
    }
  }

  await args.runtime.stateStore.update((draft) => {
    if (!draft.workflow) draft.workflow = wf;
    draft.workflow.techLeadSessionId = result.sessionId;
  });

  if (!fileExistsAndHasContent(planFilePath)) {
    const worktreePlanFilePath = getWorktreePlanFilePath(args.runtime.state);
    if (fileExistsAndHasContent(worktreePlanFilePath)) {
      args.runtime.reminders.techLead.push(
        `You wrote Otto artifacts under the worktree. All artifacts must be written under the main repo .otto. Move or recreate the plan at: ${planFilePath}`,
      );
      await techLeadMicroRetry({
        runtime: args.runtime,
        message: `Move or recreate the plan file at the correct path: ${planFilePath}`,
      });
    }
  }

  if (!fileExistsAndHasContent(planFilePath)) {
    throw new Error(`Plan file missing or empty: ${planFilePath}`);
  }

  await generateDecisionCards({
    runtime: args.runtime,
    planFilePath,
    decisionCardsPath,
  });
}
