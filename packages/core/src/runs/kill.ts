import process from "node:process";

import type { OttoExec } from "@otto/ports";

import { looksLikeOttoProcessName } from "../locks/run-lock.js";

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function defaultGetProcessName(args: {
  pid: number;
  exec: OttoExec;
  cwd: string;
}): Promise<string> {
  if (process.platform === "win32") {
    return "";
  }
  const result = await args.exec.run(
    ["ps", "-p", String(args.pid), "-o", "comm="],
    { cwd: args.cwd, timeoutMs: 5_000, label: "ps" },
  );
  return result.stdout.trim();
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function killOttoProcess(args: {
  pid: number;
  exec: OttoExec;
  cwd: string;
  isAlive?: (pid: number) => boolean;
  getProcessName?: (pid: number) => Promise<string>;
  sendSignal?: (pid: number, signal: NodeJS.Signals) => void;
}): Promise<void> {
  const isAlive = args.isAlive ?? defaultIsAlive;
  const getName = args.getProcessName
    ? args.getProcessName
    : (pid: number) => defaultGetProcessName({ pid, exec: args.exec, cwd: args.cwd });
  const sendSignal =
    args.sendSignal ?? ((pid: number, signal: NodeJS.Signals) => process.kill(pid, signal));

  if (!isAlive(args.pid)) return;

  const name = await getName(args.pid);
  if (!looksLikeOttoProcessName(name)) {
    throw new Error(
      `Refusing to kill pid ${args.pid} (process does not look like otto: ${name || "(unknown)"})`,
    );
  }

  try {
    sendSignal(args.pid, "SIGTERM");
  } catch {
    // best-effort
  }

  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (!isAlive(args.pid)) return;
    await sleep(100);
  }

  try {
    sendSignal(args.pid, "SIGKILL");
  } catch {
    // best-effort
  }
}
