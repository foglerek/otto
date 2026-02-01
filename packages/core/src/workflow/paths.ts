import path from "node:path";

import type { OttoStateV1 } from "../state.js";

export function getRunDir(state: OttoStateV1): string {
  return path.join(state.artifactRootDir, "runs", state.runId);
}

export function getPlanFilePath(state: OttoStateV1): string {
  return path.join(getRunDir(state), "plan.md");
}

export function getDecisionCardsPath(state: OttoStateV1): string {
  return path.join(getRunDir(state), "decision-cards.json");
}

export function getWorktreeArtifactRoot(state: OttoStateV1): string {
  return path.join(state.worktree.worktreePath, ".otto");
}

export function toWorktreePath(args: {
  state: OttoStateV1;
  mainRepoFilePath: string;
}): string | null {
  const rel = path.relative(args.state.mainRepoPath, args.mainRepoFilePath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return path.join(args.state.worktree.worktreePath, rel);
}

export function getWorktreeRunDir(state: OttoStateV1): string {
  return path.join(getWorktreeArtifactRoot(state), "runs", state.runId);
}

export function getWorktreePlanFilePath(state: OttoStateV1): string {
  return path.join(getWorktreeRunDir(state), "plan.md");
}

export function getWorktreeDecisionCardsPath(state: OttoStateV1): string {
  return path.join(getWorktreeRunDir(state), "decision-cards.json");
}
