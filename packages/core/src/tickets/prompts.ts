export function buildTicketCreatePrompt(args: { ticketText: string }): string {
  return [
    "You are the project lead for this repository.",
    "",
    "<INSTRUCTIONS>",
    "Generate a new ticket from the user input.",
    "Return:",
    "- <SLUG>...</SLUG> as a 3-5 word human-readable phrase.",
    "- <CONTENT>...</CONTENT> as full markdown ticket content.",
    "Return only the tags, no extra text and no <OK>.",
    "</INSTRUCTIONS>",
    "",
    "<INPUT>",
    args.ticketText.trim(),
    "</INPUT>",
    "",
  ].join("\n");
}

export function buildTicketIngestPrompt(args: {
  sourceContent: string;
}): string {
  return [
    "You are the project lead for this repository.",
    "",
    "<INSTRUCTIONS>",
    "Generate a 3-5 word human-readable slug for the ticket content.",
    "Return only <SLUG>...</SLUG>. Do not return <CONTENT> or <OK>.",
    "</INSTRUCTIONS>",
    "",
    "<INPUT>",
    args.sourceContent.trim(),
    "</INPUT>",
    "",
  ].join("\n");
}

export function buildTicketAmendPrompt(args: {
  ticketId: string;
  existingContent: string;
  amendInstructions: string;
}): string {
  return [
    "You are the project lead for this repository.",
    "",
    "<INSTRUCTIONS>",
    "Amend the existing ticket content based on the user instructions.",
    "Return only:",
    "- <CONTENT>...</CONTENT> as full markdown ticket content.",
    "Do not change the ticket id or slug.",
    "Return only the tag, no extra text and no <OK>.",
    "</INSTRUCTIONS>",
    "",
    `<TICKET_ID>${args.ticketId}</TICKET_ID>`,
    "",
    "<EXISTING>",
    args.existingContent.trim(),
    "</EXISTING>",
    "",
    "<AMEND_INSTRUCTIONS>",
    args.amendInstructions.trim(),
    "</AMEND_INSTRUCTIONS>",
    "",
  ].join("\n");
}

export function buildTicketRetryPrompt(args: {
  basePrompt: string;
  errorMessage: string;
}): string {
  return [
    args.basePrompt.trim(),
    "",
    "<RETRY>",
    `Previous response was invalid: ${args.errorMessage}`,
    "Return the tags exactly as requested.",
    "</RETRY>",
    "",
  ].join("\n");
}
