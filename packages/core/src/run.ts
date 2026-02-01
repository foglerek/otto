import type { OttoConfig } from "@otto/config";
import type { OttoPromptAdapter } from "@otto/ports";

import { createNodeExec } from "./exec.js";
import {
  attachProcessRegistryExitHandlers,
  createProcessRegistry,
} from "./process-registry.js";
import type { OttoStateV1 } from "./state.js";

import { createOttoStateStore } from "./workflow/state-store.js";
import { resolveWorkflowRunners } from "./workflow/runtime.js";
import { runWorkflowOrchestrator } from "./workflow/orchestrator.js";
import { getPlanFilePath } from "./workflow/paths.js";

export async function runOttoRun(args: {
  state: OttoStateV1;
  stateFilePath: string;
  config: OttoConfig;
  prompt: OttoPromptAdapter;
}): Promise<{ planFilePath: string; stoppedAtPhase: string }> {
  const registry = createProcessRegistry();
  const detachHandlers = attachProcessRegistryExitHandlers(registry);
  const exec = createNodeExec({ registry });

  const stateStore = createOttoStateStore({
    filePath: args.stateFilePath,
    initialState: args.state,
  });

  const runners = resolveWorkflowRunners(args.config);
  const runtime = {
    config: args.config,
    prompt: args.prompt,
    exec,
    registry,
    stateStore,
    state: stateStore.state,
    runners,
    reminders: {
      techLead: [],
      task: [],
      reviewer: [],
    },
  };

  try {
    const { stoppedAtPhase } = await runWorkflowOrchestrator({ runtime });
    const planFilePath = getPlanFilePath(runtime.state);
    return { planFilePath, stoppedAtPhase };
  } finally {
    detachHandlers();
    registry.killAll("run complete");
  }
}
