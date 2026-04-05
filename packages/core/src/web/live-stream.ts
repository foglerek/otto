import fs from "node:fs/promises";
import path from "node:path";

import type http from "node:http";

import { loadWebDashboardData, loadWebRunDetailData } from "../services/web.js";
import type { OttoWebControlPlane, OttoWebControlPlaneSnapshot } from "./control-plane.js";

interface LiveStreamClient {
  id: string;
  res: http.ServerResponse;
  selectedRunId: string | null;
  lastDashboard: string | null;
  lastRunDetails: Map<string, string>;
}

function sseWrite(res: http.ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export class OttoWebLiveStreamHub {
  private readonly clients = new Map<string, LiveStreamClient>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private nextClientId = 1;
  private readonly cwd: string;
  private readonly controlPlane: OttoWebControlPlane;
  private readonly artifactRootDir: string;
  private readonly unsubscribeControlPlane: () => void;

  constructor(args: {
    cwd: string;
    controlPlane: OttoWebControlPlane;
    artifactRootDir: string;
  }) {
    this.cwd = args.cwd;
    this.controlPlane = args.controlPlane;
    this.artifactRootDir = args.artifactRootDir;
    this.unsubscribeControlPlane = this.controlPlane.subscribe(async (snapshot) => {
      await this.broadcastControlPlane(snapshot);
    });
  }

  async addClient(args: {
    req: http.IncomingMessage;
    res: http.ServerResponse;
    selectedRunId?: string | null;
  }): Promise<void> {
    const id = `stream-${this.nextClientId}`;
    this.nextClientId += 1;

    args.res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    args.res.write(": connected\n\n");

    const client: LiveStreamClient = {
      id,
      res: args.res,
      selectedRunId: args.selectedRunId ?? null,
      lastDashboard: null,
      lastRunDetails: new Map(),
    };
    this.clients.set(id, client);
    this.ensureTimers();

    args.req.on("close", () => {
      this.clients.delete(id);
      this.cleanupTimersIfIdle();
    });

    await this.sendInitialSnapshot(client);
  }

  close(): void {
    this.unsubscribeControlPlane();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const client of this.clients.values()) {
      client.res.end();
    }
    this.clients.clear();
  }

  private ensureTimers(): void {
    if (!this.heartbeatTimer) {
      this.heartbeatTimer = setInterval(() => {
        for (const client of this.clients.values()) {
          client.res.write(": heartbeat\n\n");
        }
      }, 15_000);
    }

    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => {
        void this.pollAndBroadcast();
      }, 1_500);
    }
  }

  private cleanupTimersIfIdle(): void {
    if (this.clients.size > 0) {
      return;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async sendInitialSnapshot(client: LiveStreamClient): Promise<void> {
    const dashboard = await loadWebDashboardData(this.cwd);
    const controlPlane = this.controlPlane.getSnapshot();
    sseWrite(client.res, "dashboard", dashboard);
    client.lastDashboard = JSON.stringify(dashboard);
    sseWrite(client.res, "control-plane", controlPlane);

    if (client.selectedRunId) {
      await this.sendRunDetailIfChanged(client, client.selectedRunId, true);
    }
  }

  private async pollAndBroadcast(): Promise<void> {
    if (this.clients.size === 0) {
      return;
    }

    const dashboard = await loadWebDashboardData(this.cwd);
    const encodedDashboard = JSON.stringify(dashboard);

    for (const client of this.clients.values()) {
      if (client.lastDashboard !== encodedDashboard) {
        sseWrite(client.res, "dashboard", dashboard);
        client.lastDashboard = encodedDashboard;
      }

      if (client.selectedRunId) {
        await this.sendRunDetailIfChanged(client, client.selectedRunId, false);
      }
    }
  }

  private async broadcastControlPlane(snapshot: OttoWebControlPlaneSnapshot): Promise<void> {
    for (const client of this.clients.values()) {
      sseWrite(client.res, "control-plane", snapshot);
    }
  }

  private async sendRunDetailIfChanged(
    client: LiveStreamClient,
    runId: string,
    force: boolean,
  ): Promise<void> {
    const stateFilePath = path.join(this.artifactRootDir, "states", `run-${runId}.json`);
    if (!(await fileExists(stateFilePath))) {
      if (client.lastRunDetails.has(runId) || force) {
        sseWrite(client.res, "run-detail", { runId, detail: null });
        client.lastRunDetails.delete(runId);
      }
      return;
    }

    const detail = await loadWebRunDetailData({ cwd: this.cwd, runId });
    const encoded = JSON.stringify(detail);
    if (!force && client.lastRunDetails.get(runId) === encoded) {
      return;
    }

    sseWrite(client.res, "run-detail", { runId, detail });
    client.lastRunDetails.set(runId, encoded);
  }
}
