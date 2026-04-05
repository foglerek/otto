import React from "react";

import { formatDate, presentStageName, visiblePhaseProgress } from "./helpers.js";
import type { RunDetailData } from "./types.js";

function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T | null>(null);
  const [width, setWidth] = React.useState(0);

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(node);
    setWidth(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

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
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const visibleStepCount = width > 1320 ? 9 : width > 1120 ? 7 : width > 820 ? 5 : width > 560 ? 4 : 3;
  const visibleGroups = visiblePhaseProgress(props.phase, visibleStepCount);

  return (
    <div className="run-progress-strip" ref={ref}>
      {visibleGroups.map((group) => (
        <div className={`run-progress-group run-progress-${group.state}`} key={group.title}>
          <p className="eyebrow">{group.title}</p>
          <div className="run-progress-steps">
            {group.steps.map((item, index) => (
              <div className={`run-progress-step run-progress-step-${item.state}`} key={`${group.title}-${item.name}`}>
                <div className="run-progress-line">
                  <span className="run-progress-dot" />
                  {index < group.steps.length - 1 ? <span className="run-progress-connector" /> : null}
                </div>
                <p className="run-progress-label">{presentStageName(item.name)}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
