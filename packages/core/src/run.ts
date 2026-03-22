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
import { createRunEventLogger, emitRunEvent } from "./workflow/events.js";

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

export async function runOttoRun(args: {
  state: OttoStateV1;
  stateFilePath: string;
  config: OttoConfig;
  prompt: OttoPromptAdapter;
}): Promise<{ planFilePath: string; stoppedAtPhase: string }> {
  const registry = createProcessRegistry();
  const detachHandlers = attachProcessRegistryExitHandlers(registry);
  const events = createRunEventLogger({
    runId: args.state.runId,
    runDir: args.state.runDir,
  });
  const exec = createNodeExec({
    registry,
    onResult: async (event) => {
      await events.appendExec({
        at: new Date().toISOString(),
        runId: args.state.runId,
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

    await emitRunEvent({
      logger: events,
      runId: args.state.runId,
      type: "run_stopped",
      data: {
        stoppedAtPhase,
        planFilePath,
      },
    });

    return { planFilePath, stoppedAtPhase };
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
