import fs from "node:fs/promises";
import path from "node:path";

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
  prompts: OttoWebPromptSnapshot[];
}

interface OttoWebControlPlaneFileState extends OttoWebControlPlaneSnapshot {
  nextJobId: number;
  nextPromptId: number;
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
  private readonly pendingPrompts = new Map<string, PendingPromptRecord>();
  private readonly persistenceFilePath: string | null;
  private persistSequence = 1;

  constructor(args?: { persistenceFilePath?: string }) {
    this.persistenceFilePath = args?.persistenceFilePath ?? null;
  }

  async initialize(): Promise<void> {
    if (!this.persistenceFilePath) {
      return;
    }

    try {
      const raw = await fs.readFile(this.persistenceFilePath, "utf8");
      const parsed = JSON.parse(raw) as OttoWebControlPlaneFileState;
      this.nextJobId = Math.max(1, Number(parsed.nextJobId) || 1);
      this.nextPromptId = Math.max(1, Number(parsed.nextPromptId) || 1);
      this.jobs.clear();

      for (const job of parsed.jobs ?? []) {
        const normalized = { ...job };
        if (normalized.status === "running" || normalized.status === "waiting") {
          normalized.status = "failed";
          normalized.error = "Otto web server restarted before this job completed.";
          normalized.finishedAt = new Date().toISOString();
        }
        this.jobs.set(normalized.id, normalized);
      }

      this.pendingPrompts.clear();
      await this.persistSnapshot();
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") {
        throw error;
      }
    }
  }

  getSnapshot(): OttoWebControlPlaneSnapshot {
    return {
      jobs: [...this.jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
      prompts: [...this.pendingPrompts.values()]
        .map((entry) => entry.snapshot)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    };
  }

  hasActiveJobForRun(runId: string): boolean {
    return [...this.jobs.values()].some(
      (job) => job.runId === runId && (job.status === "running" || job.status === "waiting"),
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
    if (this.hasActiveJobForRun(args.runId)) {
      throw new Error(
        `An Otto web workflow is already active for ${args.runId}. Wait for it to finish or answer its pending prompt before starting another one.`,
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
    await this.persistSnapshot();

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
        const promptsForJob = [...this.pendingPrompts.values()].filter(
          (entry) => entry.snapshot.jobId === job.id,
        );
        for (const entry of promptsForJob) {
          entry.reject(new Error("Prompt cancelled because the job finished unexpectedly."));
          this.pendingPrompts.delete(entry.snapshot.id);
        }
        await this.persistSnapshot();
      }
    })();

    return { ...job };
  }

  async respondToPrompt(args: { promptId: string; value: unknown }): Promise<void> {
    const pending = this.pendingPrompts.get(args.promptId);
    if (!pending) {
      throw new Error(`Prompt not found: ${args.promptId}`);
    }

    this.pendingPrompts.delete(args.promptId);

    const job = this.jobs.get(pending.snapshot.jobId);
    const stillWaiting = [...this.pendingPrompts.values()].some(
      (entry) => entry.snapshot.jobId === pending.snapshot.jobId,
    );
    if (job && job.status === "waiting" && !stillWaiting) {
      job.status = "running";
    }

    await this.persistSnapshot();
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
    const job = this.jobs.get(args.jobId);
    if (!job) {
      throw new Error(`Prompt requested for unknown job: ${args.jobId}`);
    }
    const alreadyWaitingForJob = [...this.pendingPrompts.values()].some(
      (entry) => entry.snapshot.jobId === args.jobId,
    );
    if (alreadyWaitingForJob) {
      throw new Error(`Job ${args.jobId} already has a pending prompt.`);
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

    let resolvePending!: (value: unknown) => void;
    let rejectPending!: (error: Error) => void;
    const promise = new Promise<unknown>((resolve, reject) => {
      resolvePending = resolve;
      rejectPending = reject;
    });

    this.pendingPrompts.set(snapshot.id, {
      snapshot,
      resolve: resolvePending,
      reject: rejectPending,
    });
    await this.persistSnapshot();

    return await promise;
  }

  private async persistSnapshot(): Promise<void> {
    if (!this.persistenceFilePath) {
      return;
    }

    const payload: OttoWebControlPlaneFileState = {
      ...this.getSnapshot(),
      nextJobId: this.nextJobId,
      nextPromptId: this.nextPromptId,
    };

    await fs.mkdir(path.dirname(this.persistenceFilePath), { recursive: true });
    const tempFilePath = `${this.persistenceFilePath}.tmp-${this.persistSequence}`;
    this.persistSequence += 1;
    await fs.writeFile(tempFilePath, JSON.stringify(payload, null, 2), "utf8");
    await fs.rename(tempFilePath, this.persistenceFilePath);
  }
}

export async function createOttoWebControlPlane(args?: {
  persistenceFilePath?: string;
}): Promise<OttoWebControlPlane> {
  const controlPlane = new OttoWebControlPlane(args);
  await controlPlane.initialize();
  return controlPlane;
}
