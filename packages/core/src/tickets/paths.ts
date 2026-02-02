import path from "node:path";

export function getTicketsDir(repoPath: string): string {
  return path.join(repoPath, ".otto", "tickets");
}

export function formatTicketDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatTicketId(date: Date, normalizedSlug: string): string {
  return `${formatTicketDate(date)}-${normalizedSlug}`;
}

export function isTicketIdSafe(ticketId: string): boolean {
  if (!ticketId || ticketId.includes("/") || ticketId.includes("\\")) return false;
  if (ticketId.includes("..")) return false;
  if (ticketId.endsWith(".md")) return false;
  return true;
}

export function extractSlugFromTicketId(ticketId: string): string | null {
  const match = ticketId.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
  return match ? match[1] : null;
}

export function getTicketFilePathForId(args: {
  repoPath: string;
  ticketId: string;
}): string {
  if (!isTicketIdSafe(args.ticketId)) {
    throw new Error(`Invalid ticket id: ${args.ticketId}`);
  }
  return path.join(getTicketsDir(args.repoPath), `${args.ticketId}.md`);
}
