import type { OttoWorkflowRuntime } from "../runtime.js";
import { createIntegrationRemediationTask } from "./remediation-task.js";
import type { IntegrationStepResult } from "./types.js";

function formatFailures(result: {
  results: Array<{ name: string; ok: boolean; stdout: string; stderr: string }>;
}): string {
  const failures = result.results.filter((r) => !r.ok);
  if (failures.length === 0) return "(unknown quality failures)";
  return failures
    .map((f) => {
      const tail = (f.stderr || f.stdout || "").trim();
      return [`- ${f.name}`, tail ? `  ${tail.split("\n")[0]}` : ""].join("\n");
    })
    .join("\n");
}

export async function runQualityStep(args: {
  runtime: OttoWorkflowRuntime;
}): Promise<IntegrationStepResult> {
  const ok = await args.runtime.prompt.confirm(
    "Integration: run quality gate checks?",
    { defaultValue: true },
  );
  if (!ok) return { outcome: "skipped", message: "User skipped quality gate" };

  const quality = args.runtime.config.quality;
  if (!quality) return { outcome: "skipped", message: "No quality config" };

  const result = await quality.adapter.runChecks({
    worktreePath: args.runtime.state.worktree.worktreePath,
    exec: args.runtime.exec,
    checks: quality.checks,
  });

  if (result.ok) return { outcome: "success" };

  const task = await createIntegrationRemediationTask({
    runtime: args.runtime,
    type: "quality-check",
    failureSummary: formatFailures(result),
  });
  return task.created ? { outcome: "tasks-created" } : { outcome: "aborted" };
}
