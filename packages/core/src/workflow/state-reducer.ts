import path from "node:path";

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
    }
  | {
      type: "set-auto-retry-count";
      label: string;
      count: number;
      defaultPhase?: OttoWorkflowPhase;
    }
  | {
      type: "set-workflow-artifact-paths";
      runDir: string;
      planFilePath: string;
      decisionCardsPath: string;
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

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`Invalid workflow action: ${field} must be non-empty`);
  }
}

function isWithin(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
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
    if (action.queue.some((q) => q.trim().length === 0)) {
      throw new Error("Invalid workflow action: task queue entries must be non-empty");
    }
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
    assertNonEmpty(action.taskKey, "taskKey");
    wf.taskAgentSessions![action.taskKey] = action.sessionId;
    return;
  }

  if (action.type === "set-reviewer-session") {
    assertNonEmpty(action.taskKey, "taskKey");
    wf.reviewerSessions![action.taskKey] = action.sessionId;
    return;
  }

  if (action.type === "set-auto-retry-count") {
    if (!Number.isInteger(action.count) || action.count < 0) {
      throw new Error("Invalid workflow action: auto-retry count must be a non-negative integer");
    }
    assertNonEmpty(action.label, "label");
    wf.autoRetryCounts![action.label] = action.count;
    return;
  }

  if (!path.isAbsolute(action.runDir)) {
    throw new Error("Invalid workflow action: runDir must be absolute");
  }
  if (!path.isAbsolute(action.planFilePath)) {
    throw new Error("Invalid workflow action: planFilePath must be absolute");
  }
  if (!path.isAbsolute(action.decisionCardsPath)) {
    throw new Error("Invalid workflow action: decisionCardsPath must be absolute");
  }
  if (!isWithin(action.runDir, action.planFilePath)) {
    throw new Error("Invalid workflow action: planFilePath must be within runDir");
  }
  if (!isWithin(action.runDir, action.decisionCardsPath)) {
    throw new Error("Invalid workflow action: decisionCardsPath must be within runDir");
  }

  wf.runDir = action.runDir;
  wf.planFilePath = action.planFilePath;
  wf.decisionCardsPath = action.decisionCardsPath;
}

export async function dispatchWorkflowAction(
  stateStore: OttoStateStore<OttoStateV1>,
  action: WorkflowStateAction,
): Promise<void> {
  await stateStore.update((draft) => {
    applyWorkflowAction(draft, action);
  });
}
