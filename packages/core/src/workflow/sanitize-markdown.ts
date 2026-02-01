import fs from "node:fs/promises";

export async function sanitizeAbsolutePathsInMarkdown(args: {
  filePath: string;
  prefixes: string[];
}): Promise<void> {
  const raw = await fs.readFile(args.filePath, "utf8");
  let next = raw;
  for (const prefix of args.prefixes) {
    if (!prefix) continue;
    const normalized = prefix.endsWith("/") ? prefix : `${prefix}/`;
    next = next.split(normalized).join("");
  }
  if (next !== raw) {
    await fs.writeFile(args.filePath, next, "utf8");
  }
}
