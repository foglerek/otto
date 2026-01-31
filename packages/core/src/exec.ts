import { spawn } from "node:child_process";

import type { OttoExec, OttoExecResult } from "@otto/ports";

export function createNodeExec(): OttoExec {
  return {
    async run(cmd, options): Promise<OttoExecResult> {
      return await new Promise((resolve) => {
        const child = spawn(cmd[0], cmd.slice(1), {
          cwd: options.cwd,
          env: { ...process.env, ...options.env },
          stdio: ["ignore", "pipe", "pipe"],
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
            child.kill("SIGKILL");
          }, options.timeoutMs);
        }

        child.on("close", (code) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          resolve({
            exitCode: code ?? 1,
            stdout,
            stderr,
            timedOut,
          });
        });

        child.on("error", (err) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
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
