import { output } from "../output.js";
import { loadConfigFromCwd } from "../config.js";

export async function handleConfigCommand(): Promise<void> {
  const { config, configPath } = await loadConfigFromCwd();

  output(
    {
      action: "config",
      path: configPath,
      defaultRunner: config.runners?.default?.id ?? null,
    },
    [
      "Otto config:",
      `- Path: ${configPath}`,
      `- Default runner: ${config.runners?.default?.id ?? "(unknown)"}`,
      "",
    ],
  );
}
