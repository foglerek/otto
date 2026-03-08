import type { OttoStateV1, OttoWorkflowPhase } from "../state.js";
import type { OttoStateStore } from "./state-store.js";

export type WorkflowStateAction =
  | {
      type: "set-phase";
      phase: OttoWorkflowPhase;
    }
  | {
      type: "set-task-queue";
      queue: string[];
      defaultPhase?: OttoWorkflowPhase;
    }
  | {
      type: "set-tech-lead-session";
      sessionId: string | null;
      defaultPhase?: OttoWorkflowPhase;
    }
  | {
      type: "set-task-agent-session";
      taskKey: string;
      sessionId: string | null;
      defaultPhase?: OttoWorkflowPhase;
    }
  | {
      type: "set-reviewer-session";
      taskKey: string;
      sessionId: string | null;
      defaultPhase?: OttoWorkflowPhase;
    };

function ensureWorkflow(
  state: OttoStateV1,
  defaultPhase: OttoWorkflowPhase = "ticket-created",
): NonNullable<OttoStateV1["workflow"]> {
  if (!state.workflow) {
    state.workflow = {
      phase: defaultPhase,
      needsUserInput: false,
      taskQueue: [],
      taskAgentSessions: {},
      reviewerSessions: {},
      autoRetryCounts: {},
    };
  }
  if (!state.workflow.phase) {
    state.workflow.phase = defaultPhase;
  }
  if (!state.workflow.taskQueue) {
    state.workflow.taskQueue = [];
  }
  if (!state.workflow.taskAgentSessions) {
    state.workflow.taskAgentSessions = {};
  }
  if (!state.workflow.reviewerSessions) {
    state.workflow.reviewerSessions = {};
  }
  if (!state.workflow.autoRetryCounts) {
    state.workflow.autoRetryCounts = {};
  }
  return state.workflow;
}

export function applyWorkflowAction(
  state: OttoStateV1,
  action: WorkflowStateAction,
): void {
  if (action.type === "set-phase") {
    const wf = ensureWorkflow(state, action.phase);
    wf.phase = action.phase;
    return;
  }

  const wf = ensureWorkflow(state, action.defaultPhase ?? "ticket-created");

  if (action.type === "set-task-queue") {
    wf.taskQueue = action.queue;
    return;
  }

  if (action.type === "set-tech-lead-session") {
    if (action.sessionId) {
      wf.techLeadSessionId = action.sessionId;
    } else {
      delete wf.techLeadSessionId;
    }
    return;
  }

  if (action.type === "set-task-agent-session") {
    wf.taskAgentSessions![action.taskKey] = action.sessionId;
    return;
  }

  wf.reviewerSessions![action.taskKey] = action.sessionId;
}

export async function dispatchWorkflowAction(
  stateStore: OttoStateStore<OttoStateV1>,
  action: WorkflowStateAction,
): Promise<void> {
  await stateStore.update((draft) => {
    applyWorkflowAction(draft, action);
  });
}
