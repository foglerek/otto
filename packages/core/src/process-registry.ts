import type { ChildProcess } from "node:child_process";

type ProcessMeta = {
  label: string;
  cmd: string[];
  cwd: string;
  detached: boolean;
};

type ProcessEntry = {
  child: ChildProcess;
  meta: ProcessMeta;
};

export interface OttoProcessRegistry {
  register(child: ChildProcess, meta: ProcessMeta): () => void;
  killAll(reason: string): void;
  size(): number;
}

function safeKill(
  child: ChildProcess,
  detached: boolean,
  signal: NodeJS.Signals,
) {
  try {
    if (detached && child.pid && process.platform !== "win32") {
      // Kill the entire process group (best-effort).
      process.kill(-child.pid, signal);
      return;
    }

    child.kill(signal);
  } catch {
    // ignore
  }
}

export function createProcessRegistry(): OttoProcessRegistry {
  const entries = new Map<number, ProcessEntry>();

  return {
    register(child, meta) {
      if (!child.pid) return () => {};
      const pid = child.pid;
      entries.set(pid, { child, meta });
      return () => {
        entries.delete(pid);
      };
    },

    killAll(reason) {
      // Best-effort termination of all registered processes.
      for (const { child, meta } of entries.values()) {
        safeKill(child, meta.detached, "SIGTERM");
      }

      setTimeout(() => {
        for (const { child, meta } of entries.values()) {
          safeKill(child, meta.detached, "SIGKILL");
        }
      }, 250);

      void reason;
    },

    size() {
      return entries.size;
    },
  };
}

export function attachProcessRegistryExitHandlers(
  registry: OttoProcessRegistry,
): () => void {
  const onSigint = () => {
    registry.killAll("SIGINT");
    process.exit(130);
  };

  const onSigterm = () => {
    registry.killAll("SIGTERM");
    process.exit(143);
  };

  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  return () => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  };
}
