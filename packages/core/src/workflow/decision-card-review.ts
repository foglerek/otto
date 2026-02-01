import type { OttoWorkflowRuntime } from "./runtime.js";
import type { DecisionCardsDocument } from "./decision-cards.js";
import {
  getDecisionCardContentHash,
  stripEmptyUserFeedback,
  writeDecisionCards,
} from "./decision-cards.js";

export interface DecisionCardReviewSummary {
  updatedCards: DecisionCardsDocument;
  needsPlanUpdate: boolean;
  openQuestions: Array<{ id: string; question: string; answer: string }>;
  decisionFeedback: Array<{
    id: string;
    proposedChange: string;
    feedback: string;
  }>;
}

function formatDecisionCardLines(
  decision: DecisionCardsDocument["decisions"][number],
): string {
  return [
    `${decision.id}: ${decision.proposedChange}`,
    `Why: ${decision.why}`,
    `Alternatives: ${decision.alternatives}`,
    `Assumptions: ${decision.assumptions}`,
    `Future state: ${decision.futureState}`,
  ].join("\n");
}

export async function reviewDecisionCards(args: {
  runtime: OttoWorkflowRuntime;
  decisionCards: DecisionCardsDocument;
  decisionCardsPath: string;
}): Promise<DecisionCardReviewSummary> {
  let needsPlanUpdate = false;
  const openQuestionSummary: DecisionCardReviewSummary["openQuestions"] = [];
  const decisionFeedbackSummary: DecisionCardReviewSummary["decisionFeedback"] =
    [];

  for (const question of args.decisionCards.openQuestions) {
    const existingAnswer = question.userAnswer?.trim() ?? "";
    if (existingAnswer) continue;

    let answer = "";
    while (!answer.trim()) {
      answer = await args.runtime.prompt.text(
        `${question.id}: ${question.question}`,
      );
    }

    question.userAnswer = answer.trim();
    openQuestionSummary.push({
      id: question.id,
      question: question.question,
      answer: question.userAnswer,
    });
    needsPlanUpdate = true;
    await writeDecisionCards(args.decisionCardsPath, args.decisionCards);
  }

  for (let index = 0; index < args.decisionCards.decisions.length; index += 1) {
    const decision = args.decisionCards.decisions[index];
    const currentHash = getDecisionCardContentHash(decision);
    const existingFeedback = decision.userFeedback?.trim() ?? "";
    const isApproved = Boolean(
      decision.approvedHash && decision.approvedHash === currentHash,
    );

    if (!existingFeedback && isApproved) continue;

    const feedback = await args.runtime.prompt.text(
      `${formatDecisionCardLines(decision)}\n\nFeedback on ${decision.id}? (empty to accept)`,
      { defaultValue: existingFeedback },
    );

    if (feedback.trim()) {
      decision.userFeedback = feedback.trim();
      delete decision.approvedHash;
      decisionFeedbackSummary.push({
        id: decision.id,
        proposedChange: decision.proposedChange,
        feedback: decision.userFeedback,
      });
      needsPlanUpdate = true;
      await writeDecisionCards(args.decisionCardsPath, args.decisionCards);
    } else {
      const cleaned = stripEmptyUserFeedback(decision);
      cleaned.approvedHash = currentHash;
      args.decisionCards.decisions[index] = cleaned;
      await writeDecisionCards(args.decisionCardsPath, args.decisionCards);
    }
  }

  return {
    updatedCards: args.decisionCards,
    needsPlanUpdate,
    openQuestions: openQuestionSummary,
    decisionFeedback: decisionFeedbackSummary,
  };
}
