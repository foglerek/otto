import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { OttoWorkflowRuntime } from "./runtime.js";
import { getTechLeadSystemReminder } from "./system-reminders.js";
import { fileExistsAndHasContent } from "./file-utils.js";

type DecisionCard = {
  id: string;
  proposedChange: string;
  why: string;
  alternatives: string;
  assumptions: string;
  futureState: string;
  userFeedback?: string;
  approvedHash?: string;
};

type OpenQuestionCard = {
  id: string;
  question: string;
  userAnswer?: string;
};

export type DecisionCardsDocument = {
  schemaVersion: 1;
  openQuestions: OpenQuestionCard[];
  decisions: DecisionCard[];
};

export function getDecisionCardContentHash(card: DecisionCard): string {
  const content = JSON.stringify({
    id: card.id,
    proposedChange: card.proposedChange,
    why: card.why,
    alternatives: card.alternatives,
    assumptions: card.assumptions,
    futureState: card.futureState,
  });
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function stripEmptyUserFeedback(card: DecisionCard): DecisionCard {
  const trimmed = (card.userFeedback ?? "").trim();
  if (!trimmed) {
    const { userFeedback: _userFeedback, ...rest } = card;
    void _userFeedback;
    return rest;
  }
  return { ...card, userFeedback: trimmed };
}

export async function writeDecisionCards(
  decisionCardsPath: string,
  doc: DecisionCardsDocument,
): Promise<void> {
  await fs.mkdir(path.dirname(decisionCardsPath), { recursive: true });
  await fs.writeFile(
    decisionCardsPath,
    JSON.stringify(doc, null, 2) + "\n",
    "utf8",
  );
}

const decisionCardsJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "openQuestions", "decisions"],
  properties: {
    schemaVersion: { const: 1 },
    openQuestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "question"],
        properties: {
          id: { type: "string" },
          question: { type: "string" },
        },
      },
    },
    decisions: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "proposedChange",
          "why",
          "alternatives",
          "assumptions",
          "futureState",
        ],
        properties: {
          id: { type: "string" },
          proposedChange: { type: "string" },
          why: { type: "string" },
          alternatives: { type: "string" },
          assumptions: { type: "string" },
          futureState: { type: "string" },
        },
      },
    },
  },
} as const;

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `Decision cards: expected ${label} to be a non-empty string`,
    );
  }
}

function validateDocument(doc: unknown): asserts doc is DecisionCardsDocument {
  if (!doc || typeof doc !== "object") {
    throw new Error("Decision cards: expected object");
  }

  const d = doc as Record<string, unknown>;
  if (d.schemaVersion !== 1) {
    throw new Error("Decision cards: schemaVersion must be 1");
  }

  if (!Array.isArray(d.openQuestions) || !Array.isArray(d.decisions)) {
    throw new Error("Decision cards: expected openQuestions[] and decisions[]");
  }

  if (d.decisions.length < 1) {
    throw new Error("Decision cards: must include at least 1 decision");
  }

  for (const q of d.openQuestions) {
    if (!q || typeof q !== "object") {
      throw new Error("Decision cards: openQuestions item must be object");
    }
    const qObj = q as Record<string, unknown>;
    assertString(qObj.id, "openQuestions[].id");
    assertString(qObj.question, "openQuestions[].question");
  }

  for (const c of d.decisions) {
    if (!c || typeof c !== "object") {
      throw new Error("Decision cards: decisions item must be object");
    }
    const cObj = c as Record<string, unknown>;
    assertString(cObj.id, "decisions[].id");
    assertString(cObj.proposedChange, "decisions[].proposedChange");
    assertString(cObj.why, "decisions[].why");
    assertString(cObj.alternatives, "decisions[].alternatives");
    assertString(cObj.assumptions, "decisions[].assumptions");
    assertString(cObj.futureState, "decisions[].futureState");
  }
}

export async function readDecisionCards(
  decisionCardsPath: string,
): Promise<DecisionCardsDocument | null> {
  return await readExistingDecisionCards(decisionCardsPath);
}

function mergeUserFields(args: {
  next: DecisionCardsDocument;
  previous: DecisionCardsDocument | null;
}): DecisionCardsDocument {
  if (!args.previous) return args.next;

  const prevQuestions = new Map(
    args.previous.openQuestions.map((q) => [q.id, q]),
  );
  const prevDecisions = new Map(args.previous.decisions.map((d) => [d.id, d]));

  const nextQuestions = args.next.openQuestions.map((q) => {
    const prev = prevQuestions.get(q.id);
    return prev?.userAnswer ? { ...q, userAnswer: prev.userAnswer } : q;
  });

  const nextDecisions = args.next.decisions.map((d) => {
    const prev = prevDecisions.get(d.id);
    const nextHash = getDecisionCardContentHash(d);
    const prevHash = prev ? getDecisionCardContentHash(prev) : null;

    return {
      ...d,
      ...(prev?.userFeedback ? { userFeedback: prev.userFeedback } : {}),
      ...(prev?.approvedHash && prevHash === nextHash
        ? { approvedHash: prev.approvedHash }
        : {}),
    };
  });

  return {
    schemaVersion: 1,
    openQuestions: nextQuestions,
    decisions: nextDecisions,
  };
}

async function readExistingDecisionCards(
  decisionCardsPath: string,
): Promise<DecisionCardsDocument | null> {
  try {
    const raw = await fs.readFile(decisionCardsPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    validateDocument(parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function generateDecisionCards(args: {
  runtime: OttoWorkflowRuntime;
  planFilePath: string;
  decisionCardsPath: string;
  existingCards?: DecisionCardsDocument | null;
}): Promise<void> {
  const plan = await fs.readFile(args.planFilePath, "utf8");
  const existing =
    args.existingCards ??
    (await readExistingDecisionCards(args.decisionCardsPath));

  const prompt = [
    getTechLeadSystemReminder(args.runtime, "planning"),
    "",
    "You are Otto (tech lead).",
    "",
    "Generate decision cards as strict JSON.",
    "- Output ONLY JSON. No markdown, no commentary.",
    "- Do NOT write any files; Otto will persist your JSON.",
    "- Include at least 1 decision.",
    "- Keep each field concise (1-3 sentences).",
    "",
    existing
      ? "You may keep stable IDs from the existing cards when appropriate."
      : "Use stable IDs like D1, D2... and Q1, Q2...",
    "",
    "<PLAN>",
    plan.trimEnd(),
    "</PLAN>",
    "",
    existing
      ? [
          "<EXISTING_CARDS>",
          JSON.stringify(existing, null, 2),
          "</EXISTING_CARDS>",
          "",
        ].join("\n")
      : "",
  ].join("\n");

  const wf = args.runtime.state.workflow;
  const result = await args.runtime.runners.lead.run({
    role: "lead",
    phaseName: "decision-cards",
    prompt,
    cwd: args.runtime.state.worktree.worktreePath,
    exec: args.runtime.exec,
    sessionId: wf?.techLeadSessionId,
    timeoutMs: 5 * 60_000,
    jsonSchema: decisionCardsJsonSchema,
  });

  if (!result.success || !result.outputText) {
    throw new Error(result.error ?? "Failed to generate decision cards.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.outputText);
  } catch {
    throw new Error("Decision cards: runner did not return valid JSON.");
  }

  validateDocument(parsed);
  const merged = mergeUserFields({
    next: parsed,
    previous: existing,
  });

  await writeDecisionCards(args.decisionCardsPath, merged);

  if (!fileExistsAndHasContent(args.decisionCardsPath)) {
    throw new Error("Decision cards: failed to write decision-cards.json");
  }
}

export async function ensureDecisionCards(args: {
  runtime: OttoWorkflowRuntime;
  planFilePath: string;
  decisionCardsPath: string;
}): Promise<DecisionCardsDocument> {
  const existing = await readExistingDecisionCards(args.decisionCardsPath);
  if (existing) return existing;
  await generateDecisionCards({
    runtime: args.runtime,
    planFilePath: args.planFilePath,
    decisionCardsPath: args.decisionCardsPath,
  });
  const next = await readExistingDecisionCards(args.decisionCardsPath);
  if (!next) {
    throw new Error("Decision cards missing or invalid after regeneration.");
  }
  return next;
}
