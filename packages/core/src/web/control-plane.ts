import type { OttoPromptAdapter } from "@otto/ports";

export type OttoWebJobKind = "start" | "resume" | "merge-back";
export type OttoWebJobStatus = "running" | "waiting" | "succeeded" | "failed";
export type OttoWebPromptKind = "confirm" | "text" | "select";

export interface OttoWebPromptSnapshot {
  id: string;
  jobId: string;
  runId: string;
  kind: OttoWebPromptKind;
  message: string;
  choices?: string[];
  defaultValue?: string | boolean;
  createdAt: string;
}

export interface OttoWebJobSnapshot {
  id: string;
  kind: OttoWebJobKind;
  runId: string;
  status: OttoWebJobStatus;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  result?: unknown;
}

export interface OttoWebControlPlaneSnapshot {
  jobs: OttoWebJobSnapshot[];
  pendingPrompt: OttoWebPromptSnapshot | null;
}

interface OttoWebJobRecord extends OttoWebJobSnapshot {}

interface PendingPromptRecord {
  snapshot: OttoWebPromptSnapshot;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export class OttoWebControlPlane {
  private readonly jobs = new Map<string, OttoWebJobRecord>();
  private nextJobId = 1;
  private nextPromptId = 1;
  private pendingPrompt: PendingPromptRecord | null = null;

  getSnapshot(): OttoWebControlPlaneSnapshot {
    return {
      jobs: [...this.jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
      pendingPrompt: this.pendingPrompt?.snapshot ?? null,
    };
  }

  hasActiveInteractiveJob(): boolean {
    return [...this.jobs.values()].some(
      (job) => job.status === "running" || job.status === "waiting",
    );
  }

  createPromptAdapter(args: { jobId: string; runId: string }): OttoPromptAdapter {
    return {
      confirm: async (message, options) =>
        Boolean(
          await this.requestPrompt({
            jobId: args.jobId,
            runId: args.runId,
            kind: "confirm",
            message,
            defaultValue: options?.defaultValue,
          }),
        ),
      text: async (message, options) =>
        String(
          await this.requestPrompt({
            jobId: args.jobId,
            runId: args.runId,
            kind: "text",
            message,
            defaultValue: options?.defaultValue,
          }),
        ),
      select: async (message, options) => {
        const value = String(
          await this.requestPrompt({
            jobId: args.jobId,
            runId: args.runId,
            kind: "select",
            message,
            choices: options.choices,
            defaultValue: options.defaultValue,
          }),
        );
        if (!options.choices.includes(value)) {
          throw new Error(`Invalid prompt selection: ${value}`);
        }
        return value;
      },
    };
  }

  async startJob<TResult>(args: {
    kind: OttoWebJobKind;
    runId: string;
    run: (job: OttoWebJobSnapshot) => Promise<TResult>;
  }): Promise<OttoWebJobSnapshot> {
    if (this.hasActiveInteractiveJob()) {
      throw new Error(
        "An Otto web workflow is already running. Wait for it to finish or answer the pending prompt before starting another one.",
      );
    }

    const job: OttoWebJobRecord = {
      id: `job-${this.nextJobId}`,
      kind: args.kind,
      runId: args.runId,
      status: "running",
      startedAt: new Date().toISOString(),
    };
    this.nextJobId += 1;
    this.jobs.set(job.id, job);

    void (async () => {
      try {
        const result = await args.run(job);
        job.status = "succeeded";
        job.result = result;
        job.finishedAt = new Date().toISOString();
      } catch (error) {
        job.status = "failed";
        job.error = error instanceof Error ? error.message : String(error);
        job.finishedAt = new Date().toISOString();
      } finally {
        if (this.pendingPrompt?.snapshot.jobId === job.id) {
          this.pendingPrompt.reject(new Error("Prompt cancelled because the job finished unexpectedly."));
          this.pendingPrompt = null;
        }
      }
    })();

    return { ...job };
  }

  respondToPrompt(args: { promptId: string; value: unknown }): void {
    if (!this.pendingPrompt || this.pendingPrompt.snapshot.id !== args.promptId) {
      throw new Error(`Prompt not found: ${args.promptId}`);
    }

    const pending = this.pendingPrompt;
    this.pendingPrompt = null;

    const job = this.jobs.get(pending.snapshot.jobId);
    if (job && job.status === "waiting") {
      job.status = "running";
    }

    pending.resolve(args.value);
  }

  private async requestPrompt(args: {
    jobId: string;
    runId: string;
    kind: OttoWebPromptKind;
    message: string;
    choices?: string[];
    defaultValue?: string | boolean;
  }): Promise<unknown> {
    if (this.pendingPrompt) {
      throw new Error("Only one pending Otto web prompt is supported at a time.");
    }

    const job = this.jobs.get(args.jobId);
    if (!job) {
      throw new Error(`Prompt requested for unknown job: ${args.jobId}`);
    }
    job.status = "waiting";

    const snapshot: OttoWebPromptSnapshot = {
      id: `prompt-${this.nextPromptId}`,
      jobId: args.jobId,
      runId: args.runId,
      kind: args.kind,
      message: args.message,
      choices: args.choices,
      defaultValue: args.defaultValue,
      createdAt: new Date().toISOString(),
    };
    this.nextPromptId += 1;

    return await new Promise<unknown>((resolve, reject) => {
      this.pendingPrompt = {
        snapshot,
        resolve,
        reject,
      };
    });
  }
}

export function createOttoWebControlPlane(): OttoWebControlPlane {
  return new OttoWebControlPlane();
}
