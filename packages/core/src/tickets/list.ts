import fs from "node:fs/promises";
import path from "node:path";

import { getTicketsDir } from "./paths.js";

export async function listManagedTicketIds(repoPath: string): Promise<string[]> {
  const dir = getTicketsDir(repoPath);

  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return [];
    throw error;
  }

  const ids = names
    .filter((n) => n.endsWith(".md"))
    .map((n) => path.basename(n, ".md"))
    .filter((id) => id.trim().length > 0);

  ids.sort();
  return ids;
}
