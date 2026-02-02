import type { OttoExec, OttoRunner, OttoRunnerResult } from "@otto/ports";

import {
  clearProjectLeadSession,
  loadProjectLeadSession,
  saveProjectLeadSession,
} from "./session-store.js";

export async function runProjectLeadWithSession(args: {
  repoPath: string;
  runner: OttoRunner;
  exec: OttoExec;
  prompt: string;
  cwd: string;
  phaseName: string;
  timeoutMs?: number;
}): Promise<OttoRunnerResult> {
  const stored = await loadProjectLeadSession(args.repoPath);
  const runOnce = async (sessionId?: string) =>
    args.runner.run({
      role: "projectLead",
      phaseName: args.phaseName,
      prompt: args.prompt,
      cwd: args.cwd,
      exec: args.exec,
      sessionId,
      timeoutMs: args.timeoutMs,
    });

  let sessionId = stored?.sessionId;
  let result = await runOnce(sessionId);

  if (sessionId && !result.success) {
    await clearProjectLeadSession(args.repoPath);
    sessionId = undefined;
    result = await runOnce(undefined);
  }

  if (result.success) {
    const nextSessionId = result.sessionId ?? sessionId;
    if (nextSessionId) {
      await saveProjectLeadSession(args.repoPath, { sessionId: nextSessionId });
    }
  }

  return result;
}
