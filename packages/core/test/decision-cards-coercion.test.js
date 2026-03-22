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
