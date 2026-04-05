import type { OttoConfig } from "@otto/config";
import type { OttoPromptAdapter } from "@otto/ports";

import { runOttoCleanup } from "./cleanup.js";
import type { OttoStateV1 } from "./state.js";
import { writeRunUiState } from "./services/run-ui-state.js";

function createHeadlessCleanupPrompt(): OttoPromptAdapter {
  const fail = async (): Promise<never> => {
    throw new Error("Prompt interaction is not available during forced Otto cleanup.");
  };
  return {
    confirm: fail,
    text: fail,
    select: fail,
  };
}

export async function finalizeCompletedRun(args: {
  state: OttoStateV1;
  config: OttoConfig;
}): Promise<void> {
  await runOttoCleanup({
    state: args.state,
    config: args.config,
    prompt: createHeadlessCleanupPrompt(),
    force: true,
    deleteBranch: args.config.worktree.deleteBranchOnCleanup !== false,
    deleteArtifacts: false,
  });

  await writeRunUiState(args.state.runDir, {
    markedDone: true,
    markedDoneAt: new Date().toISOString(),
  });
}

export function shouldFinalizeCompletedRun(args: {
  stoppedAtPhase: string;
  mergeBack: { status: string } | null;
}): boolean {
  return args.stoppedAtPhase === "cleanup" && args.mergeBack?.status === "merged";
}
