import process from "node:process";

import { startOttoWebServer } from "../../web/server.js";
import { output } from "../output.js";

function parseWebArgs(args: string[]): {
  host?: string;
  port?: number;
  openBrowser: boolean;
} {
  const parsed: {
    host?: string;
    port?: number;
    openBrowser: boolean;
  } = {
    openBrowser: true,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--no-open") {
      parsed.openBrowser = false;
      continue;
    }

    if (arg === "--host") {
      parsed.host = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--port") {
      const next = args[index + 1];
      if (next === undefined) {
        throw new Error("Missing value for --port");
      }
      const parsedPort = Number.parseInt(next, 10);
      if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65535) {
        throw new Error(`Invalid --port value: ${next}`);
      }
      parsed.port = parsedPort;
      index += 1;
      continue;
    }

    throw new Error(`Unknown web argument: ${arg}`);
  }

  return parsed;
}

export async function handleWebCommand(args: string[]): Promise<void> {
  const options = parseWebArgs(args);
  const server = await startOttoWebServer({
    cwd: process.cwd(),
    host: options.host,
    port: options.port,
    shouldOpenBrowser: options.openBrowser,
  });

  output(
    {
      action: "web",
      url: server.url,
      host: server.host,
      port: server.port,
      openBrowser: options.openBrowser,
    },
    [
      `Otto Web running at: ${server.url}`,
      options.openBrowser ? "Browser launch requested." : "Browser launch skipped (--no-open).",
      "Press Ctrl+C to stop.",
      "",
    ],
  );

  await new Promise<void>((resolve, reject) => {
    let shuttingDown = false;

    const cleanup = async () => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      try {
        await server.close();
        resolve();
      } catch (error) {
        reject(error);
      }
    };

    const onSignal = () => {
      void cleanup();
    };

    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  });
}
