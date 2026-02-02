import fs from "node:fs/promises";

import { extractContentTag, extractSlugTag } from "./tags.js";
import { isSlugWordCountValid, normalizeSlug } from "./slug.js";
import {
  extractSlugFromTicketId,
  formatTicketId,
  getTicketFilePathForId,
  getTicketsDir,
} from "./paths.js";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return false;
    throw error;
  }
}

async function ensureTicketDir(repoPath: string): Promise<void> {
  await fs.mkdir(getTicketsDir(repoPath), { recursive: true });
}

async function assertTicketNotExists(filePath: string): Promise<void> {
  if (await pathExists(filePath)) {
    throw new Error(`Ticket already exists at ${filePath}`);
  }
}

export interface TicketWriteResult {
  ticketId: string;
  filePath: string;
  slug: string;
  content: string;
}

export async function createTicketFromLeadOutput(args: {
  repoPath: string;
  outputText: string;
  date?: Date;
}): Promise<TicketWriteResult> {
  const slug = extractSlugTag(args.outputText);
  const content = extractContentTag(args.outputText);
  if (!slug) throw new Error("Ticket creation missing <SLUG> tag.");
  if (!content) throw new Error("Ticket creation missing <CONTENT> tag.");
  if (!isSlugWordCountValid(slug)) {
    throw new Error("Ticket slug must be 3-5 words.");
  }

  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) {
    throw new Error("Ticket slug could not be normalized.");
  }

  const ticketId = formatTicketId(args.date ?? new Date(), normalizedSlug);
  const filePath = getTicketFilePathForId({
    repoPath: args.repoPath,
    ticketId,
  });

  await ensureTicketDir(args.repoPath);
  await assertTicketNotExists(filePath);

  const trimmed = content.trim();
  const finalContent = trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
  await fs.writeFile(filePath, finalContent, "utf8");

  return { ticketId, filePath, slug: normalizedSlug, content: trimmed };
}

export async function amendTicketFromLeadOutput(args: {
  repoPath: string;
  ticketId: string;
  outputText: string;
}): Promise<TicketWriteResult> {
  const content = extractContentTag(args.outputText);
  if (!content) throw new Error("Ticket amend missing <CONTENT> tag.");

  const filePath = getTicketFilePathForId({
    repoPath: args.repoPath,
    ticketId: args.ticketId,
  });

  if (!(await pathExists(filePath))) {
    throw new Error(`Ticket not found at ${filePath}`);
  }

  const trimmed = content.trim();
  const finalContent = trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
  await fs.writeFile(filePath, finalContent, "utf8");

  return {
    ticketId: args.ticketId,
    filePath,
    slug: extractSlugFromTicketId(args.ticketId) ?? args.ticketId,
    content: trimmed,
  };
}

export async function ingestTicketFromLeadOutput(args: {
  repoPath: string;
  sourceFilePath: string;
  outputText: string;
  date?: Date;
}): Promise<TicketWriteResult> {
  const slug = extractSlugTag(args.outputText);
  if (!slug) throw new Error("Ticket ingest missing <SLUG> tag.");
  if (!isSlugWordCountValid(slug)) {
    throw new Error("Ticket slug must be 3-5 words.");
  }

  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) {
    throw new Error("Ticket slug could not be normalized.");
  }

  const ticketId = formatTicketId(args.date ?? new Date(), normalizedSlug);
  const filePath = getTicketFilePathForId({
    repoPath: args.repoPath,
    ticketId,
  });

  await ensureTicketDir(args.repoPath);
  await assertTicketNotExists(filePath);

  const content = await fs.readFile(args.sourceFilePath);
  await fs.writeFile(filePath, content);

  return {
    ticketId,
    filePath,
    slug: normalizedSlug,
    content: content.toString("utf8"),
  };
}
