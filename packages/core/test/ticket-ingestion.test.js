import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const ticketIngestion = await jiti(
  new URL("../src/workflow/phases/ticket-ingestion.ts", import.meta.url).href,
);

function createState(rootDir) {
  const runId = "2026-03-22-ingestion";
  const artifactRootDir = path.join(rootDir, ".otto");
  return {
    kind: "otto.state",
    version: 1,
    runId,
    createdAt: new Date().toISOString(),
    mainRepoPath: rootDir,
    artifactRootDir,
    stateFilePath: path.join(artifactRootDir, "states", `run-${runId}.json`),
    runDir: path.join(artifactRootDir, "runs", runId),
    lockFilePath: path.join(artifactRootDir, "locks", `run-${runId}.json`),
    ticket: {
      date: "2026-03-22",
      slug: "ingestion",
      filePath: path.join(artifactRootDir, "tickets", `${runId}.md`),
    },
    worktree: {
      worktreePath: path.join(rootDir, ".worktrees", `workflow-${runId}`),
      branchName: `workflow-${runId}`,
      baseBranch: "main",
    },
  };
}

test("ticket ingestion performs explicit micro-retry before missing-plan failure", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "otto-ingest-test-"));
  const state = createState(rootDir);
  const calls = [];
  const events = [];

  try {
    await fs.mkdir(path.dirname(state.ticket.filePath), { recursive: true });
    await fs.writeFile(state.ticket.filePath, "# Ticket\n\nCreate plan.", "utf8");

    const runtime = {
      config: {},
      prompt: {},
      exec: {},
      registry: {},
      state,
      stateStore: {
        state,
        save: async () => {},
        update: async (mutator) => {
          mutator(state);
          return state;
        },
      },
      runners: {
        lead: {
          run: async (args) => {
            calls.push(args);
            if (args.phaseName === "ticket-ingestion") {
              return {
                success: true,
                outputText: "<OK>",
                sessionId: "lead-session-1",
              };
            }
            if (args.phaseName === "lead-micro-retry") {
              return {
                success: true,
                outputText: "still blocked",
                sessionId: "lead-session-1",
              };
            }
            return {
              success: false,
              error: `unexpected phase: ${args.phaseName}`,
            };
          },
        },
        task: { run: async () => ({ success: false }) },
        reviewer: { run: async () => ({ success: false }) },
        summarize: { run: async () => ({ success: false }) },
      },
      reminders: {
        techLead: [],
        task: [],
        reviewer: [],
      },
      events: {
        append: async (event) => {
          events.push(event);
        },
        appendExec: async () => {},
      },
    };

    await assert.rejects(
      async () => {
        await ticketIngestion.runTicketIngestionPhase({ runtime });
      },
      /Plan file missing or empty/,
    );

    assert.equal(calls[0].phaseName, "ticket-ingestion");
    assert.equal(calls[1].phaseName, "lead-micro-retry");
    assert.match(
      calls[1].prompt,
      /Create the plan file at .*plan\.md with context, assumptions, and acceptance criteria\./,
    );

    const retryEvent = events.find(
      (event) => event.type === "ticket_ingestion_missing_plan_retry",
    );
    assert.ok(retryEvent);
    assert.equal(retryEvent.data.retrySucceeded, false);
    assert.equal(retryEvent.data.planExistsAfterRetry, false);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});
