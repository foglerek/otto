export function untab(input: string): string {
  return input.replace(/^[ \t]+/gm, "");
}
