import React from "react";

export function CollapsibleCard(props: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <details className="panel collapsible-card" open={props.defaultOpen}>
      <summary className="collapsible-summary">
        <div>
          <p className="eyebrow">{props.title}</p>
          {props.subtitle ? <p className="subtle">{props.subtitle}</p> : null}
        </div>
        <span className="badge mono collapsible-badge">toggle</span>
      </summary>
      <div className="stack collapsible-body">{props.children}</div>
    </details>
  );
}
