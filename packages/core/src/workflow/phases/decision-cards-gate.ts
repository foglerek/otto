import type { OttoWorkflowRuntime } from "../runtime.js";
import {
  ensureDecisionCards,
  generateDecisionCards,
} from "../decision-cards.js";
import { reviewDecisionCards } from "../decision-card-review.js";
import { getTechLeadSystemReminder } from "../system-reminders.js";
import { getDecisionCardsPath, getPlanFilePath } from "../paths.js";

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

async function maybeRetry(
  runtime: OttoWorkflowRuntime,
  label: string,
): Promise<boolean> {
  const wf = runtime.state.workflow;
  const tries = wf?.autoRetryCounts?.[label] ?? 0;
  const maxAuto = 2;
  if (tries < maxAuto) {
    if (wf) {
      wf.autoRetryCounts = wf.autoRetryCounts ?? {};
      wf.autoRetryCounts[label] = tries + 1;
      await runtime.stateStore.save();
    }
    return true;
  }

  return await runtime.prompt.confirm(`${label} failed. Retry?`, {
    defaultValue: true,
  });
}

export async function runDecisionCardsGatePhase(args: {
  runtime: OttoWorkflowRuntime;
}): Promise<void> {
  const planFilePath = getPlanFilePath(args.runtime.state);
  const decisionCardsPath = getDecisionCardsPath(args.runtime.state);

  let attempt = 0;
  while (attempt < 5) {
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
    const feedbackPrompt = [
      getTechLeadSystemReminder(args.runtime, "planning"),
      "<INSTRUCTIONS>",
      `Update ${planFilePath} based on decision card feedback in <INPUT>.`,
      "Reply <OK> when done.",
      "</INSTRUCTIONS>",
      "<INPUT>",
      feedbackInput,
      "</INPUT>",
    ].join("\n");

    while (true) {
      const result = await args.runtime.runners.lead.run({
        role: "lead",
        phaseName: "decision-cards-feedback",
        prompt: feedbackPrompt,
        cwd: args.runtime.state.worktree.worktreePath,
        exec: args.runtime.exec,
        sessionId: args.runtime.state.workflow?.techLeadSessionId,
        timeoutMs: 10 * 60_000,
      });

      if (!result.success) {
        const retry = await maybeRetry(args.runtime, "Decision card feedback");
        if (!retry) {
          throw new Error(result.error ?? "Decision card feedback failed.");
        }
        continue;
      }

      if (args.runtime.state.workflow) {
        args.runtime.state.workflow.techLeadSessionId = result.sessionId;
        await args.runtime.stateStore.save();
      }

      await generateDecisionCards({
        runtime: args.runtime,
        planFilePath,
        decisionCardsPath,
        existingCards: reviewSummary.updatedCards,
      });

      break;
    }
  }

  throw new Error("Decision cards gate exceeded max iterations.");
}
