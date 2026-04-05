import { spawn } from "node:child_process";

import type { OttoExec, OttoExecResult } from "@otto/ports";

import type { OttoProcessRegistry } from "./process-registry.js";

function createLineEmitter(args: {
  emit?: (line: string) => void | Promise<void>;
}): {
  push(chunk: string): void;
  flush(): Promise<void>;
  done(): Promise<void>;
} {
  let buffer = "";
  let queue = Promise.resolve();

  function enqueue(line: string): void {
    if (!args.emit) {
      return;
    }
    queue = queue.then(async () => {
      await args.emit?.(line);
    });
  }

  return {
    push(chunk: string) {
      buffer += chunk;
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() ?? "";
      for (const line of parts) {
        enqueue(line);
      }
    },
    async flush() {
      if (buffer.length > 0) {
        enqueue(buffer);
        buffer = "";
      }
      await queue;
    },
    async done() {
      await queue;
    },
  };
}

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
        const stdoutEmitter = createLineEmitter({ emit: options.onStdoutLine });
        const stderrEmitter = createLineEmitter({ emit: options.onStderrLine });

        child.stdout.on("data", (d) => {
          const chunk = String(d);
          stdout += chunk;
          stdoutEmitter.push(chunk);
        });
        child.stderr.on("data", (d) => {
          const chunk = String(d);
          stderr += chunk;
          stderrEmitter.push(chunk);
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

        child.on("close", async (code) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          unregister?.();
          await stdoutEmitter.flush();
          await stderrEmitter.flush();
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

        child.on("error", async (err) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          unregister?.();
          await stdoutEmitter.done();
          await stderrEmitter.done();
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
