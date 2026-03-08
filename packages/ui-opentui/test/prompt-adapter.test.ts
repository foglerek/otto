import { describe, expect, test } from "bun:test";

import {
  PromptUnavailableError,
  createOpentuiPromptAdapter,
} from "../src/index.js";

describe("OpenTUI prompt adapter", () => {
  test("throws PromptUnavailableError when no TTY", async () => {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      // Skip in interactive terminals to avoid rendering prompt UI in tests.
      return;
    }

    const adapter = createOpentuiPromptAdapter();

    await expect(adapter.confirm("confirm?", { defaultValue: true })).rejects.toBeInstanceOf(
      PromptUnavailableError,
    );
    await expect(adapter.text("text?", { defaultValue: "x" })).rejects.toBeInstanceOf(
      PromptUnavailableError,
    );
    await expect(adapter.select("select?", { choices: ["a", "b"] })).rejects.toBeInstanceOf(
      PromptUnavailableError,
    );
  });
});
