import React from "react";

import { fullPhaseProgress, formatDate, presentStageName } from "./helpers.js";
import type { RunDetailData } from "./types.js";

export function RunDetailStats(props: { detail: RunDetailData }): React.JSX.Element {
  const { detail } = props;
  return (
    <div className="grid-two" style={{ marginTop: 20 }}>
      <div className="panel">
        <dl className="keyvals">
          <dt>Created</dt><dd>{formatDate(detail.summary.createdAt)}</dd>
          <dt>Branch</dt><dd className="mono">{detail.summary.branchName}</dd>
          <dt>Base</dt><dd className="mono">{detail.summary.baseBranch}</dd>
          <dt>Worktree</dt><dd className="mono">{detail.worktreePath}</dd>
          <dt>State file</dt><dd className="mono">{detail.stateFilePath}</dd>
          <dt>Ticket file</dt><dd className="mono">{detail.ticketFilePath}</dd>
          {detail.summary.markedDoneAt ? <><dt>Marked done</dt><dd>{formatDate(detail.summary.markedDoneAt)}</dd></> : null}
        </dl>
      </div>
      <div className="panel">
        <dl className="keyvals">
          <dt>Queue length</dt><dd>{detail.summary.taskQueueLength}</dd>
          <dt>Artifacts</dt><dd>{detail.runFiles.length} files</dd>
          <dt>Plan</dt><dd>{detail.summary.planAvailable ? "present" : "missing"}</dd>
          <dt>Final report</dt><dd>{detail.summary.finalReportAvailable ? "present" : "missing"}</dd>
          <dt>Recent events</dt><dd>{detail.recentEvents.length}</dd>
          <dt>Recent execs</dt><dd>{detail.recentExecs.length}</dd>
        </dl>
      </div>
    </div>
  );
}

export function RunProgressStrip(props: { phase: string | null }): React.JSX.Element {
  const progress = fullPhaseProgress(props.phase);
  return (
    <div className="run-progress-strip">
      {progress.map((item, index) => (
        <div className={`run-progress-segment run-progress-${item.state}`} key={item.name} style={item.state === "current" ? { order: 2 } : item.state === "done" ? { order: 1 - index } : { order: 3 + index }}>
          <p className="eyebrow">Phase</p>
          <div className="run-progress-line">
            <span className="run-progress-dot" />
            <span className="run-progress-connector" />
          </div>
          <p className="run-progress-label">{presentStageName(item.name)}</p>
        </div>
      ))}
    </div>
  );
}
