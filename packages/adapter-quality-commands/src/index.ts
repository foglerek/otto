import type {
  OttoQualityGateAdapter,
  OttoQualityGateResult,
  OttoQualityCheckResult,
} from "@otto/ports";

class CommandQualityGateAdapter implements OttoQualityGateAdapter {
  async runChecks(args: {
    worktreePath: string;
    exec: import("@otto/ports").OttoExec;
    checks: import("@otto/ports").OttoQualityCheck[];
  }): Promise<OttoQualityGateResult> {
    const results: OttoQualityCheckResult[] = [];

    for (const check of args.checks) {
      const res = await args.exec.run(check.cmd, {
        cwd: args.worktreePath,
        env: check.env,
        timeoutMs: check.timeoutMs,
      });
      results.push({
        name: check.name,
        ok: res.exitCode === 0 && !res.timedOut,
        stdout: res.stdout,
        stderr: res.stderr,
      });
    }

    return {
      ok: results.every((r) => r.ok),
      results,
    };
  }
}

export function createCommandQualityGateAdapter(): OttoQualityGateAdapter {
  return new CommandQualityGateAdapter();
}
