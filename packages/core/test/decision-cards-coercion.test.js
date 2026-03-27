import assert from "node:assert/strict";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const decisionCards = await jiti(
  new URL("../src/workflow/decision-cards.ts", import.meta.url).href,
);

test("coerceDecisionCardsDocument maps legacy decision card shape", () => {
  const input = {
    decisions: [
      {
        id: "D1",
        title: "Thin Resolver Architecture",
        decision: "Keep resolvers thin.",
        rationale: "Move business logic to services.",
        tradeoffs: "Slight upfront extraction effort.",
        assumptions: "Service boundaries remain stable.",
        default: "Thin wrappers first, then deeper extraction.",
      },
    ],
    questions: [
      {
        id: "Q1",
        question: "Is adminListUsers staying as mutation?",
      },
    ],
  };

  const output = decisionCards.coerceDecisionCardsDocument(input);
  assert.equal(output.schemaVersion, 1);
  assert.deepEqual(output.openQuestions, [
    { id: "Q1", question: "Is adminListUsers staying as mutation?" },
  ]);
  assert.deepEqual(output.decisions, [
    {
      id: "D1",
      proposedChange: "Thin Resolver Architecture",
      why: "Move business logic to services.",
      alternatives: "Slight upfront extraction effort.",
      assumptions: "Service boundaries remain stable.",
      futureState: "Thin wrappers first, then deeper extraction.",
    },
  ]);
});

test("coerceDecisionCardsDocument normalizes string schemaVersion", () => {
  const input = {
    schemaVersion: "1",
    openQuestions: [],
    decisions: [
      {
        id: "D1",
        proposedChange: "Adopt service-level guards",
        why: "Keep resolver layer orchestration-only",
        alternatives: "GraphQL directives",
        assumptions: "Current auth layer stays intact",
        futureState: "Uniform error routing",
      },
    ],
  };

  const output = decisionCards.coerceDecisionCardsDocument(input);
  assert.equal(output.schemaVersion, 1);
  assert.equal(output.decisions.length, 1);
});

test("coerceDecisionCardsDocument fills missing assumptions from refs", () => {
  const input = {
    decisions: [
      {
        id: "D1",
        title: "Thin Resolvers, Service-First",
        rationale: "Avoid duplicating domain logic.",
        tradeoffs: "Adds extraction effort in the short term.",
        refs: [
          "mealsy/packages/services/src",
          "frontend/src/lib/meal-planning/queries.ts",
        ],
      },
    ],
  };

  const output = decisionCards.coerceDecisionCardsDocument(input);
  assert.equal(output.schemaVersion, 1);
  assert.equal(output.decisions.length, 1);
  assert.match(output.decisions[0].assumptions, /mealsy\/packages\/services\/src/);
});

test("coerceDecisionCardsDocument unwraps nested decisionCards payload", () => {
  const input = {
    result: {
      decisions: [
        {
          id: "D1",
          title: "Resolver migration",
          rationale: "Align with service boundaries.",
          alternatives: "Inline logic inside resolvers.",
          assumptions: "Service APIs remain stable.",
          futureState: "Resolvers remain orchestration-only.",
        },
      ],
      questions: [{ id: "Q1", question: "How do we map auth defaults?" }],
    },
  };

  const output = decisionCards.coerceDecisionCardsDocument(input);
  assert.equal(output.schemaVersion, 1);
  assert.equal(output.decisions.length, 1);
  assert.equal(output.openQuestions.length, 1);
});

test("mergeUserFields preserves approvals across decision id churn", () => {
  const previousDecision = {
    id: "D1",
    proposedChange: "Keep resolvers thin",
    why: "Service boundary remains clean",
    alternatives: "Inline domain logic in resolvers",
    assumptions: "Service APIs remain stable",
    futureState: "Resolvers orchestrate only",
  };
  const previous = {
    schemaVersion: 1,
    openQuestions: [],
    decisions: [
      {
        ...previousDecision,
        approvedHash: decisionCards.getDecisionCardContentHash(previousDecision),
      },
    ],
  };

  const next = {
    schemaVersion: 1,
    openQuestions: [],
    decisions: [
      {
        ...previousDecision,
        id: "D9",
      },
      {
        id: "D10",
        proposedChange: "Add integration task",
        why: "Protect rollout quality",
        alternatives: "No dedicated integration task",
        assumptions: "Smoke tests stay stable",
        futureState: "Regression risk lowered",
      },
    ],
  };

  const merged = decisionCards.mergeUserFields({ next, previous });
  const nextHash = decisionCards.getDecisionCardContentHash(next.decisions[0]);
  assert.equal(
    merged.decisions[0].approvedHash,
    nextHash,
  );
  assert.equal(merged.decisions[1].approvedHash, undefined);
});

test("mergeUserFields preserves open question answers across id churn", () => {
  const previous = {
    schemaVersion: 1,
    openQuestions: [
      {
        id: "Q1",
        question: "Should admin list users remain a mutation?",
        userAnswer: "Yes, keep parity for now.",
      },
    ],
    decisions: [
      {
        id: "D1",
        proposedChange: "Thin resolver layer",
        why: "Move domain logic to services",
        alternatives: "Keep logic in resolvers",
        assumptions: "Service package boundary holds",
        futureState: "Resolvers remain transport only",
      },
    ],
  };

  const next = {
    schemaVersion: 1,
    openQuestions: [
      {
        id: "Q9",
        question: "Should admin list users remain a mutation?",
      },
      {
        id: "Q10",
        question: "Do we need a new error code mapping table?",
      },
    ],
    decisions: previous.decisions,
  };

  const merged = decisionCards.mergeUserFields({ next, previous });
  assert.equal(merged.openQuestions[0].userAnswer, "Yes, keep parity for now.");
  assert.equal(merged.openQuestions[1].userAnswer, undefined);
});

test("mergeUserFields does not preserve approval when decision content changes", () => {
  const previousDecision = {
    id: "D1",
    proposedChange: "Thin resolver layer",
    why: "Move domain logic to services",
    alternatives: "Keep logic in resolvers",
    assumptions: "Service package boundary holds",
    futureState: "Resolvers remain transport only",
  };
  const previous = {
    schemaVersion: 1,
    openQuestions: [],
    decisions: [
      {
        ...previousDecision,
        approvedHash: decisionCards.getDecisionCardContentHash(previousDecision),
      },
    ],
  };

  const next = {
    schemaVersion: 1,
    openQuestions: [],
    decisions: [
      {
        ...previousDecision,
        id: "D1",
        futureState: "Resolvers plus services with mixed business logic",
      },
    ],
  };

  const merged = decisionCards.mergeUserFields({ next, previous });
  assert.equal(merged.decisions[0].approvedHash, undefined);
});
