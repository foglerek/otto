import fs from "node:fs/promises";
import path from "node:path";

export interface OttoStateStore<TState extends object> {
  readonly filePath: string;
  readonly state: TState;
  save(): Promise<void>;
  update(mutator: (draft: TState) => void): Promise<TState>;
}

async function writeJsonAtomic(
  filePath: string,
  value: unknown,
): Promise<void> {
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);
  await fs.mkdir(dir, { recursive: true });

  const tmp = `${resolved}.tmp-${process.pid}-${Date.now()}`;
  const body = JSON.stringify(value, null, 2) + "\n";
  await fs.writeFile(tmp, body, "utf8");
  await fs.rename(tmp, resolved);
}

export function createOttoStateStore<TState extends object>(args: {
  filePath: string;
  initialState: TState;
}): OttoStateStore<TState> {
  const state = args.initialState;
  const filePath = path.resolve(args.filePath);

  async function save(): Promise<void> {
    await writeJsonAtomic(filePath, state);
  }

  async function update(mutator: (draft: TState) => void): Promise<TState> {
    mutator(state);
    await save();
    return state;
  }

  return { filePath, state, save, update };
}
