import type { CommandHandler, OttoCommand } from "./types.js";

import { handleRootCommand } from "./root.js";
import { handleOnboardingCommand } from "./onboarding.js";
import { handleCreateCommand } from "./create.js";
import { handleIngestCommand } from "./ingest.js";
import { handleStartCommand } from "./start.js";
import { handleResumeCommand } from "./resume.js";
import { handleActiveCommand } from "./active.js";
import { handleDeleteCommand } from "./delete.js";
import { handleConfigCommand } from "./config.js";
import { printHelp } from "../output.js";

const commandHandlers: Record<OttoCommand, CommandHandler> = {
  root: handleRootCommand,
  help: async () => printHelp(),
  onboarding: async () => handleOnboardingCommand(),
  create: handleCreateCommand,
  ingest: handleIngestCommand,
  start: handleStartCommand,
  resume: handleResumeCommand,
  active: async () => handleActiveCommand(),
  delete: handleDeleteCommand,
  config: async () => handleConfigCommand(),
};

export function resolveCommandHandler(command: string): CommandHandler | null {
  return commandHandlers[command as OttoCommand] ?? null;
}
