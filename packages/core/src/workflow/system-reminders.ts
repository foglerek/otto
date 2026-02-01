import { untab } from "./untab.js";
import type { OttoWorkflowRuntime } from "./runtime.js";
import { getRunDir } from "./paths.js";

export function getTechLeadSystemReminder(
  runtime: OttoWorkflowRuntime,
  _stage: "planning" | "task-splitting" | "execution" | "review" | "summarize",
): string {
  const artifactRootDir = runtime.state.artifactRootDir;
  const runDir = getRunDir(runtime.state);
  const worktreePath = runtime.state.worktree.worktreePath;

  const reminders: string[] = [
    `All workflow artifacts MUST be written under the main repo artifact root: ${artifactRootDir}`,
    `Plan/task markdown artifacts MUST be written under: ${runDir}`,
    `Code changes MUST be made in the worktree: ${worktreePath}`,
    "Use absolute paths for any file read/write directives you provide.",
    `When writing artifacts under ${artifactRootDir}, reference repo files using absolute paths into the worktree (${worktreePath}).`,
    "When writing documentation text or code comments, use repo-root-relative paths (never absolute filesystem paths).",
    "Do NOT commit to git unless the phase explicitly instructs you to commit.",
  ];

  if (runtime.reminders.techLead.length > 0) {
    reminders.push(...runtime.reminders.techLead);
    runtime.reminders.techLead.length = 0;
  }

  return untab(`
<system-reminder>
${reminders.map((r) => `- ${r}`).join("\n")}
</system-reminder>
`);
}
