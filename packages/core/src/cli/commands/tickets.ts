import fs from "node:fs/promises";
import path from "node:path";

import type { OttoRunner } from "@otto/ports";

import { createNodeExec } from "../../exec.js";
import {
  amendTicketFromLeadOutput,
  createTicketFromLeadOutput,
  ingestTicketFromLeadOutput,
} from "../../tickets/operations.js";
import { getTicketFilePathForId } from "../../tickets/paths.js";
import { runProjectLeadWithSession } from "../../tickets/project-lead.js";
import {
  buildTicketAmendPrompt,
  buildTicketCreatePrompt,
  buildTicketIngestPrompt,
  buildTicketRetryPrompt,
  buildTicketSlugCoercePrompt,
} from "../../tickets/prompts.js";

function isRetryableTicketError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("missing <SLUG>") ||
    message.includes("missing <CONTENT>") ||
    message.includes("3-5 words") ||
    message.includes("could not be normalized")
  );
}

function isSlugFormatError(message: string): boolean {
  return (
    message.includes("missing <SLUG>") ||
    message.includes("3-5 words") ||
    message.includes("could not be normalized")
  );
}

function fallbackSlugFromSourcePath(sourceFilePath: string): string | null {
  const baseName = path.basename(sourceFilePath, path.extname(sourceFilePath));
  const withoutDatePrefix = baseName.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  const words = withoutDatePrefix.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length < 3) {
    return null;
  }
  return words.slice(0, 5).join(" ");
}

async function runProjectLeadPrompt(args: {
  runner: OttoRunner;
  repoPath: string;
  prompt: string;
  phaseName: string;
}): Promise<string> {
  const exec = createNodeExec();
  const result = await runProjectLeadWithSession({
    repoPath: args.repoPath,
    runner: args.runner,
    exec,
    prompt: args.prompt,
    cwd: args.repoPath,
    phaseName: args.phaseName,
  });

  if (!result.success) {
    throw new Error(result.error ?? "Project lead failed.");
  }

  return result.outputText ?? "";
}

export async function runTicketCreate(args: {
  repoPath: string;
  runner: OttoRunner;
  ticketText: string;
}): Promise<{ ticketId: string; filePath: string }> {
  const basePrompt = buildTicketCreatePrompt({ ticketText: args.ticketText });
  const maxAttempts = 2;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const prompt =
      attempt === 0
        ? basePrompt
        : buildTicketRetryPrompt({
            basePrompt,
            errorMessage: "Missing or invalid tags/slug.",
          });
    const outputText = await runProjectLeadPrompt({
      runner: args.runner,
      repoPath: args.repoPath,
      prompt,
      phaseName: "ticket-create",
    });

    try {
      const result = await createTicketFromLeadOutput({
        repoPath: args.repoPath,
        outputText,
      });
      return { ticketId: result.ticketId, filePath: result.filePath };
    } catch (error) {
      if (attempt + 1 >= maxAttempts || !isRetryableTicketError(error)) {
        throw error;
      }
    }
  }

  throw new Error("Ticket creation failed.");
}

export async function runTicketIngest(args: {
  repoPath: string;
  runner: OttoRunner;
  sourceFilePath: string;
}): Promise<{ ticketId: string; filePath: string }> {
  const sourceContent = await fs.readFile(args.sourceFilePath, "utf8");
  const basePrompt = buildTicketIngestPrompt({ sourceContent });
  const maxAttempts = 3;
  let prompt = basePrompt;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const outputText = await runProjectLeadPrompt({
      runner: args.runner,
      repoPath: args.repoPath,
      prompt,
      phaseName: "ticket-ingest",
    });

    try {
      const result = await ingestTicketFromLeadOutput({
        repoPath: args.repoPath,
        sourceFilePath: args.sourceFilePath,
        outputText,
      });
      return { ticketId: result.ticketId, filePath: result.filePath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const shouldCoerceSlug = isSlugFormatError(message);

      if (attempt + 1 >= maxAttempts || !isRetryableTicketError(error)) {
        if (shouldCoerceSlug) {
          const fallbackSlug = fallbackSlugFromSourcePath(args.sourceFilePath);
          if (fallbackSlug) {
            const fallback = await ingestTicketFromLeadOutput({
              repoPath: args.repoPath,
              sourceFilePath: args.sourceFilePath,
              outputText: `<SLUG>${fallbackSlug}</SLUG>`,
            });
            return { ticketId: fallback.ticketId, filePath: fallback.filePath };
          }
        }
        throw error;
      }

      prompt = shouldCoerceSlug
        ? buildTicketSlugCoercePrompt({
            basePrompt,
            previousOutput: outputText,
          })
        : buildTicketRetryPrompt({
            basePrompt,
            errorMessage: "Missing or invalid slug.",
          });
    }
  }

  throw new Error("Ticket ingest failed.");
}

export async function runTicketAmend(args: {
  repoPath: string;
  runner: OttoRunner;
  ticketId: string;
  amendInstructions: string;
}): Promise<{ ticketId: string; filePath: string }> {
  const existingContent = await fs.readFile(
    getTicketFilePathForId({ repoPath: args.repoPath, ticketId: args.ticketId }),
    "utf8",
  );
  const basePrompt = buildTicketAmendPrompt({
    ticketId: args.ticketId,
    existingContent,
    amendInstructions: args.amendInstructions,
  });
  const maxAttempts = 2;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const prompt =
      attempt === 0
        ? basePrompt
        : buildTicketRetryPrompt({
            basePrompt,
            errorMessage: "Missing or invalid <CONTENT> tag.",
          });
    const outputText = await runProjectLeadPrompt({
      runner: args.runner,
      repoPath: args.repoPath,
      prompt,
      phaseName: "ticket-amend",
    });

    try {
      const result = await amendTicketFromLeadOutput({
        repoPath: args.repoPath,
        ticketId: args.ticketId,
        outputText,
      });
      return { ticketId: result.ticketId, filePath: result.filePath };
    } catch (error) {
      if (attempt + 1 >= maxAttempts || !isRetryableTicketError(error)) {
        throw error;
      }
    }
  }

  throw new Error("Ticket amend failed.");
}
