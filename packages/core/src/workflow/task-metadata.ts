import path from "node:path";

export const DEFAULT_MAX_REMEDIATION_ATTEMPTS = 3;

export interface TaskBaseInfo {
  baseTaskPath: string;
  baseTaskName: string;
  attempt: number;
}

export function getBaseTaskInfo(taskFile: string): TaskBaseInfo {
  const absoluteTaskPath = path.resolve(taskFile);
  const dir = path.dirname(absoluteTaskPath);
  const match = path.basename(absoluteTaskPath).match(/remediation-(\d+)\.md$/);
  const attempt = match ? Number.parseInt(match[1], 10) : 0;
  const baseTaskName = path
    .basename(absoluteTaskPath, ".md")
    .replace(/-remediation-\d+$/, "");
  const baseTaskPath = path.join(dir, `${baseTaskName}.md`);
  return { baseTaskPath, baseTaskName, attempt };
}

export function getAttemptsRemaining(
  attempt: number,
  maxAttempts: number = DEFAULT_MAX_REMEDIATION_ATTEMPTS,
): number {
  const normalizedMax =
    typeof maxAttempts === "number" && maxAttempts >= 0
      ? Math.floor(maxAttempts)
      : DEFAULT_MAX_REMEDIATION_ATTEMPTS;
  return Math.max(normalizedMax - attempt, 0);
}
