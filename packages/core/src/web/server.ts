import { spawn } from "node:child_process";
import http from "node:http";
import process from "node:process";

import { UI_WEB_APP_SCRIPT, UI_WEB_STYLES, renderUiWebDocument } from "@otto/ui-web";

import { ensureRepoSetup } from "../repo-setup.js";
import { createManagedTicket, deleteManagedRun, ingestManagedTicket, listManagedTickets } from "../services/actions.js";
import { mergeBackManagedRun, resumeManagedRun, startManagedRun } from "../services/run-actions.js";
import { getStateFilePathForRunId } from "../runs/paths.js";
import { loadOttoState } from "../state.js";
import { loadWebDashboardData, loadWebRunDetailData, resolveWebRepoContext } from "../services/web.js";
import { createOttoWebControlPlane, type OttoWebControlPlane } from "./control-plane.js";
import { streamAgUiRunEvents } from "./ag-ui-stream.js";
import { OttoWebLiveStreamHub } from "./live-stream.js";

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

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text) as unknown;
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

function serveStaticAsset(pathname: string, res: http.ServerResponse): boolean {
  if (pathname === "/") {
    writeResponse(res, 200, renderUiWebDocument(), "text/html; charset=utf-8");
    return true;
  }

  if (pathname === "/styles.css") {
    writeResponse(res, 200, UI_WEB_STYLES, "text/css; charset=utf-8");
    return true;
  }

  if (pathname === "/app.js") {
    writeResponse(res, 200, UI_WEB_APP_SCRIPT, "text/javascript; charset=utf-8");
    return true;
  }

  return false;
}

async function handleSimpleApiRoutes(args: {
  cwd: string;
  pathname: string;
  method: string;
  res: http.ServerResponse;
  controlPlane: OttoWebControlPlane;
  req: http.IncomingMessage;
  requestUrl: URL;
  liveStreamHub: OttoWebLiveStreamHub;
}): Promise<boolean> {
  if (args.pathname === "/api/status") {
    writeJson(args.res, 200, await loadWebDashboardData(args.cwd));
    return true;
  }

  if (args.pathname === "/api/control-plane" && args.method === "GET") {
    writeJson(args.res, 200, args.controlPlane.getSnapshot());
    return true;
  }

  if (args.pathname === "/api/stream" && args.method === "GET") {
    const selectedRunId = args.requestUrl.searchParams.get("runId");
    await args.liveStreamHub.addClient({
      req: args.req,
      res: args.res,
      selectedRunId,
    });
    return true;
  }

  if (args.pathname === "/api/tickets" && args.method === "GET") {
    writeJson(args.res, 200, await listManagedTickets(args.cwd));
    return true;
  }

  if (args.pathname === "/api/tickets/create" && args.method === "POST") {
    const body = (await readJsonBody(args.req)) as { ticketText?: unknown };
    const ticketText = typeof body.ticketText === "string" ? body.ticketText : "";
    writeJson(args.res, 200, await createManagedTicket({ cwd: args.cwd, ticketText }));
    return true;
  }

  if (args.pathname === "/api/tickets/ingest" && args.method === "POST") {
    const body = (await readJsonBody(args.req)) as {
      sourceText?: unknown;
      sourceName?: unknown;
    };
    const sourceText = typeof body.sourceText === "string" ? body.sourceText : "";
    const sourceName = typeof body.sourceName === "string" ? body.sourceName : undefined;
    writeJson(args.res, 200, await ingestManagedTicket({ cwd: args.cwd, sourceText, sourceName }));
    return true;
  }

  if (args.pathname === "/api/runs") {
    const dashboard = await loadWebDashboardData(args.cwd);
    writeJson(args.res, 200, dashboard.runs);
    return true;
  }

  if (args.pathname === "/healthz") {
    writeJson(args.res, 200, { ok: true });
    return true;
  }

  return false;
}

async function handleRunMutationRoutes(args: {
  cwd: string;
  pathname: string;
  method: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  controlPlane: OttoWebControlPlane;
}): Promise<boolean> {
  if (args.pathname === "/api/runs/start" && args.method === "POST") {
    const body = (await readJsonBody(args.req)) as { ticketId?: unknown };
    const ticketId = typeof body.ticketId === "string" ? body.ticketId : "";
    const job = await args.controlPlane.startJob({
      kind: "start",
      runId: ticketId,
      run: async (jobSnapshot) =>
        await startManagedRun({
          cwd: args.cwd,
          ticketId,
          prompt: args.controlPlane.createPromptAdapter({
            jobId: jobSnapshot.id,
            runId: ticketId,
          }),
        }),
    });
    writeJson(args.res, 200, job);
    return true;
  }

  const deleteRunMatch = args.pathname.match(/^\/api\/runs\/([^/]+)\/delete$/);
  if (deleteRunMatch && args.method === "POST") {
    writeJson(args.res, 200, await deleteManagedRun({
      cwd: args.cwd,
      runId: decodeURIComponent(deleteRunMatch[1]),
    }));
    return true;
  }

  const resumeRunMatch = args.pathname.match(/^\/api\/runs\/([^/]+)\/resume$/);
  if (resumeRunMatch && args.method === "POST") {
    const runId = decodeURIComponent(resumeRunMatch[1]);
    const job = await args.controlPlane.startJob({
      kind: "resume",
      runId,
      run: async (jobSnapshot) =>
        await resumeManagedRun({
          cwd: args.cwd,
          runId,
          prompt: args.controlPlane.createPromptAdapter({
            jobId: jobSnapshot.id,
            runId,
          }),
        }),
    });
    writeJson(args.res, 200, job);
    return true;
  }

  const mergeBackMatch = args.pathname.match(/^\/api\/runs\/([^/]+)\/merge-back$/);
  if (mergeBackMatch && args.method === "POST") {
    const runId = decodeURIComponent(mergeBackMatch[1]);
    const job = await args.controlPlane.startJob({
      kind: "merge-back",
      runId,
      run: async (jobSnapshot) =>
        await mergeBackManagedRun({
          cwd: args.cwd,
          runId,
          prompt: args.controlPlane.createPromptAdapter({
            jobId: jobSnapshot.id,
            runId,
          }),
        }),
    });
    writeJson(args.res, 200, job);
    return true;
  }

  return false;
}

async function handleDynamicReadRoutes(args: {
  cwd: string;
  pathname: string;
  method: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  controlPlane: OttoWebControlPlane;
  artifactRootDir: string;
}): Promise<boolean> {
  const agUiMatch = args.pathname.match(/^\/api\/runs\/([^/]+)\/ag-ui$/);
  if (agUiMatch && args.method === "GET") {
    const runId = decodeURIComponent(agUiMatch[1]);
    const stateFilePath = getStateFilePathForRunId({
      artifactRootDir: args.artifactRootDir,
      runId,
    });
    const state = await loadOttoState(stateFilePath);
    await streamAgUiRunEvents({
      req: args.req,
      res: args.res,
      runDir: state.runDir,
    });
    return true;
  }

  const runMatch = args.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (runMatch) {
    writeJson(args.res, 200, await loadWebRunDetailData({
      cwd: args.cwd,
      runId: decodeURIComponent(runMatch[1]),
    }));
    return true;
  }

  const promptMatch = args.pathname.match(/^\/api\/prompts\/([^/]+)\/respond$/);
  if (promptMatch && args.method === "POST") {
    const body = (await readJsonBody(args.req)) as { value?: unknown };
    await args.controlPlane.respondToPrompt({
      promptId: decodeURIComponent(promptMatch[1]),
      value: body.value,
    });
    writeJson(args.res, 200, { ok: true });
    return true;
  }

  return false;
}

async function createHttpServer(cwd: string): Promise<{
  server: http.Server;
  liveStreamHub: OttoWebLiveStreamHub;
}> {
  const context = await resolveWebRepoContext(cwd);
  const { artifactPaths } = await ensureRepoSetup({
    mainRepoPath: context.mainRepoPath,
    config: context.config,
  });
  const controlPlane = await createOttoWebControlPlane({
    persistenceFilePath: `${artifactPaths.statesDir}/web-control-plane.json`,
  });
  const liveStreamHub = new OttoWebLiveStreamHub({
    cwd,
    controlPlane,
    artifactRootDir: artifactPaths.rootDir,
  });

  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url) {
        writeJson(res, 400, { error: "Missing request URL." });
        return;
      }

      const requestUrl = new URL(req.url, "http://127.0.0.1");
      const pathname = requestUrl.pathname;
      const method = req.method ?? "GET";

      if (serveStaticAsset(pathname, res)) {
        return;
      }

      const routeArgs = {
        cwd,
        pathname,
        method,
        req,
        res,
        controlPlane,
        requestUrl,
        liveStreamHub,
        artifactRootDir: artifactPaths.rootDir,
      };

      if (await handleSimpleApiRoutes(routeArgs)) {
        return;
      }

      if (await handleRunMutationRoutes(routeArgs)) {
        return;
      }

      if (await handleDynamicReadRoutes(routeArgs)) {
        return;
      }

      writeJson(res, 404, { error: `Not found: ${pathname}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeJson(res, 500, { error: message });
    }
  });

  return { server, liveStreamHub };
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
  const { server, liveStreamHub } = await createHttpServer(args.cwd);

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
      liveStreamHub.close();
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
