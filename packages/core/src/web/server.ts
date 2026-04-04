import { spawn } from "node:child_process";
import http from "node:http";
import process from "node:process";

import { UI_WEB_APP_SCRIPT, UI_WEB_STYLES, renderUiWebDocument } from "@otto/ui-web";

import { loadWebDashboardData, loadWebRunDetailData } from "../services/web.js";

export interface OttoWebServerHandle {
  url: string;
  host: string;
  port: number;
  close(): Promise<void>;
}

function writeResponse(res: http.ServerResponse, status: number, body: string, contentType: string): void {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  res.end(body);
}

function writeJson(res: http.ServerResponse, status: number, value: unknown): void {
  writeResponse(res, status, JSON.stringify(value), "application/json; charset=utf-8");
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const command =
    platform === "darwin"
      ? { cmd: "open", args: [url] }
      : platform === "win32"
        ? { cmd: "cmd", args: ["/c", "start", "", url] }
        : { cmd: "xdg-open", args: [url] };

  try {
    const child = spawn(command.cmd, command.args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch {
    // best effort only
  }
}

async function createHttpServer(cwd: string): Promise<http.Server> {
  return http.createServer(async (req, res) => {
    try {
      if (!req.url) {
        writeJson(res, 400, { error: "Missing request URL." });
        return;
      }

      const requestUrl = new URL(req.url, "http://127.0.0.1");
      const pathname = requestUrl.pathname;

      if (pathname === "/") {
        writeResponse(res, 200, renderUiWebDocument(), "text/html; charset=utf-8");
        return;
      }

      if (pathname === "/styles.css") {
        writeResponse(res, 200, UI_WEB_STYLES, "text/css; charset=utf-8");
        return;
      }

      if (pathname === "/app.js") {
        writeResponse(res, 200, UI_WEB_APP_SCRIPT, "text/javascript; charset=utf-8");
        return;
      }

      if (pathname === "/api/status") {
        writeJson(res, 200, await loadWebDashboardData(cwd));
        return;
      }

      if (pathname === "/api/runs") {
        const dashboard = await loadWebDashboardData(cwd);
        writeJson(res, 200, dashboard.runs);
        return;
      }

      const runMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
      if (runMatch) {
        writeJson(res, 200, await loadWebRunDetailData({
          cwd,
          runId: decodeURIComponent(runMatch[1]),
        }));
        return;
      }

      if (pathname === "/healthz") {
        writeJson(res, 200, { ok: true });
        return;
      }

      writeJson(res, 404, { error: `Not found: ${pathname}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeJson(res, 500, { error: message });
    }
  });
}

async function listen(server: http.Server, host: string, port: number): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const onError = (error: Error & { code?: string }) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not determine Otto web server address."));
        return;
      }
      resolve(address.port);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

export async function startOttoWebServer(args: {
  cwd: string;
  host?: string;
  port?: number;
  shouldOpenBrowser?: boolean;
}): Promise<OttoWebServerHandle> {
  const host = args.host ?? "127.0.0.1";
  const requestedPort = args.port ?? 4310;
  const server = await createHttpServer(args.cwd);

  let port: number;
  try {
    port = await listen(server, host, requestedPort);
  } catch (error) {
    const err = error as Error & { code?: string };
    if (requestedPort !== 0 && err.code === "EADDRINUSE") {
      port = await listen(server, host, 0);
    } else {
      throw error;
    }
  }

  const url = `http://${host}:${port}`;
  if (args.shouldOpenBrowser !== false) {
    openBrowser(url);
  }

  return {
    url,
    host,
    port,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
