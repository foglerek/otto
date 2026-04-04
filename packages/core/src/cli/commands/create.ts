import { createManagedTicket } from "../../services/actions.js";
import { output, fail } from "../output.js";

export async function handleCreateCommand(args: string[]): Promise<void> {
  const ticketText = args.join(" ").trim();
  if (!ticketText) {
    fail("otto create requires <ticket-prompt>");
    return;
  }

  const result = await createManagedTicket({
    cwd: process.cwd(),
    ticketText,
  });

  output(
    {
      action: "create",
      ticketId: result.ticketId,
      filePath: result.filePath,
    },
    ["Ticket created.", `- Id: ${result.ticketId}`, `- Path: ${result.filePath}`, ""],
  );
}
