export interface ParsedAnswer {
  ticketId: string;
  answer: string;
}

// A ticket id (tkt_xxxxxxxx) followed by a separator and then non-empty text.
// The agenda lines carry their id wrapped as "(tkt_xxx)" with nothing after, so
// they never match; only filled answer lines ("tkt_xxx → Outlook first") do.
const ANSWER_LINE = /(tkt_[0-9a-f]{8})\s*(?:[:=>→-]|->)\s*(\S.*)$/;

/**
 * Parse human answers out of an event description (or any text). Liberal on
 * purpose — people edit calendar notes messily: any line with a ticket id, a
 * separator (:, =, >, →, -, ->), and some text counts. Last write per ticket wins.
 */
export function parseAnswers(text: string): ParsedAnswer[] {
  const byId = new Map<string, string>();
  for (const raw of text.split("\n")) {
    const m = raw.trim().match(ANSWER_LINE);
    if (!m) continue;
    const answer = m[2]!.trim();
    if (answer) byId.set(m[1]!, answer);
  }
  return [...byId].map(([ticketId, answer]) => ({ ticketId, answer }));
}
