import fs from "node:fs/promises";
import type http from "node:http";

import { EventType } from "@ag-ui/core";

import { getAgUiEventsPath, type OttoAgUiEvent } from "../ag-ui.js";
import type { OttoWebControlPlane, OttoWebControlPlaneSnapshot } from "./control-plane.js";

async function ensureFileOffset(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

function writeEvent(res: http.ServerResponse, event: OttoAgUiEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function replayFile(args: {
  filePath: string;
  res: http.ServerResponse;
}): Promise<number> {
  try {
    const raw = await fs.readFile(args.filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      writeEvent(args.res, JSON.parse(trimmed) as OttoAgUiEvent);
    }
    return Buffer.byteLength(raw, "utf8");
  } catch {
    return 0;
  }
}

function buildControlPlaneEvent(args: {
  runId: string;
  snapshot: OttoWebControlPlaneSnapshot;
}): OttoAgUiEvent {
  return {
    type: EventType.CUSTOM,
    name: "otto.control_plane",
    value: {
      runId: args.runId,
      jobs: args.snapshot.jobs.filter((job) => job.runId === args.runId),
      prompts: args.snapshot.prompts.filter((prompt) => prompt.runId === args.runId),
    },
    timestamp: Date.now(),
  };
}

export async function streamAgUiRunEvents(args: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  runDir: string;
  runId: string;
  controlPlane: OttoWebControlPlane;
}): Promise<void> {
  args.res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  args.res.write(": connected\n\n");

  const filePath = getAgUiEventsPath(args.runDir);
  let offset = await replayFile({ filePath, res: args.res });
  let lastControlPlanePayload: string | null = null;

  const emitControlPlaneSnapshot = (snapshot: OttoWebControlPlaneSnapshot) => {
    const event = buildControlPlaneEvent({ runId: args.runId, snapshot });
    const encoded = JSON.stringify(event.value);
    if (encoded === lastControlPlanePayload) {
      return;
    }
    lastControlPlanePayload = encoded;
    writeEvent(args.res, event);
  };

  emitControlPlaneSnapshot(args.controlPlane.getSnapshot());
  const unsubscribe = args.controlPlane.subscribe(async (snapshot) => {
    emitControlPlaneSnapshot(snapshot);
  });

  const timer = setInterval(async () => {
    try {
      const nextSize = await ensureFileOffset(filePath);
      if (nextSize <= offset) {
        return;
      }
      const handle = await fs.open(filePath, "r");
      try {
        const length = nextSize - offset;
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, offset);
        offset = nextSize;
        const chunk = buffer.toString("utf8");
        for (const line of chunk.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          writeEvent(args.res, JSON.parse(trimmed) as OttoAgUiEvent);
        }
      } finally {
        await handle.close();
      }
    } catch {
      // ignore transient read errors while stream is open
    }
  }, 1000);

  args.req.on("close", () => {
    clearInterval(timer);
    unsubscribe();
  });
}
