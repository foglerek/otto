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
import {
  ensureSentinelWithMicroRetry,
  techLeadMicroRetry,
} from "../micro-retry.js";
import { generateDecisionCards } from "../decision-cards.js";
import { dispatchWorkflowAction } from "../state-reducer.js";
import { emitRunEvent } from "../events.js";

function previewForEvent(text: string | undefined, maxChars = 800): string {
  const value = (text ?? "").trim();
  if (value.length <= maxChars) {
    return value;
  }
  const half = Math.floor(maxChars / 2);
  const hidden = value.length - half * 2;
  return [
    value.slice(0, half),
    `\n...[truncated ${hidden} chars]...\n`,
    value.slice(value.length - half),
  ].join("");
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
  const runDir = getRunDir(args.runtime.state);
  const planFilePath = getPlanFilePath(args.runtime.state);
  const decisionCardsPath = getDecisionCardsPath(args.runtime.state);

  await dispatchWorkflowAction(args.runtime.stateStore, {
    type: "set-workflow-artifact-paths",
    runDir,
    planFilePath,
    decisionCardsPath,
    defaultPhase: "ticket-created",
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

  let sessionId = args.runtime.state.workflow?.techLeadSessionId;
  let result = await runOnce(sessionId);
  if (sessionId && result.contextOverflow) {
    await dispatchWorkflowAction(args.runtime.stateStore, {
      type: "set-tech-lead-session",
      sessionId: null,
      defaultPhase: "ticket-created",
    });
    sessionId = undefined;
    result = await runOnce(undefined);
  }

  await emitRunEvent({
    logger: args.runtime.events,
    runId: args.runtime.state.runId,
    type: "ticket_ingestion_runner_result",
    data: {
      success: result.success,
      timedOut: result.timedOut ?? false,
      contextOverflow: result.contextOverflow ?? false,
      outputChars: (result.outputText ?? "").length,
      outputPreview: previewForEvent(result.outputText),
      returnedSessionId: result.sessionId ?? null,
      resumedSessionId: sessionId ?? null,
    },
  });

  if (!result.success) {
    await emitRunEvent({
      logger: args.runtime.events,
      runId: args.runtime.state.runId,
      type: "ticket_ingestion_failed_before_artifact",
      data: {
        error: result.error ?? "Ticket ingestion failed.",
        outputPreview: previewForEvent(result.outputText),
      },
    });
    throw new Error(result.error ?? "Ticket ingestion failed.");
  }

  const hasSentinel = await ensureSentinelWithMicroRetry({
    runtime: args.runtime,
    role: "lead",
    sessionId: result.sessionId ?? sessionId ?? null,
    outputText: result.outputText,
    message: "Reply with <OK> only when ticket ingestion is complete.",
  });

  await emitRunEvent({
    logger: args.runtime.events,
    runId: args.runtime.state.runId,
    type: "ticket_ingestion_sentinel_check",
    data: {
      hasSentinel,
      sessionIdAvailable: Boolean(result.sessionId ?? sessionId),
    },
  });

  const persistedLeadSessionId =
    result.sessionId ?? args.runtime.state.workflow?.techLeadSessionId ?? null;
  await dispatchWorkflowAction(args.runtime.stateStore, {
    type: "set-tech-lead-session",
    sessionId: persistedLeadSessionId,
    defaultPhase: "ticket-created",
  });

  if (!fileExistsAndHasContent(planFilePath)) {
    const worktreePlanFilePath = getWorktreePlanFilePath(args.runtime.state);
    const worktreePlanExists = fileExistsAndHasContent(worktreePlanFilePath);
    await emitRunEvent({
      logger: args.runtime.events,
      runId: args.runtime.state.runId,
      type: "ticket_ingestion_plan_check",
      data: {
        planFilePath,
        worktreePlanFilePath,
        mainPlanExists: false,
        worktreePlanExists,
      },
    });

    if (worktreePlanExists) {
      args.runtime.reminders.techLead.push(
        `You wrote Otto artifacts under the worktree. All artifacts must be written under the main repo .otto. Move or recreate the plan at: ${planFilePath}`,
      );
      let retrySucceeded = false;
      try {
        await techLeadMicroRetry({
          runtime: args.runtime,
          message: `Move or recreate the plan file at the correct path: ${planFilePath}`,
        });
        retrySucceeded = true;
      } catch {
        // Ignore retry failure; artifact validation below remains authoritative.
      }

      const planExistsAfterRetry = fileExistsAndHasContent(planFilePath);
      await emitRunEvent({
        logger: args.runtime.events,
        runId: args.runtime.state.runId,
        type: "ticket_ingestion_wrong_directory_retry",
        data: {
          retrySucceeded,
          planExistsAfterRetry,
          techLeadSessionId: args.runtime.state.workflow?.techLeadSessionId ?? null,
        },
      });
    }
  }

  if (!fileExistsAndHasContent(planFilePath)) {
    let retrySucceeded = false;
    args.runtime.reminders.techLead.push(
      `Ticket ingestion is incomplete until the plan is written at: ${planFilePath}`,
    );
    try {
      await techLeadMicroRetry({
        runtime: args.runtime,
        message: `Create the plan file at ${planFilePath} with context, assumptions, and acceptance criteria.`,
      });
      retrySucceeded = true;
    } catch {
      // Retry failure is captured by artifact checks below.
    }

    const planExistsAfterRetry = fileExistsAndHasContent(planFilePath);
    await emitRunEvent({
      logger: args.runtime.events,
      runId: args.runtime.state.runId,
      type: "ticket_ingestion_missing_plan_retry",
      data: {
        retrySucceeded,
        planExistsAfterRetry,
        techLeadSessionId: args.runtime.state.workflow?.techLeadSessionId ?? null,
      },
    });
  }

  if (!fileExistsAndHasContent(planFilePath)) {
    const worktreePlanFilePath = getWorktreePlanFilePath(args.runtime.state);
    const worktreePlanExists = fileExistsAndHasContent(worktreePlanFilePath);
    await emitRunEvent({
      logger: args.runtime.events,
      runId: args.runtime.state.runId,
      type: "ticket_ingestion_failed_plan_missing",
      data: {
        planFilePath,
        worktreePlanFilePath,
        worktreePlanExists,
        techLeadSessionId: args.runtime.state.workflow?.techLeadSessionId ?? null,
      },
    });
    throw new Error(`Plan file missing or empty: ${planFilePath}`);
  }

  if (!hasSentinel) {
    args.runtime.reminders.techLead.push(
      "Your previous response missed the required <OK> sentinel. End planning responses with <OK> after artifacts are complete.",
    );
  }

  await generateDecisionCards({
    runtime: args.runtime,
    planFilePath,
    decisionCardsPath,
  });
}
