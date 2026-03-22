import type { OttoWorkflowRuntime } from "../runtime.js";
import {
  ensureDecisionCards,
  generateDecisionCards,
  type DecisionCardsDocument,
} from "../decision-cards.js";
import { reviewDecisionCards } from "../decision-card-review.js";
import { fileExistsAndHasContent } from "../file-utils.js";
import {
  ensureSentinelWithMicroRetry,
  sessionMicroRetry,
} from "../micro-retry.js";
import { getTechLeadSystemReminder } from "../system-reminders.js";
import {
  getDecisionCardsPath,
  getPlanFilePath,
  toWorktreePath,
} from "../paths.js";
import {
  getDecisionCardsMaxIterations,
  maybeAutoRetry,
} from "../retry-policy.js";
import { dispatchWorkflowAction } from "../state-reducer.js";

function buildDecisionCardFeedback(summary: {
  openQuestions: Array<{ id: string; question: string; answer: string }>;
  decisionFeedback: Array<{
    id: string;
    proposedChange: string;
    feedback: string;
  }>;
}): string {
  const blocks: string[] = [];
  if (summary.openQuestions.length > 0) {
    blocks.push("Open questions:");
    for (const q of summary.openQuestions) {
      blocks.push(`- ${q.id}: ${q.question}`);
      blocks.push(`  Answer: ${q.answer}`);
    }
  }
  if (summary.decisionFeedback.length > 0) {
    blocks.push("Decision feedback:");
    for (const d of summary.decisionFeedback) {
      blocks.push(`- ${d.id}: ${d.proposedChange}`);
      blocks.push(`  Feedback: ${d.feedback}`);
    }
  }
  return blocks.join("\n");
}

async function applyDecisionCardsPlanUpdate(args: {
  runtime: OttoWorkflowRuntime;
  planFilePath: string;
  decisionCardsPath: string;
  feedbackInput: string;
  existingCards: DecisionCardsDocument;
}): Promise<void> {
  const feedbackPrompt = [
    getTechLeadSystemReminder(args.runtime, "planning"),
    "<INSTRUCTIONS>",
    `Update ${args.planFilePath} based on decision card feedback in <INPUT>.`,
    "Reply <OK> when done.",
    "</INSTRUCTIONS>",
    "<INPUT>",
    args.feedbackInput,
    "</INPUT>",
  ].join("\n");

  while (true) {
    const runOnce = async (sessionId?: string) =>
      await args.runtime.runners.lead.run({
        role: "lead",
        phaseName: "decision-cards-feedback",
        prompt: feedbackPrompt,
        cwd: args.runtime.state.worktree.worktreePath,
        exec: args.runtime.exec,
        sessionId,
        timeoutMs: 10 * 60_000,
      });

    let sessionId = args.runtime.state.workflow?.techLeadSessionId;
    let result = await runOnce(sessionId);
    if (sessionId && result.contextOverflow) {
      await dispatchWorkflowAction(args.runtime.stateStore, {
        type: "set-tech-lead-session",
        sessionId: null,
        defaultPhase: "decision-cards",
      });
      sessionId = undefined;
      result = await runOnce(undefined);
    }

    if (!result.success) {
      const retry = await maybeAutoRetry({
        runtime: args.runtime,
        label: "Decision card feedback",
        defaultPhase: "decision-cards",
      });
      if (!retry) {
        throw new Error(result.error ?? "Decision card feedback failed.");
      }
      continue;
    }

    const ok = await ensureSentinelWithMicroRetry({
      runtime: args.runtime,
      role: "lead",
      sessionId: result.sessionId ?? sessionId ?? null,
      outputText: result.outputText,
      message: "Reply with <OK> only when the plan update is complete.",
    });
    if (!ok) {
      const retry = await maybeAutoRetry({
        runtime: args.runtime,
        label: "Decision card feedback",
        defaultPhase: "decision-cards",
      });
      if (!retry) {
        throw new Error("Decision card feedback missing <OK> sentinel.");
      }
      continue;
    }

    const planOk = await ensurePlanInMainRepo({
      runtime: args.runtime,
      planFilePath: args.planFilePath,
      sessionIdForRetry: result.sessionId ?? sessionId ?? null,
    });
    if (!planOk) {
      const retry = await maybeAutoRetry({
        runtime: args.runtime,
        label: "Decision card feedback",
        defaultPhase: "decision-cards",
      });
      if (!retry) {
        throw new Error("Decision card feedback missing updated plan file.");
      }
      continue;
    }

    await dispatchWorkflowAction(args.runtime.stateStore, {
      type: "set-tech-lead-session",
      sessionId: result.sessionId ?? null,
      defaultPhase: "decision-cards",
    });

    await generateDecisionCards({
      runtime: args.runtime,
      planFilePath: args.planFilePath,
      decisionCardsPath: args.decisionCardsPath,
      existingCards: args.existingCards,
    });

    return;
  }
}

async function ensurePlanInMainRepo(args: {
  runtime: OttoWorkflowRuntime;
  planFilePath: string;
  sessionIdForRetry: string | null;
}): Promise<boolean> {
  if (fileExistsAndHasContent(args.planFilePath)) return true;
  const worktreePlanPath = toWorktreePath({
    state: args.runtime.state,
    mainRepoFilePath: args.planFilePath,
  });
  if (worktreePlanPath && fileExistsAndHasContent(worktreePlanPath)) {
    args.runtime.reminders.techLead.push(
      `You wrote Otto artifacts under the worktree. Create/update the file at: ${args.planFilePath}`,
    );
    const ok = await sessionMicroRetry({
      runtime: args.runtime,
      role: "lead",
      sessionId: args.sessionIdForRetry,
      message: `Move or recreate the plan at ${args.planFilePath} and reply with <OK>.`,
    });
    return ok && fileExistsAndHasContent(args.planFilePath);
  }
  return false;
}

export async function runDecisionCardsGatePhase(args: {
  runtime: OttoWorkflowRuntime;
}): Promise<void> {
  const planFilePath = getPlanFilePath(args.runtime.state);
  const decisionCardsPath = getDecisionCardsPath(args.runtime.state);

  let attempt = 0;
  const maxIterations = getDecisionCardsMaxIterations(args.runtime);
  while (attempt < maxIterations) {
    attempt += 1;
    const decisionCards = await ensureDecisionCards({
      runtime: args.runtime,
      planFilePath,
      decisionCardsPath,
    });

    const reviewSummary = await reviewDecisionCards({
      runtime: args.runtime,
      decisionCards,
      decisionCardsPath,
    });

    if (!reviewSummary.needsPlanUpdate) {
      return;
    }

    const feedbackInput = buildDecisionCardFeedback(reviewSummary);

    await applyDecisionCardsPlanUpdate({
      runtime: args.runtime,
      planFilePath,
      decisionCardsPath,
      feedbackInput,
      existingCards: reviewSummary.updatedCards,
    });
  }

  throw new Error("Decision cards gate exceeded max iterations.");
}
