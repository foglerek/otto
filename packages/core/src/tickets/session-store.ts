import fs from "node:fs/promises";
import path from "node:path";

export interface ProjectLeadSession {
  sessionId: string;
}

export function getProjectLeadSessionPath(repoPath: string): string {
  return path.join(repoPath, ".otto", "sessions", "project-lead.json");
}

export async function loadProjectLeadSession(
  repoPath: string,
): Promise<ProjectLeadSession | null> {
  try {
    const raw = await fs.readFile(getProjectLeadSessionPath(repoPath), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const sessionId = (parsed as { sessionId?: unknown }).sessionId;
    if (typeof sessionId !== "string" || !sessionId.trim()) return null;
    return { sessionId };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    throw error;
  }
}

export async function saveProjectLeadSession(
  repoPath: string,
  session: ProjectLeadSession,
): Promise<void> {
  const filePath = getProjectLeadSessionPath(repoPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(session, null, 2), "utf8");
}

export async function clearProjectLeadSession(repoPath: string): Promise<void> {
  try {
    await fs.rm(getProjectLeadSessionPath(repoPath), { force: true });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return;
    throw error;
  }
}
