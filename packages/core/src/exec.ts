import { spawn } from "node:child_process";

import type { OttoExec, OttoExecResult } from "@otto/ports";

import type { OttoProcessRegistry } from "./process-registry.js";

export function createNodeExec(args?: {
  registry?: OttoProcessRegistry;
  onStart?: (event: {
    execId: string;
    label: string;
    cmd: string[];
    cwd: string;
  }) => void | Promise<void>;
  onResult?: (event: {
    execId: string;
    label: string;
    cmd: string[];
    cwd: string;
    exitCode: number;
    timedOut: boolean;
    durationMs: number;
    stdout: string;
    stderr: string;
  }) => void | Promise<void>;
}): OttoExec {
  let nextExecId = 1;

  return {
    async run(cmd, options): Promise<OttoExecResult> {
      return await new Promise((resolve) => {
        const startedAt = Date.now();
        const execId = `exec-${nextExecId}`;
        nextExecId += 1;
        const detached = process.platform !== "win32";
        const child = spawn(cmd[0], cmd.slice(1), {
          cwd: options.cwd,
          env: { ...process.env, ...options.env },
          stdio: ["pipe", "pipe", "pipe"],
          detached,
        });

        const unregister = args?.registry?.register(child, {
          label: options.label ?? cmd.join(" "),
          cmd,
          cwd: options.cwd,
          detached,
        });

        void args?.onStart?.({
          execId,
          label: options.label ?? cmd.join(" "),
          cmd,
          cwd: options.cwd,
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (d) => {
          stdout += String(d);
        });
        child.stderr.on("data", (d) => {
          stderr += String(d);
        });

        let timedOut = false;
        let timeoutHandle: NodeJS.Timeout | undefined;
        if (
          options.timeoutMs &&
          options.timeoutMs > 0 &&
          Number.isFinite(options.timeoutMs)
        ) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            try {
              if (detached && child.pid && process.platform !== "win32") {
                process.kill(-child.pid, "SIGTERM");
              } else {
                child.kill("SIGTERM");
              }
            } catch {
              // ignore
            }

            setTimeout(() => {
              try {
                if (detached && child.pid && process.platform !== "win32") {
                  process.kill(-child.pid, "SIGKILL");
                } else if (process.platform !== "win32") {
                  child.kill("SIGKILL");
                }
              } catch {
                // ignore
              }
            }, 250);
          }, options.timeoutMs);
        }

        if (typeof options.stdin === "string") {
          child.stdin.end(options.stdin);
        } else {
          child.stdin.end();
        }

        child.on("close", (code) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          unregister?.();
          const result = {
            exitCode: code ?? 1,
            stdout,
            stderr,
            timedOut,
          };
          void args?.onResult?.({
            execId,
            label: options.label ?? cmd.join(" "),
            cmd,
            cwd: options.cwd,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            durationMs: Date.now() - startedAt,
            stdout: result.stdout,
            stderr: result.stderr,
          });
          resolve(result);
        });

        child.on("error", (err) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          unregister?.();
          const result = {
            exitCode: 1,
            stdout,
            stderr: stderr + String(err),
            timedOut,
          };
          void args?.onResult?.({
            execId,
            label: options.label ?? cmd.join(" "),
            cmd,
            cwd: options.cwd,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            durationMs: Date.now() - startedAt,
            stdout: result.stdout,
            stderr: result.stderr,
          });
          resolve(result);
        });
      });
    },
  };
}
