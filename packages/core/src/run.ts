import type { OttoConfig } from "@otto/config";
import type { OttoPromptAdapter } from "@otto/ports";

import { createAgUiEventLogger, mapExecEventToAgUi, mapExecStartToAgUi, mapRunEventToAgUi } from "./ag-ui.js";
import { createNodeExec } from "./exec.js";
import {
  attachProcessRegistryExitHandlers,
  createProcessRegistry,
} from "./process-registry.js";
import type { OttoStateV1 } from "./state.js";

import { createOttoStateStore } from "./workflow/state-store.js";
import { resolveWorkflowRunners } from "./workflow/runtime.js";
import { runWorkflowOrchestrator } from "./workflow/orchestrator.js";
import { getFinalReportPath, getPlanFilePath } from "./workflow/paths.js";
import { createRunEventLogger, emitRunEvent } from "./workflow/events.js";
import type { OttoExecEvent, OttoExecStartEvent, OttoRunEvent } from "./workflow/events.js";

function toPreview(text: string, maxChars = 2000): string {
  if (text.length <= maxChars) {
    return text;
  }
  const half = Math.floor(maxChars / 2);
  const hidden = text.length - half * 2;
  return [
    text.slice(0, half),
    `\n...[truncated ${hidden} chars]...\n`,
    text.slice(text.length - half),
  ].join("");
}

export function buildRunDefaultEnv(state: OttoStateV1): Record<string, string> {
  return {
    ...(state.env ?? {}),
    ...(state.testEnv ?? {}),
  };
}

function mergeExecEnv(
  defaultEnv: Record<string, string>,
  overrideEnv: Record<string, string> | undefined,
): Record<string, string> {
  return {
    ...defaultEnv,
    ...(overrideEnv ?? {}),
  };
}

export async function runOttoRun(args: {
  state: OttoStateV1;
  stateFilePath: string;
  config: OttoConfig;
  prompt: OttoPromptAdapter;
  onRunEvent?: (event: OttoRunEvent) => void | Promise<void>;
  onExecStart?: (event: OttoExecStartEvent) => void | Promise<void>;
  onExecEvent?: (event: OttoExecEvent) => void | Promise<void>;
}): Promise<{
  planFilePath: string;
  finalReportPath: string;
  stoppedAtPhase: string;
}> {
  const registry = createProcessRegistry();
  const detachHandlers = attachProcessRegistryExitHandlers(registry);
  const fileEvents = createRunEventLogger({ runId: args.state.runId, runDir: args.state.runDir });
  const agUiEvents = createAgUiEventLogger({ runDir: args.state.runDir });
  const events = {
    append: async (event: OttoRunEvent): Promise<void> => {
      await fileEvents.append(event);
      await agUiEvents.appendMany(mapRunEventToAgUi(event));
      if (args.onRunEvent) {
        await args.onRunEvent(event);
      }
    },
    appendExec: async (event: OttoExecEvent): Promise<void> => {
      await fileEvents.appendExec(event);
      await agUiEvents.appendMany(mapExecEventToAgUi(event));
      if (args.onExecEvent) {
        await args.onExecEvent(event);
      }
    },
  };
  const rawExec = createNodeExec({
    registry,
    onStart: async (event) => {
      const execStartEvent = {
        at: new Date().toISOString(),
        runId: args.state.runId,
        execId: event.execId,
        label: event.label,
        cmd: event.cmd,
        cwd: event.cwd,
      };
      await agUiEvents.appendMany(mapExecStartToAgUi(execStartEvent));
      if (!args.onExecStart) return;
      await args.onExecStart(execStartEvent);
    },
    onResult: async (event) => {
      await events.appendExec({
        at: new Date().toISOString(),
        runId: args.state.runId,
        execId: event.execId,
        label: event.label,
        cmd: event.cmd,
        cwd: event.cwd,
        exitCode: event.exitCode,
        timedOut: event.timedOut,
        durationMs: event.durationMs,
        stdoutBytes: Buffer.byteLength(event.stdout, "utf8"),
        stderrBytes: Buffer.byteLength(event.stderr, "utf8"),
        stdoutPreview: toPreview(event.stdout),
        stderrPreview: toPreview(event.stderr),
      });
    },
  });

  const defaultExecEnv = buildRunDefaultEnv(args.state);
  const exec = {
    run: async (cmd: string[], options: {
      cwd: string;
      env?: Record<string, string>;
      timeoutMs?: number;
      stdin?: string;
      label?: string;
    }) =>
      await rawExec.run(cmd, {
        ...options,
        env: mergeExecEnv(defaultExecEnv, options.env),
      }),
  };

  const stateStore = createOttoStateStore({ filePath: args.stateFilePath, initialState: args.state });

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
    events,
  };

  try {
    await emitRunEvent({
      logger: events,
      runId: args.state.runId,
      type: "run_started",
      data: {
        stateFilePath: args.stateFilePath,
        worktreePath: args.state.worktree.worktreePath,
      },
    });

    const { stoppedAtPhase } = await runWorkflowOrchestrator({ runtime });
    const planFilePath = getPlanFilePath(runtime.state);
    const finalReportPath = getFinalReportPath(runtime.state);

    await emitRunEvent({
      logger: events,
      runId: args.state.runId,
      type: "run_stopped",
      data: {
        stoppedAtPhase,
        planFilePath,
        finalReportPath,
      },
    });

    return { planFilePath, finalReportPath, stoppedAtPhase };
  } catch (error) {
    await emitRunEvent({
      logger: events,
      runId: args.state.runId,
      type: "run_failed",
      data: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  } finally {
    await emitRunEvent({
      logger: events,
      runId: args.state.runId,
      type: "run_finished",
      data: {
        activeChildren: registry.size(),
      },
    });
    detachHandlers();
    registry.killAll("run complete");
  }
}
