const TAG_PATTERN = (tag: string): RegExp =>
  new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, "im");

const SLUG_LABEL_PATTERN =
  /^\s*(?:[-*]\s*)?(?:\*\*|__)?slug(?:\*\*|__)?\s*[:\-]\s*(.+?)\s*$/i;

function cleanSlugCandidate(value: string): string {
  return value
    .trim()
    .replace(/^`+|`+$/g, "")
    .replace(/^"+|"+$/g, "")
    .replace(/^'+|'+$/g, "")
    .replace(/^\*\*|\*\*$/g, "")
    .trim();
}

export function extractSlugFallback(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const match = line.match(SLUG_LABEL_PATTERN);
    if (match?.[1]) {
      return cleanSlugCandidate(match[1]);
    }
  }

  if (lines.length === 1) {
    return cleanSlugCandidate(lines[0] ?? "");
  }

  return null;
}

export function extractTag(text: string, tag: string): string | null {
  const match = text.match(TAG_PATTERN(tag));
  if (!match) return null;
  return match[1]?.trim() ?? null;
}

export function extractSlugTag(text: string): string | null {
  return extractTag(text, "SLUG") ?? extractSlugFallback(text);
}

export function extractContentTag(text: string): string | null {
  return extractTag(text, "CONTENT");
}

export function extractSlugAndContent(text: string): {
  slug: string | null;
  content: string | null;
} {
  return {
    slug: extractSlugTag(text),
    content: extractContentTag(text),
  };
}
