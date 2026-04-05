import fs from "node:fs/promises";
import path from "node:path";

export interface OttoRunUiState {
  markedDone?: boolean;
  markedDoneAt?: string;
}

export function getRunUiStatePath(runDir: string): string {
  return path.join(runDir, "web-ui-state.json");
}

export async function readRunUiState(runDir: string): Promise<OttoRunUiState> {
  try {
    const raw = await fs.readFile(getRunUiStatePath(runDir), "utf8");
    const parsed = JSON.parse(raw) as OttoRunUiState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function writeRunUiState(runDir: string, state: OttoRunUiState): Promise<void> {
  await fs.writeFile(getRunUiStatePath(runDir), JSON.stringify(state, null, 2), "utf8");
}
