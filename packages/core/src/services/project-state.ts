import fs from "node:fs/promises";
import path from "node:path";

export function getProjectStatePath(artifactRootDir: string): string {
  return path.join(artifactRootDir, "project-state.md");
}

export async function ensureProjectStateFile(artifactRootDir: string): Promise<string> {
  const filePath = getProjectStatePath(artifactRootDir);
  try {
    await fs.access(filePath);
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      "# Project State\n\nUse this markdown file to track project-level context, active workstreams, decisions, and questions that the top-level Otto session should keep in mind.\n",
      "utf8",
    );
  }
  return filePath;
}

export async function readProjectState(artifactRootDir: string): Promise<{ path: string; content: string }> {
  const filePath = await ensureProjectStateFile(artifactRootDir);
  return {
    path: filePath,
    content: await fs.readFile(filePath, "utf8"),
  };
}

export async function writeProjectState(artifactRootDir: string, content: string): Promise<{ path: string }> {
  const filePath = await ensureProjectStateFile(artifactRootDir);
  await fs.writeFile(filePath, content, "utf8");
  return { path: filePath };
}
