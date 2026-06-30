import type { Ticket, TicketType } from "./store.js";

export interface BriefingInput {
  title: string;
  durationMinutes: number;
  tickets: Ticket[];
}

const ACTION_LABEL: Record<Exclude<TicketType, "fyi">, string> = {
  plan: "PLAN REVIEW — approve or redirect",
  decision: "DECISION needed",
  question: "QUESTION — answer to unblock",
};

/**
 * Render the agenda a human reads at the booked time. This markdown becomes the
 * calendar event description, so it must stand on its own: each actionable item
 * states what the agent needs from you, with its ticket id for `resolve`.
 */
export function renderBriefing(input: BriefingInput): string {
  const actionable = input.tickets.filter((t) => t.type !== "fyi");
  const fyis = input.tickets.filter((t) => t.type === "fyi");

  const lines: string[] = [];
  lines.push(
    `${input.title} · ${reserveLabel(input.durationMinutes, actionable.length)}`
  );
  lines.push("");

  if (actionable.length > 0) {
    lines.push("Decide these:");
    actionable.forEach((t, i) => {
      const label = ACTION_LABEL[t.type as Exclude<TicketType, "fyi">];
      lines.push(`${i + 1}. [${t.agent}] ${t.title}  → ${label}  (${t.id})`);
      for (const bodyLine of bodyBlock(t.body)) lines.push(`   ${bodyLine}`);
    });
  }

  if (fyis.length > 0) {
    if (actionable.length > 0) lines.push("");
    lines.push("No action needed:");
    for (const t of fyis) {
      lines.push(`- [${t.agent}] ${t.title}  (${t.id})`);
      for (const bodyLine of bodyBlock(t.body)) lines.push(`  ${bodyLine}`);
    }
  }

  return lines.join("\n");
}

function reserveLabel(minutes: number, actionableCount: number): string {
  if (actionableCount === 0) return "FYI digest, no time reserved";
  return `${minutes}m`;
}

function bodyBlock(body: string): string[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  return trimmed.split("\n").map((l) => l.trimEnd());
}
