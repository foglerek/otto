export type OttoCommand =
  | "root"
  | "help"
  | "create"
  | "ingest"
  | "start"
  | "resume"
  | "active"
  | "delete"
  | "config";

export type CommandHandler = (args: string[]) => Promise<void>;
