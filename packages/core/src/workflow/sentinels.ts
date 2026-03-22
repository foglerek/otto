export type TokenSentinelSpec = {
  type: "token";
  token: string;
  requireLineEnd?: boolean;
  caseInsensitive?: boolean;
};

export type TaggedSentinelSpec<TAllowed extends string = string> = {
  type: "tag";
  tag: string;
  allowedValues?: readonly TAllowed[];
  caseInsensitive?: boolean;
};

export type OutputSentinelSpec<TAllowed extends string = string> =
  | TokenSentinelSpec
  | TaggedSentinelSpec<TAllowed>;

type OutputSentinelMatch<TAllowed extends string = string> =
  | {
      matched: false;
      rawValue: null;
      value: null;
    }
  | {
      matched: true;
      rawValue: string;
      value: TAllowed | null;
    };

export const OK_SENTINEL_SPEC: TokenSentinelSpec = {
  type: "token",
  token: "OK",
  requireLineEnd: true,
  caseInsensitive: true,
};

export const OK_SENTINEL_PATTERN = buildSentinelPattern(OK_SENTINEL_SPEC);

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function withCaseSensitivity(
  value: string,
  caseInsensitive: boolean,
): string {
  return caseInsensitive ? value.toLowerCase() : value;
}

export function buildSentinelPattern(
  spec: OutputSentinelSpec,
): RegExp {
  const caseInsensitive = spec.caseInsensitive ?? true;
  const flags = caseInsensitive ? "im" : "m";

  if (spec.type === "token") {
    const escapedToken = escapeRegex(spec.token);
    if (spec.requireLineEnd) {
      return new RegExp(`(^|\\n)<${escapedToken}>\\s*$`, flags);
    }
    return new RegExp(`<${escapedToken}>`, caseInsensitive ? "i" : "");
  }

  const escapedTag = escapeRegex(spec.tag);
  return new RegExp(
    `<${escapedTag}>\\s*([\\s\\S]*?)\\s*<\\/${escapedTag}>`,
    caseInsensitive ? "i" : "",
  );
}

export function describeSentinelExpectation(spec: OutputSentinelSpec): string {
  if (spec.type === "token") {
    return `<${spec.token}>`;
  }

  if (!spec.allowedValues || spec.allowedValues.length === 0) {
    return `<${spec.tag}>...</${spec.tag}>`;
  }

  return spec.allowedValues
    .map((value) => `<${spec.tag}>${value}</${spec.tag}>`)
    .join(" OR ");
}

export function matchOutputSentinel<TAllowed extends string>(
  text: string | undefined,
  spec: OutputSentinelSpec<TAllowed>,
): OutputSentinelMatch<TAllowed> {
  if (!text) {
    return { matched: false, rawValue: null, value: null };
  }

  const pattern = buildSentinelPattern(spec);
  const match = text.match(pattern);
  if (!match) {
    return { matched: false, rawValue: null, value: null };
  }

  if (spec.type === "token") {
    return {
      matched: true,
      rawValue: match[0] ?? "",
      value: null,
    };
  }

  const rawValue = (match[1] ?? "").trim();
  if (!rawValue) {
    return { matched: false, rawValue: null, value: null };
  }

  if (!spec.allowedValues || spec.allowedValues.length === 0) {
    return {
      matched: true,
      rawValue,
      value: rawValue as TAllowed,
    };
  }

  const caseInsensitive = spec.caseInsensitive ?? true;
  const normalizedRaw = withCaseSensitivity(rawValue, caseInsensitive);
  const allowed = spec.allowedValues.find(
    (value) =>
      withCaseSensitivity(value, caseInsensitive) === normalizedRaw,
  );

  if (!allowed) {
    return { matched: false, rawValue: null, value: null };
  }

  return {
    matched: true,
    rawValue,
    value: allowed,
  };
}

export function hasOkSentinel(text: string | undefined): boolean {
  return matchOutputSentinel(text, OK_SENTINEL_SPEC).matched;
}
