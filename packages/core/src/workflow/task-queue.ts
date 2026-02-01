import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

import type { OttoWorkflowRuntime } from "./runtime.js";

export interface OttoTaskQueue {
  loadTasks(params: {
    runDir: string;
    ignoreState?: boolean;
  }): Promise<string[]>;
  addTaskToFront(taskFilePath: string): Promise<void>;
  addTaskToBack(taskFilePath: string): Promise<void>;
  removeCurrentTask(): Promise<void>;
  hasMoreTasks(): boolean;
  getCurrentTask(): string | undefined;
  getNextTaskNumber(runDir: string): number;
}

function getQueue(runtime: OttoWorkflowRuntime): string[] {
  const wf = runtime.state.workflow;
  const queue = Array.isArray(wf?.taskQueue) ? wf.taskQueue : [];
  return queue.filter((v): v is string => typeof v === "string");
}

async function setQueue(
  runtime: OttoWorkflowRuntime,
  next: string[],
): Promise<void> {
  await runtime.stateStore.update((draft) => {
    if (!draft.workflow) {
      draft.workflow = {
        phase: "execution",
        needsUserInput: false,
        taskQueue: [],
        taskAgentSessions: {},
        reviewerSessions: {},
      };
    }
    draft.workflow.taskQueue = next;
  });
}

export function createTaskQueue(runtime: OttoWorkflowRuntime): OttoTaskQueue {
  async function loadTasks({
    runDir,
    ignoreState,
  }: {
    runDir: string;
    ignoreState?: boolean;
  }): Promise<string[]> {
    const existingQueue = getQueue(runtime);
    if (!ignoreState && existingQueue.length > 0) {
      return existingQueue;
    }

    const files = await fs.readdir(runDir);
    const taskFiles = files
      .filter((file) => /^task-\d+-.*\.md$/.test(file))
      .filter(
        (file) => !fsSync.existsSync(path.join(runDir, `outcome-${file}`)),
      )
      .filter((file) => {
        const baseMatch = file.match(/^task-(\d+)-(.+?)\.md$/);
        const remediationMatch = file.match(
          /^task-(\d+)-(.+?)-remediation-(\d+)\.md$/,
        );

        if (baseMatch && !remediationMatch) {
          const [, taskNum, taskDesc] = baseMatch;
          const hasRemediations = files.some((candidate) => {
            const match = candidate.match(
              /^task-(\d+)-(.+?)-remediation-(\d+)\.md$/,
            );
            return match && match[1] === taskNum && match[2] === taskDesc;
          });
          return !hasRemediations;
        }

        if (remediationMatch) {
          const [, taskNum, taskDesc, remediationNum] = remediationMatch;
          const currentRemediation = Number.parseInt(remediationNum, 10);
          const remediationValues = files
            .filter((candidate) => {
              const match = candidate.match(
                /^task-(\d+)-(.+?)-remediation-(\d+)\.md$/,
              );
              return match && match[1] === taskNum && match[2] === taskDesc;
            })
            .map((candidate) => {
              const match = candidate.match(
                /^task-(\d+)-(.+?)-remediation-(\d+)\.md$/,
              );
              return match ? Number.parseInt(match[3], 10) : 0;
            });
          const maxValue =
            remediationValues.length > 0 ? Math.max(...remediationValues) : 0;
          return currentRemediation === maxValue;
        }

        return true;
      })
      .sort((a, b) => {
        const aMatch = a.match(/^task-(\d+)-(.+?)(?:-remediation-(\d+))?\.md$/);
        const bMatch = b.match(/^task-(\d+)-(.+?)(?:-remediation-(\d+))?\.md$/);
        if (!aMatch || !bMatch) return 0;
        const aTask = Number.parseInt(aMatch[1], 10);
        const bTask = Number.parseInt(bMatch[1], 10);
        const aRemediation = aMatch[3] ? Number.parseInt(aMatch[3], 10) : 0;
        const bRemediation = bMatch[3] ? Number.parseInt(bMatch[3], 10) : 0;
        if (aTask !== bTask) return aTask - bTask;
        return aRemediation - bRemediation;
      })
      .map((file) => path.join(runDir, file));

    await setQueue(runtime, taskFiles);
    return taskFiles;
  }

  async function addTaskToFront(taskFilePath: string): Promise<void> {
    const queue = getQueue(runtime);
    await setQueue(runtime, [taskFilePath, ...queue]);
  }

  async function addTaskToBack(taskFilePath: string): Promise<void> {
    const queue = getQueue(runtime);
    await setQueue(runtime, [...queue, taskFilePath]);
  }

  async function removeCurrentTask(): Promise<void> {
    const queue = getQueue(runtime);
    await setQueue(runtime, queue.slice(1));
  }

  function hasMoreTasks(): boolean {
    return getQueue(runtime).length > 0;
  }

  function getCurrentTask(): string | undefined {
    return getQueue(runtime)[0];
  }

  function getNextTaskNumber(runDir: string): number {
    try {
      const files = fsSync.readdirSync(runDir);
      const taskNumbers = files
        .map((file) => {
          const match = file.match(/^task-(\d+)-.*\.md$/);
          return match ? Number.parseInt(match[1], 10) : null;
        })
        .filter((v): v is number => v !== null);
      return taskNumbers.length > 0 ? Math.max(...taskNumbers) + 1 : 1;
    } catch {
      return 1;
    }
  }

  return {
    loadTasks,
    addTaskToFront,
    addTaskToBack,
    removeCurrentTask,
    hasMoreTasks,
    getCurrentTask,
    getNextTaskNumber,
  };
}
