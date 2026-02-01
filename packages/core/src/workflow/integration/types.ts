export type IntegrationStepOutcome =
  | "success"
  | "skipped"
  | "tasks-created"
  | "aborted";

export type IntegrationStepResult = {
  outcome: IntegrationStepOutcome;
  message?: string;
};
