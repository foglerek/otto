export type OttoCommand =
  | "root"
  | "help"
  | "onboarding"
  | "create"
  | "ingest"
  | "start"
  | "resume"
  | "active"
  | "delete"
  | "web"
  | "config";

export type CommandHandler = (args: string[]) => Promise<void>;
