import fs from "node:fs/promises";
import path from "node:path";

function buildFailureTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function archiveFailedTaskArtifacts(args: {
  runDir: string;
  baseTaskName: string;
  timestamp?: string;
}): Promise<string> {
  const timestamp = args.timestamp ?? buildFailureTimestamp();
  const prefix = `failed-${timestamp}-`;
  const baseTaskFile = `${args.baseTaskName}.md`;
  const entries = await fs.readdir(args.runDir, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile()) return;
      const name = entry.name;
      if (!name.includes(args.baseTaskName)) return;
      if (name === baseTaskFile) return;
      if (name.startsWith("failed-")) return;

      const from = path.join(args.runDir, name);
      const to = path.join(args.runDir, `${prefix}${name}`);
      await fs.rename(from, to);
    }),
  );

  return timestamp;
}
