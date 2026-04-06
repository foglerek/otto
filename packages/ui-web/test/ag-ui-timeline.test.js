import assert from "node:assert/strict";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const mod = await jiti(new URL("../src/ag-ui-timeline.ts", import.meta.url).href);

test("timeline extracts action-focused message headlines", () => {
  const items = mod.buildAgUiTimeline("run-1", [
    {
      type: "TEXT_MESSAGE_START",
      messageId: "m1",
      timestamp: 1,
      rawEvent: {
        type: "assistant",
        message: { model: "claude-sonnet-4-6" },
      },
    },
    {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "m1",
      timestamp: 1,
      delta: "I have the top-level constraints and the original auth final report. Next I’m checking the current Expo, auth, env, and deployment docs so the plan reflects what already landed versus what is still missing.",
      rawEvent: {
        type: "assistant",
        message: { model: "claude-sonnet-4-6" },
      },
    },
    {
      type: "TEXT_MESSAGE_END",
      messageId: "m1",
      timestamp: 1,
      rawEvent: {
        type: "assistant",
        message: { model: "claude-sonnet-4-6" },
      },
    },
  ]);

  assert.equal(items.length, 1);
  assert.match(items[0].title, /^Checking the current Expo, auth, env, and deployment docs/i);
  assert.equal(items[0].meta, "claude-sonnet-4-6");
});

test("timeline keeps multiline summaries as titles plus remaining detail", () => {
  const items = mod.buildAgUiTimeline("run-1", [
    {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "m2",
      timestamp: 2,
      delta: "All changes are done. Here's a summary:\n\n- Updated docs\n- Added tests\n\n<OK>",
    },
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0].title, "All changes are done.");
  assert.doesNotMatch(items[0].body, /^All changes are done/i);
  assert.match(items[0].body, /Updated docs/);
});
