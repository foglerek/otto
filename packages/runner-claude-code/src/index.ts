import type {
  OttoRunner,
  OttoRunnerResult,
  OttoRunnerRunOptions,
} from "@otto/ports";

class ClaudeCodeRunner implements OttoRunner {
  readonly kind = "claude-code";
  readonly id = "claude-code";

  async run(_options: OttoRunnerRunOptions): Promise<OttoRunnerResult> {
    return {
      success: false,
      error:
        "@otto/runner-claude-code is scaffolded only. Implement CLI spawn + streaming parsing.",
    };
  }
}

export function createClaudeCodeRunner(): OttoRunner {
  return new ClaudeCodeRunner();
}
