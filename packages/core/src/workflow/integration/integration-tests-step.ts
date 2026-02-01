import type { OttoWorkflowRuntime } from "../runtime.js";
import { createIntegrationRemediationTask } from "./remediation-task.js";
import type { IntegrationStepResult } from "./types.js";

function formatFailures(result: {
  results: Array<{ name: string; ok: boolean; stdout: string; stderr: string }>;
}): string {
  const failures = result.results.filter((r) => !r.ok);
  if (failures.length === 0) return "(unknown integration failures)";
  return failures
    .map((f) => {
      const tail = (f.stderr || f.stdout || "").trim();
      return [`- ${f.name}`, tail ? `  ${tail.split("\n")[0]}` : ""].join("\n");
    })
    .join("\n");
}

export async function runIntegrationTestsStep(args: {
  runtime: OttoWorkflowRuntime;
}): Promise<IntegrationStepResult> {
  const ok = await args.runtime.prompt.confirm(
    "Integration: run integration checks?",
    { defaultValue: true },
  );
  if (!ok) {
    return { outcome: "skipped", message: "User skipped integration checks" };
  }

  const integration = args.runtime.config.integration;
  if (!integration || integration.checks.length === 0) {
    return { outcome: "skipped", message: "No integration checks configured" };
  }

  const adapter = integration.adapter ?? args.runtime.config.quality?.adapter;
  if (!adapter) {
    return {
      outcome: "aborted",
      message: "Integration checks configured but no adapter is available",
    };
  }

  const result = await adapter.runChecks({
    worktreePath: args.runtime.state.worktree.worktreePath,
    exec: args.runtime.exec,
    checks: integration.checks,
  });

  if (result.ok) return { outcome: "success" };

  const task = await createIntegrationRemediationTask({
    runtime: args.runtime,
    type: "integration-tests",
    failureSummary: formatFailures(result),
  });
  return task.created ? { outcome: "tasks-created" } : { outcome: "aborted" };
}
