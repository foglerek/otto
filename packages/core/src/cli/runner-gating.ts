import type { OttoConfig } from "@otto/config";
import type { OttoRunner } from "@otto/ports";

export function getProjectLeadRunner(config: OttoConfig): OttoRunner | null {
  const runner =
    config.runners?.byRole?.projectLead ??
    config.runners?.byRole?.lead ??
    config.runners?.default ??
    null;
  return isUsableRunner(runner) ? runner : null;
}

export function getWorkflowRunner(
  config: OttoConfig,
  role: "lead" | "task" | "reviewer" | "summarize",
): OttoRunner | null {
  const runner = config.runners?.byRole?.[role] ?? config.runners?.default ?? null;
  return isUsableRunner(runner) ? runner : null;
}

export function hasUsableWorkflowRunners(config: OttoConfig): boolean {
  return Boolean(
    getWorkflowRunner(config, "lead") &&
      getWorkflowRunner(config, "task") &&
      getWorkflowRunner(config, "reviewer") &&
      getWorkflowRunner(config, "summarize"),
  );
}

export function isUsableRunner(
  runner: OttoRunner | null | undefined,
): runner is OttoRunner {
  if (!runner) return false;
  return runner.id !== "echo" && runner.kind !== "echo";
}
