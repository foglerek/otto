const TAG_PATTERN = (tag: string): RegExp =>
  new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, "m");

export function extractTag(text: string, tag: string): string | null {
  const match = text.match(TAG_PATTERN(tag));
  if (!match) return null;
  return match[1]?.trim() ?? null;
}

export function extractSlugTag(text: string): string | null {
  return extractTag(text, "SLUG");
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
