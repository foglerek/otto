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
