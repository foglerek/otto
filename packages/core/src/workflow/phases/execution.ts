import type { OttoWorkflowRuntime } from "../runtime.js";
import { getRunDir } from "../paths.js";
import { executeIntegratedTaskLoop } from "../task-loop.js";

export async function runExecutionPhase(args: {
  runtime: OttoWorkflowRuntime;
}): Promise<void> {
  const runDir = getRunDir(args.runtime.state);
  await executeIntegratedTaskLoop({ runtime: args.runtime, runDir });
}
