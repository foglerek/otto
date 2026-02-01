import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import type { OttoPromptAdapter } from "@otto/ports";

import { createCliRenderer, type CliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export class PromptCancelledError extends Error {
  constructor(message = "Prompt cancelled") {
    super(message);
    this.name = "PromptCancelledError";
  }
}

export class PromptUnavailableError extends Error {
  constructor(message = "Prompt UI unavailable (no TTY)") {
    super(message);
    this.name = "PromptUnavailableError";
  }
}

function assertTty(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new PromptUnavailableError(
      "OpenTUI requires a TTY. Use --force or a headless prompt adapter.",
    );
  }
}

async function withRenderer<T>(
  render: (
    renderer: CliRenderer,
    resolve: (value: T) => void,
    reject: (err: unknown) => void,
  ) => void,
): Promise<T> {
  assertTty();

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useConsole: false,
    useMouse: false,
    useAlternateScreen: true,
    useKittyKeyboard: {
      disambiguate: true,
      alternateKeys: true,
    },
  });

  renderer.start();
  const root = createRoot(renderer);

  let done = false;
  const finish = async (finalize: () => void) => {
    if (done) return;
    done = true;
    try {
      finalize();
    } finally {
      try {
        root.unmount();
      } catch {
        // best-effort
      }
      try {
        renderer.destroy();
      } catch {
        // best-effort
      }
    }
  };

  return await new Promise<T>((outerResolve, outerReject) => {
    const resolve = (value: T) => {
      void finish(() => outerResolve(value));
    };
    const reject = (err: unknown) => {
      void finish(() => outerReject(err));
    };

    render(renderer, resolve, reject);
  });
}

function PromptShell(props: {
  message: string;
  children: ReactNode;
  onCancel: () => void;
}) {
  useKeyboard((key) => {
    if ((key.ctrl && key.name === "c") || key.name === "escape") {
      props.onCancel();
    }
  });

  return (
    <box
      width="100%"
      height="100%"
      padding={1}
      flexDirection="column"
      rowGap={1}
    >
      <text>{props.message}</text>
      {props.children}
      <text opacity={0.6}>Esc/Ctrl+C: cancel</text>
    </box>
  );
}

function ConfirmPrompt(props: {
  message: string;
  defaultValue: boolean;
  onResolve: (value: boolean) => void;
  onCancel: () => void;
}) {
  const options = useMemo(
    () => [
      { name: "Yes", description: "", value: true },
      { name: "No", description: "", value: false },
    ],
    [],
  );
  const selectedIndex = props.defaultValue ? 0 : 1;

  return (
    <PromptShell message={props.message} onCancel={props.onCancel}>
      <select
        focused
        options={options}
        selectedIndex={selectedIndex}
        showDescription={false}
        wrapSelection
        onSelect={(_, option) => props.onResolve(option?.value === true)}
      />
    </PromptShell>
  );
}

function TextPrompt(props: {
  message: string;
  defaultValue: string;
  onResolve: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(props.defaultValue);

  return (
    <PromptShell message={props.message} onCancel={props.onCancel}>
      <input
        focused
        value={value}
        onChange={(next) => {
          if (typeof next === "string") setValue(next);
        }}
        onSubmit={() => {
          const trimmed = value.trim();
          props.onResolve(trimmed.length > 0 ? trimmed : props.defaultValue);
        }}
      />
    </PromptShell>
  );
}

function SelectPrompt(props: {
  message: string;
  choices: string[];
  defaultValue: string;
  onResolve: (value: string) => void;
  onCancel: () => void;
}) {
  const options = useMemo(
    () => props.choices.map((c) => ({ name: c, description: "", value: c })),
    [props.choices],
  );
  const selectedIndex = Math.max(0, props.choices.indexOf(props.defaultValue));

  return (
    <PromptShell message={props.message} onCancel={props.onCancel}>
      <select
        focused
        options={options}
        selectedIndex={selectedIndex}
        showDescription={false}
        wrapSelection
        onSelect={(_, option) =>
          props.onResolve(String(option?.value ?? props.choices[0]))
        }
      />
    </PromptShell>
  );
}

export function createOpentuiPromptAdapter(): OttoPromptAdapter {
  return {
    async confirm(message, options) {
      const defaultValue = options?.defaultValue ?? true;
      return await withRenderer<boolean>((renderer, resolve, reject) => {
        createRoot(renderer).render(
          <ConfirmPrompt
            message={message}
            defaultValue={defaultValue}
            onResolve={resolve}
            onCancel={() => reject(new PromptCancelledError())}
          />,
        );
      });
    },

    async text(message, options) {
      const defaultValue = options?.defaultValue ?? "";
      return await withRenderer<string>((renderer, resolve, reject) => {
        createRoot(renderer).render(
          <TextPrompt
            message={message}
            defaultValue={defaultValue}
            onResolve={resolve}
            onCancel={() => reject(new PromptCancelledError())}
          />,
        );
      });
    },

    async select(message, options) {
      if (options.choices.length === 0) {
        throw new Error("select() requires at least one choice");
      }

      const defaultValue =
        options.defaultValue && options.choices.includes(options.defaultValue)
          ? options.defaultValue
          : options.choices[0];

      return await withRenderer<string>((renderer, resolve, reject) => {
        createRoot(renderer).render(
          <SelectPrompt
            message={message}
            choices={options.choices}
            defaultValue={defaultValue}
            onResolve={resolve}
            onCancel={() => reject(new PromptCancelledError())}
          />,
        );
      });
    },
  };
}

type DashboardRun = {
  runId: string;
  askSlug: string;
  createdAt: string;
  branchName: string;
  stateFilePath: string;
};

async function loadRuns(statesDir: string): Promise<DashboardRun[]> {
  let names: string[];
  try {
    names = await fs.readdir(statesDir);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return [];
    throw err;
  }

  const results: DashboardRun[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const filePath = path.join(statesDir, name);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const data = JSON.parse(raw) as any;
      results.push({
        runId: String(data.runId ?? name.replace(/\.json$/, "")),
        askSlug: String(data.ask?.slug ?? ""),
        createdAt: String(data.createdAt ?? ""),
        branchName: String(data.worktree?.branchName ?? ""),
        stateFilePath: filePath,
      });
    } catch {
      // ignore unreadable state files
    }
  }

  results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return results;
}

function DashboardApp(props: { statesDir: string; onExit: () => void }) {
  const [runs, setRuns] = useState<DashboardRun[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    void loadRuns(props.statesDir).then(setRuns);
  }, [props.statesDir]);

  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "q") {
      props.onExit();
    }
  });

  const options = runs.map((r) => ({
    name: r.askSlug ? `${r.askSlug} (${r.runId})` : r.runId,
    description: r.branchName,
    value: r,
  }));

  const selected = runs[selectedIndex];

  return (
    <box
      width="100%"
      height="100%"
      padding={1}
      flexDirection="column"
      rowGap={1}
    >
      <box
        width="100%"
        flexDirection="column"
        border
        borderStyle="single"
        padding={1}
      >
        <text>Otto Dashboard (scaffold)</text>
        <text opacity={0.6}>Runs: {runs.length} · Esc/Q to exit</text>
      </box>

      <box width="100%" flexDirection="row" columnGap={2}>
        <box width="55%" height="80%" border borderStyle="single" padding={1}>
          {options.length > 0 ? (
            <select
              focused
              options={options}
              selectedIndex={selectedIndex}
              showDescription
              wrapSelection
              onChange={(idx) => setSelectedIndex(idx)}
            />
          ) : (
            <text opacity={0.6}>No runs found in .otto/states/</text>
          )}
        </box>

        <box
          width="45%"
          height="80%"
          border
          borderStyle="single"
          padding={1}
          flexDirection="column"
          rowGap={1}
        >
          {selected ? (
            <>
              <text>Selected Run</text>
              <text opacity={0.6}>runId: {selected.runId}</text>
              <text opacity={0.6}>ask: {selected.askSlug || "(unknown)"}</text>
              <text opacity={0.6}>
                branch: {selected.branchName || "(unknown)"}
              </text>
              <text opacity={0.6}>
                createdAt: {selected.createdAt || "(unknown)"}
              </text>
              <text opacity={0.6}>state: {selected.stateFilePath}</text>
            </>
          ) : (
            <text opacity={0.6}>Select a run to view details.</text>
          )}
        </box>
      </box>
    </box>
  );
}

export async function runOttoDashboard(args: {
  statesDir: string;
}): Promise<void> {
  assertTty();
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useConsole: false,
    useMouse: false,
    useAlternateScreen: true,
  });

  renderer.start();
  const root = createRoot(renderer);

  await new Promise<void>((resolve) => {
    root.render(
      <DashboardApp statesDir={args.statesDir} onExit={() => resolve()} />,
    );
  });

  root.unmount();
  renderer.destroy();
}
