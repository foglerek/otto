import { defineOttoConfig } from "@otto/config";
import { createGitWorktreeAdapter } from "@otto/adapter-git-worktree";
import { createEchoRunner } from "@otto/runner-echo";

// This is a minimal local config so `bun run --filter @otto/core build` and
// `bunx otto` have a sane default during early development.
//
// It does NOT attempt to bootstrap the repo (install deps, start services, etc.).

export default defineOttoConfig({
  worktree: {
    baseBranch: "main",
    branchNamer: ({ ticket }) => `otto-${ticket.date}-${ticket.slug}`,
    adapter: createGitWorktreeAdapter(),
    afterCreate: async () => {
      // repo bootstrap hook (intentionally empty for scaffolding)
    },
  },
  runners: {
    default: createEchoRunner(),
  },
});
