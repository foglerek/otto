export const OK_SENTINEL_PATTERN = /(^|\n)<OK>\s*$/m;

export function hasOkSentinel(text: string | undefined): boolean {
  if (!text) return false;
  return OK_SENTINEL_PATTERN.test(text);
}
