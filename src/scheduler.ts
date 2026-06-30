import type { DesiredWindow, Ticket } from "./store.js";

export interface TicketGroup {
  title: string;
  desiredWindow: DesiredWindow;
  /** Calendar minutes to reserve. FYI-only tickets add nothing here. */
  durationMinutes: number;
  tickets: Ticket[];
}

export interface PlanOptions {
  /** Hard cap on a single bundled briefing block. Overflow spills to a second block. */
  maxBlockMinutes?: number;
  /** Floor for any block that holds at least one actionable item. */
  minBlockMinutes?: number;
}

const DEFAULT_MAX_BLOCK = 45;
const DEFAULT_MIN_BLOCK = 10;

function isActionable(t: Ticket): boolean {
  return t.type !== "fyi";
}

/**
 * The batching policy. Pure over the ticket list so it's trivially testable:
 *
 *  - `blocker` urgency  → its own ASAP meeting, booked into the next free slot.
 *  - actionable `normal`/`low` (question|plan|decision) → bundled into one or
 *    more "next-block" briefings, bin-packed by estimate under `maxBlockMinutes`.
 *  - `fyi` → rides along in the next briefing for context but reserves no time;
 *    if nothing else is queued, a short FYI-digest block is proposed instead.
 */
export function groupTickets(
  tickets: Ticket[],
  opts: PlanOptions = {}
): TicketGroup[] {
  const maxBlock = opts.maxBlockMinutes ?? DEFAULT_MAX_BLOCK;
  const minBlock = opts.minBlockMinutes ?? DEFAULT_MIN_BLOCK;

  const blockers = tickets.filter((t) => t.urgency === "blocker");
  const rest = tickets.filter((t) => t.urgency !== "blocker");
  const actionable = rest.filter(isActionable);
  const fyis = rest.filter((t) => !isActionable(t));

  const groups: TicketGroup[] = [];

  // One ASAP meeting per blocker so each can be booked independently.
  for (const t of blockers) {
    groups.push({
      title: `🚨 Blocker · ${t.agent}: ${truncate(t.title, 60)}`,
      desiredWindow: "asap",
      durationMinutes: Math.max(t.estimatedMinutes, minBlock),
      tickets: [t],
    });
  }

  // Bin-pack actionable items (oldest first) into next-block briefings.
  const blocks: Ticket[][] = [];
  let current: Ticket[] = [];
  let currentMinutes = 0;
  for (const t of actionable) {
    const cost = Math.max(t.estimatedMinutes, 1);
    if (current.length > 0 && currentMinutes + cost > maxBlock) {
      blocks.push(current);
      current = [];
      currentMinutes = 0;
    }
    current.push(t);
    currentMinutes += cost;
  }
  if (current.length > 0) blocks.push(current);

  // FYIs ride along in the first briefing block (no added time).
  if (blocks.length === 0 && fyis.length > 0) {
    blocks.push([]);
  }
  if (blocks.length > 0 && fyis.length > 0) {
    blocks[0] = [...blocks[0]!, ...fyis];
  }

  for (const block of blocks) {
    const actionableInBlock = block.filter(isActionable);
    const reserved = actionableInBlock.reduce(
      (sum, t) => sum + Math.max(t.estimatedMinutes, 1),
      0
    );
    groups.push({
      title: `📋 Agent briefing · ${block.length} item${block.length === 1 ? "" : "s"}`,
      desiredWindow: "next-block",
      durationMinutes:
        actionableInBlock.length > 0 ? Math.max(reserved, minBlock) : minBlock,
      tickets: block,
    });
  }

  return groups;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
