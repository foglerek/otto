import fs from "node:fs/promises";
import path from "node:path";

export interface OttoArtifactPaths {
  rootDir: string;
  ticketsDir: string;
  runsDir: string;
  logsDir: string;
  statesDir: string;
  locksDir: string;
  sessionsDir: string;
}

export function resolveArtifactPaths(args: {
  mainRepoPath: string;
  artifactRoot?: string;
}): OttoArtifactPaths {
  const rootDir = path.resolve(args.mainRepoPath, args.artifactRoot ?? ".otto");
  return {
    rootDir,
    ticketsDir: path.join(rootDir, "tickets"),
    runsDir: path.join(rootDir, "runs"),
    logsDir: path.join(rootDir, "logs"),
    statesDir: path.join(rootDir, "states"),
    locksDir: path.join(rootDir, "locks"),
    sessionsDir: path.join(rootDir, "sessions"),
  };
}

export async function ensureArtifactDirs(
  paths: OttoArtifactPaths,
): Promise<void> {
  await fs.mkdir(paths.ticketsDir, { recursive: true });
  await fs.mkdir(paths.runsDir, { recursive: true });
  await fs.mkdir(paths.logsDir, { recursive: true });
  await fs.mkdir(paths.statesDir, { recursive: true });
  await fs.mkdir(paths.locksDir, { recursive: true });
  await fs.mkdir(paths.sessionsDir, { recursive: true });
}

export async function ensureGitignoreHasArtifactRoot(args: {
  mainRepoPath: string;
  artifactRootDir: string;
}): Promise<void> {
  await ensureGitignoreHasDir({
    mainRepoPath: args.mainRepoPath,
    dirPath: args.artifactRootDir,
  });
}

export async function ensureGitignoreHasDir(args: {
  mainRepoPath: string;
  dirPath: string;
}): Promise<void> {
  const rel = path.relative(args.mainRepoPath, args.dirPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    return;
  }

  const relNorm = rel.replace(/\\/g, "/");
  const ignoreLine = `${relNorm}/`;
  const gitignorePath = path.join(args.mainRepoPath, ".gitignore");

  let existing = "";
  try {
    existing = await fs.readFile(gitignorePath, "utf8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") throw err;
  }

  const lines = existing.split(/\r?\n/);
  const equivalents = new Set([
    ignoreLine,
    relNorm,
    `${relNorm}/**`,
    `/${relNorm}/`,
    `/${relNorm}`,
    `/${relNorm}/**`,
  ]);
  const hasLine = lines.some((l) => equivalents.has(l.trim()));
  if (hasLine) return;

  let next = existing;
  if (next.length > 0 && !next.endsWith("\n")) {
    next += "\n";
  }
  if (next.length > 0 && !next.endsWith("\n\n")) {
    next += "\n";
  }
  next += ignoreLine + "\n";

  await fs.writeFile(gitignorePath, next, "utf8");
}
