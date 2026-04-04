import { loadOttoState, type OttoWorkflowPhase } from "./state.js";
import { writeStateFile } from "./cli/commands/common.js";

import type { OttoPromptAdapter } from "@otto/ports";

function buildTrackedWorkflowState(args: {
  workflow: Awaited<ReturnType<typeof loadOttoState>>["workflow"];
  value: boolean;
  defaultPhase?: OttoWorkflowPhase;
}) {
  const workflow = args.workflow;
  return {
    phase: workflow?.phase ?? args.defaultPhase ?? "ticket-created",
    needsUserInput: args.value,
    taskQueue: workflow?.taskQueue ?? [],
    taskAgentSessions: workflow?.taskAgentSessions ?? {},
    reviewerSessions: workflow?.reviewerSessions ?? {},
    autoRetryCounts: workflow?.autoRetryCounts ?? {},
    ...(workflow?.runDir ? { runDir: workflow.runDir } : {}),
    ...(workflow?.planFilePath ? { planFilePath: workflow.planFilePath } : {}),
    ...(workflow?.decisionCardsPath ? { decisionCardsPath: workflow.decisionCardsPath } : {}),
    ...(workflow?.techLeadSessionId ? { techLeadSessionId: workflow.techLeadSessionId } : {}),
  };
}

async function setNeedsUserInput(args: {
  stateFilePath: string;
  value: boolean;
  defaultPhase?: OttoWorkflowPhase;
}): Promise<void> {
  try {
    const state = await loadOttoState(args.stateFilePath);
    state.workflow = buildTrackedWorkflowState({
      workflow: state.workflow,
      value: args.value,
      defaultPhase: args.defaultPhase,
    });
    await writeStateFile(state, args.stateFilePath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      throw error;
    }
  }
}

export function createTrackedPromptAdapter(args: {
  prompt: OttoPromptAdapter;
  stateFilePath: string;
  defaultPhase?: OttoWorkflowPhase;
}): OttoPromptAdapter {
  async function withTracking<T>(run: () => Promise<T>): Promise<T> {
    await setNeedsUserInput({
      stateFilePath: args.stateFilePath,
      value: true,
      defaultPhase: args.defaultPhase,
    });
    try {
      return await run();
    } finally {
      await setNeedsUserInput({
        stateFilePath: args.stateFilePath,
        value: false,
        defaultPhase: args.defaultPhase,
      });
    }
  }

  return {
    confirm: async (message, options) =>
      await withTracking(async () => await args.prompt.confirm(message, options)),
    text: async (message, options) =>
      await withTracking(async () => await args.prompt.text(message, options)),
    select: async (message, options) =>
      await withTracking(async () => await args.prompt.select(message, options)),
  };
}
