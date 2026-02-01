import { spawn } from "node:child_process";

import type { OttoExec, OttoExecResult } from "@otto/ports";

import type { OttoProcessRegistry } from "./process-registry.js";

export function createNodeExec(args?: {
  registry?: OttoProcessRegistry;
}): OttoExec {
  return {
    async run(cmd, options): Promise<OttoExecResult> {
      return await new Promise((resolve) => {
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
          resolve({
            exitCode: code ?? 1,
            stdout,
            stderr,
            timedOut,
          });
        });

        child.on("error", (err) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          unregister?.();
          resolve({
            exitCode: 1,
            stdout,
            stderr: stderr + String(err),
            timedOut,
          });
        });
      });
    },
  };
}
