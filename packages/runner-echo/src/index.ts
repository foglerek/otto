import type {
  OttoRunner,
  OttoRunnerResult,
  OttoRunnerRunOptions,
} from "@otto/ports";

class EchoRunner implements OttoRunner {
  readonly kind = "echo";
  readonly id = "echo";

  async run(options: OttoRunnerRunOptions): Promise<OttoRunnerResult> {
    return {
      success: true,
      sessionId: options.sessionId ?? "echo-session",
      outputText: `${options.prompt}\n\n<OK>\n`,
    };
  }
}

export function createEchoRunner(): OttoRunner {
  return new EchoRunner();
}
