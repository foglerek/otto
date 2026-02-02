const WORD_PATTERN = /[\p{L}\p{N}]+/gu;

export function countSlugWords(slug: string): number {
  const matches = slug.trim().match(WORD_PATTERN);
  return matches ? matches.length : 0;
}

export function isSlugWordCountValid(slug: string): boolean {
  const count = countSlugWords(slug);
  return count >= 3 && count <= 5;
}

export function normalizeSlug(slug: string): string {
  const cleaned = slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned;
}
