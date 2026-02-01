import path from "node:path";

import type { OttoStateV1 } from "../state.js";
import { getRunDir } from "./paths.js";

export function reportFilePath(state: OttoStateV1, taskFile: string): string {
  return path.join(getRunDir(state), `report-${path.basename(taskFile)}`);
}

export function reviewFilePath(state: OttoStateV1, taskFile: string): string {
  return path.join(getRunDir(state), `review-${path.basename(taskFile)}`);
}

export function outcomeFilePath(state: OttoStateV1, taskFile: string): string {
  return path.join(getRunDir(state), `outcome-${path.basename(taskFile)}`);
}

export function summaryReportFilePath(
  state: OttoStateV1,
  reportFilePathValue: string,
): string {
  const dir = path.dirname(reportFilePathValue);
  const base = path.basename(reportFilePathValue);
  return path.join(dir, `summary-${base}`);
}

export function summaryReviewFilePath(
  state: OttoStateV1,
  reviewFilePathValue: string,
): string {
  const dir = path.dirname(reviewFilePathValue);
  const base = path.basename(reviewFilePathValue);
  return path.join(dir, `summary-${base}`);
}

export function remediationTaskFilePath(args: {
  state: OttoStateV1;
  baseTaskName: string;
  attempt: number;
}): string {
  return path.join(
    getRunDir(args.state),
    `${args.baseTaskName}-remediation-${args.attempt}.md`,
  );
}
