import { expect, test } from "bun:test";

import { createTestRenderer } from "@opentui/core/testing";
import { baseComponents, createElement, createRoot } from "@opentui/react";

test("OpenTUI test renderer can mount a minimal React tree", async () => {
  const testRenderer = await createTestRenderer({});
  const root = createRoot(testRenderer.renderer);

  try {
    root.render(
      createElement(
        baseComponents.box,
        {},
        createElement(baseComponents.text, { content: "Smoke" }),
      ),
    );
    await testRenderer.renderOnce();

    const snapshot = testRenderer.captureSpans();
    expect(snapshot.lines.length).toBeGreaterThan(0);
  } finally {
    root.unmount();
    testRenderer.renderer.destroy();
  }
});
