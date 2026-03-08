import type { OttoConfig } from "@otto/config";
import type { OttoExec, OttoPromptAdapter, OttoRunner } from "@otto/ports";

import type { OttoProcessRegistry } from "../process-registry.js";
import type { OttoStateV1 } from "../state.js";

import type { OttoStateStore } from "./state-store.js";
import type { OttoRunEventLogger } from "./events.js";

export type OttoWorkflowRunners = {
  lead: OttoRunner;
  task: OttoRunner;
  reviewer: OttoRunner;
  summarize: OttoRunner;
};

export type OttoWorkflowRuntime = {
  config: OttoConfig;
  prompt: OttoPromptAdapter;
  exec: OttoExec;
  registry: OttoProcessRegistry;
  stateStore: OttoStateStore<OttoStateV1>;
  state: OttoStateV1;
  runners: OttoWorkflowRunners;
  reminders: {
    techLead: string[];
    task: string[];
    reviewer: string[];
  };
  events: OttoRunEventLogger;
};

export function resolveWorkflowRunners(
  config: OttoConfig,
): OttoWorkflowRunners {
  const def = config.runners.default;
  return {
    lead: config.runners.byRole?.lead ?? def,
    task: config.runners.byRole?.task ?? def,
    reviewer: config.runners.byRole?.reviewer ?? def,
    summarize: config.runners.byRole?.summarize ?? def,
  };
}
