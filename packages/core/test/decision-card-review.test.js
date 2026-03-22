import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const review = await jiti(
  new URL("../src/workflow/decision-card-review.ts", import.meta.url).href,
);

function buildRuntime(promptTextFn) {
  return {
    prompt: {
      text: promptTextFn,
    },
  };
}

function buildCards(overrides = {}) {
  return {
    schemaVersion: 1,
    openQuestions: [],
    decisions: [
      {
        id: "D1",
        proposedChange: "Thin Resolver Layer",
        why: "Keep business logic in services",
        alternatives: "Inline logic in resolvers",
        assumptions: "Service APIs remain stable",
        futureState: "Resolvers only orchestrate",
        ...overrides,
      },
    ],
  };
}

test("reviewDecisionCards treats unchanged prefilled feedback as acceptance", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "otto-review-test-"));
  const decisionCardsPath = path.join(tempDir, "decision-cards.json");
  const existingFeedback = "auth and transactions should stay in services";
  const cards = buildCards({ userFeedback: existingFeedback });

  try {
    const summary = await review.reviewDecisionCards({
      runtime: buildRuntime(async () => existingFeedback),
      decisionCards: cards,
      decisionCardsPath,
    });

    assert.equal(summary.needsPlanUpdate, false);
    assert.equal(summary.decisionFeedback.length, 0);
    assert.equal(cards.decisions[0].userFeedback, undefined);
    assert.equal(typeof cards.decisions[0].approvedHash, "string");
    assert.equal(cards.decisions[0].approvedHash.length > 0, true);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("reviewDecisionCards keeps changed feedback as plan update", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "otto-review-test-"));
  const decisionCardsPath = path.join(tempDir, "decision-cards.json");
  const cards = buildCards({
    userFeedback: "old feedback",
    approvedHash: "old-hash",
  });

  try {
    const summary = await review.reviewDecisionCards({
      runtime: buildRuntime(async () => "new feedback"),
      decisionCards: cards,
      decisionCardsPath,
    });

    assert.equal(summary.needsPlanUpdate, true);
    assert.equal(summary.decisionFeedback.length, 1);
    assert.equal(cards.decisions[0].userFeedback, "new feedback");
    assert.equal(cards.decisions[0].approvedHash, undefined);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
