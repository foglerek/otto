import fs from "node:fs";

export function fileExistsAndHasContent(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    const stats = fs.statSync(filePath);
    return stats.size > 0;
  } catch {
    return false;
  }
}
