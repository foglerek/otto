import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });

const tags = await jiti(new URL("../src/tickets/tags.ts", import.meta.url).href);
const slug = await jiti(new URL("../src/tickets/slug.ts", import.meta.url).href);
const paths = await jiti(new URL("../src/tickets/paths.ts", import.meta.url).href);
const store = await jiti(
  new URL("../src/tickets/session-store.ts", import.meta.url).href,
);
const lead = await jiti(
  new URL("../src/tickets/project-lead.ts", import.meta.url).href,
);
const ops = await jiti(
  new URL("../src/tickets/operations.ts", import.meta.url).href,
);
const ticketCommands = await jiti(
  new URL("../src/cli/commands/tickets.ts", import.meta.url).href,
);

const tempRepo = async () =>
  fs.mkdtemp(path.join(os.tmpdir(), "otto-ticket-test-"));

test("extracts slug/content tags with whitespace", () =>
  {
    const output = [
      "<SLUG>",
      "  Add caching layer  ",
      "</SLUG>",
      "<CONTENT>",
      "# Title",
      "Body",
      "</CONTENT>",
    ].join("\n");

    assert.equal(tags.extractSlugTag(output), "Add caching layer");
    assert.equal(tags.extractContentTag(output), "# Title\nBody");
  });

test("extracts slug/content tags case-insensitively", () => {
  const output = [
    "<slug>",
    "  Add caching layer  ",
    "</slug>",
    "<content>",
    "# Title",
    "Body",
    "</content>",
  ].join("\n");

  assert.equal(tags.extractSlugTag(output), "Add caching layer");
  assert.equal(tags.extractContentTag(output), "# Title\nBody");
});

test("extracts fallback slug from labeled plain text", () => {
  const output = "Slug: Add caching layer";
  assert.equal(tags.extractSlugTag(output), "Add caching layer");
});

test("extracts fallback slug from single-line plain text", () => {
  const output = "Add caching layer";
  assert.equal(tags.extractSlugTag(output), "Add caching layer");
});

test("validates and normalizes slug", () => {
  assert.equal(slug.countSlugWords("Add caching layer"), 3);
  assert.ok(slug.isSlugWordCountValid("Add caching layer"));
  assert.ok(!slug.isSlugWordCountValid("Too short"));
  assert.equal(
    slug.normalizeSlug("Add Caching, Layer!"),
    "add-caching-layer",
  );
});

test("project lead session store read/write", async () => {
  const repoPath = await tempRepo();
  await store.saveProjectLeadSession(repoPath, { sessionId: "abc" });
  const loaded = await store.loadProjectLeadSession(repoPath);
  assert.deepEqual(loaded, { sessionId: "abc" });
  await store.clearProjectLeadSession(repoPath);
  const cleared = await store.loadProjectLeadSession(repoPath);
  assert.equal(cleared, null);
});

test("project lead retries once when session is rejected", async () => {
  const repoPath = await tempRepo();
  await store.saveProjectLeadSession(repoPath, { sessionId: "old" });

  const calls = [];
  const runner = {
    kind: "stub",
    id: "stub",
    run: async ({ sessionId }) => {
      calls.push(sessionId ?? null);
      if (sessionId) {
        return { success: false, error: "invalid session" };
      }
      return { success: true, sessionId: "new", outputText: "ok" };
    },
  };

  const exec = {
    run: async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
    }),
  };

  const result = await lead.runProjectLeadWithSession({
    repoPath,
    runner,
    exec,
    prompt: "hi",
    cwd: repoPath,
    phaseName: "ticket-create",
  });

  assert.equal(result.success, true);
  assert.deepEqual(calls, ["old", null]);
  const loaded = await store.loadProjectLeadSession(repoPath);
  assert.deepEqual(loaded, { sessionId: "new" });
});

test("ticket creation fails on collision", async () => {
  const repoPath = await tempRepo();
  const output = [
    "<SLUG>",
    "Add caching layer",
    "</SLUG>",
    "<CONTENT>",
    "Hello",
    "</CONTENT>",
  ].join("\n");

  const date = new Date("2026-02-01T12:00:00Z");
  const first = await ops.createTicketFromLeadOutput({
    repoPath,
    outputText: output,
    date,
  });

  assert.equal(
    path.basename(first.filePath),
    "2026-02-01-add-caching-layer.md",
  );

  await assert.rejects(
    ops.createTicketFromLeadOutput({ repoPath, outputText: output, date }),
    /already exists/,
  );
});

test("ticket ingest copies source content", async () => {
  const repoPath = await tempRepo();
  const sourcePath = path.join(repoPath, "source.md");
  const sourceContent = "# External\ncontent";
  await fs.writeFile(sourcePath, sourceContent, "utf8");

  const output = ["<SLUG>", "Import external ticket", "</SLUG>"].join("\n");
  const date = new Date("2026-02-01T12:00:00Z");
  const result = await ops.ingestTicketFromLeadOutput({
    repoPath,
    sourceFilePath: sourcePath,
    outputText: output,
    date,
  });

  const written = await fs.readFile(result.filePath, "utf8");
  assert.equal(written, sourceContent);
});

test("ticket ingest accepts lowercase slug tag", async () => {
  const repoPath = await tempRepo();
  const sourcePath = path.join(repoPath, "source.md");
  const sourceContent = "# External\ncontent";
  await fs.writeFile(sourcePath, sourceContent, "utf8");

  const output = ["<slug>", "Import external ticket", "</slug>"].join("\n");
  const date = new Date("2026-02-01T12:00:00Z");
  const result = await ops.ingestTicketFromLeadOutput({
    repoPath,
    sourceFilePath: sourcePath,
    outputText: output,
    date,
  });

  assert.equal(path.basename(result.filePath), "2026-02-01-import-external-ticket.md");
});

test("ticket ingest accepts plain slug output", async () => {
  const repoPath = await tempRepo();
  const sourcePath = path.join(repoPath, "source.md");
  await fs.writeFile(sourcePath, "# External\ncontent", "utf8");

  const output = "Slug: Import external ticket";
  const date = new Date("2026-02-01T12:00:00Z");
  const result = await ops.ingestTicketFromLeadOutput({
    repoPath,
    sourceFilePath: sourcePath,
    outputText: output,
    date,
  });

  assert.equal(path.basename(result.filePath), "2026-02-01-import-external-ticket.md");
});

test("runTicketIngest uses slug-coercion retry on missing slug tag", async () => {
  const repoPath = await tempRepo();
  const sourcePath = path.join(repoPath, "source.md");
  await fs.writeFile(sourcePath, "# External\ncontent", "utf8");

  const prompts = [];
  const runner = {
    kind: "stub",
    id: "stub",
    run: async ({ prompt }) => {
      prompts.push(prompt);
      if (prompts.length === 1) {
        return {
          success: true,
          outputText: "Here is my suggestion:\nImport external ticket\nUse this slug.",
        };
      }
      return { success: true, outputText: "<SLUG>Import external ticket</SLUG>" };
    },
  };

  const result = await ticketCommands.runTicketIngest({
    repoPath,
    runner,
    sourceFilePath: sourcePath,
  });

  assert.equal(prompts.length, 2);
  assert.match(prompts[1] ?? "", /<PREVIOUS_RESPONSE>/);
  assert.match(prompts[1] ?? "", /Return exactly one tag only/);
  assert.match(path.basename(result.filePath), /^\d{4}-\d{2}-\d{2}-import-external-ticket\.md$/);
});

test("runTicketIngest falls back to source filename slug when model omits slug", async () => {
  const repoPath = await tempRepo();
  const sourcePath = path.join(repoPath, "2025-12-25-expo-graphql-resolvers.md");
  await fs.writeFile(sourcePath, "# External\ncontent", "utf8");

  const prompts = [];
  const runner = {
    kind: "stub",
    id: "stub",
    run: async ({ prompt }) => {
      prompts.push(prompt);
      return { success: true, outputText: "I suggest:\nUse a concise title." };
    },
  };

  const result = await ticketCommands.runTicketIngest({
    repoPath,
    runner,
    sourceFilePath: sourcePath,
  });

  assert.equal(prompts.length, 3);
  assert.match(path.basename(result.filePath), /^\d{4}-\d{2}-\d{2}-expo-graphql-resolvers\.md$/);
});

test("runTicketIngest falls back to source filename slug on invalid word-count slug", async () => {
  const repoPath = await tempRepo();
  const sourcePath = path.join(repoPath, "2025-12-25-expo-graphql-resolvers.md");
  await fs.writeFile(sourcePath, "# External\ncontent", "utf8");

  const prompts = [];
  const runner = {
    kind: "stub",
    id: "stub",
    run: async ({ prompt }) => {
      prompts.push(prompt);
      return {
        success: true,
        outputText:
          "This is definitely a slug sentence that is way too long for ingest validation",
      };
    },
  };

  const result = await ticketCommands.runTicketIngest({
    repoPath,
    runner,
    sourceFilePath: sourcePath,
  });

  assert.equal(prompts.length, 3);
  assert.match(path.basename(result.filePath), /^\d{4}-\d{2}-\d{2}-expo-graphql-resolvers\.md$/);
});
