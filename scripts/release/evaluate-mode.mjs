#!/usr/bin/env node

import { appendFileSync, existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

function writeGithubOutput(key, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }
  appendFileSync(outputPath, `${key}=${value}\n`, "utf8");
}

function listChangesetMarkdownFiles(rootDir) {
  const dir = path.join(rootDir, ".changeset");
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .filter((name) => name.toLowerCase() !== "readme.md");
}

function getHeadSubject(rootDir) {
  const result = spawnSync("git", ["log", "-1", "--pretty=%s"], {
    cwd: rootDir,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(`Failed to read git head commit subject: ${result.stderr}`);
  }

  return result.stdout.trim();
}

function evaluateMode(args) {
  const { changesetFiles, headSubject } = args;
  if (changesetFiles.length > 0) {
    return "prepare";
  }

  if (/^Version Packages\b/i.test(headSubject)) {
    return "publish";
  }

  return "none";
}

function main() {
  const rootDir = process.cwd();
  const ref = process.env.GITHUB_REF ?? "";

  if (process.env.RELEASE_REQUIRE_MAIN === "1" && ref && ref !== "refs/heads/main") {
    throw new Error(
      `Release workflow is restricted to refs/heads/main (received: ${ref}).`,
    );
  }

  const changesetFiles = listChangesetMarkdownFiles(rootDir);
  const headSubject = getHeadSubject(rootDir);
  const mode = evaluateMode({ changesetFiles, headSubject });

  console.log(`release-mode=${mode}`);
  console.log(`changeset-count=${changesetFiles.length}`);
  console.log(`head-subject=${headSubject}`);

  writeGithubOutput("mode", mode);
  writeGithubOutput("changeset_count", String(changesetFiles.length));
  writeGithubOutput("head_subject", headSubject.replace(/\r?\n/g, " "));
}

main();
