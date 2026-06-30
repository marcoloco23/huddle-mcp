import { test } from "node:test";
import assert from "node:assert/strict";
import { groupTickets } from "../dist/scheduler.js";
import { renderBriefing, ANSWER_HEADER } from "../dist/briefing.js";
import { parseAnswers } from "../dist/answers.js";

const mk = (over) => ({
  id: over.id ?? "tkt_00000000",
  agent: "a",
  title: "t",
  type: "question",
  urgency: "normal",
  body: "",
  estimatedMinutes: 10,
  createdAt: "2026-06-30T00:00:00.000Z",
  status: "queued",
  meetingId: null,
  response: null,
  respondedAt: null,
  ...over,
});

test("groupTickets: blocker gets its own ASAP meeting", () => {
  const groups = groupTickets([mk({ id: "tkt_b0000000", urgency: "blocker", type: "plan" })]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].desiredWindow, "asap");
  assert.equal(groups[0].durationMinutes, 10); // floor
});

test("groupTickets: normals bundle, fyi rides along with no added time", () => {
  const groups = groupTickets([
    mk({ id: "tkt_10000000", type: "question", estimatedMinutes: 5 }),
    mk({ id: "tkt_20000000", type: "plan", estimatedMinutes: 15 }),
    mk({ id: "tkt_30000000", type: "fyi", estimatedMinutes: 0 }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].desiredWindow, "next-block");
  assert.equal(groups[0].durationMinutes, 20); // 5 + 15, fyi adds nothing
  assert.equal(groups[0].tickets.length, 3);
});

test("groupTickets: bin-packs over the cap into multiple blocks", () => {
  const tickets = Array.from({ length: 4 }, (_, i) =>
    mk({ id: `tkt_c000000${i}`, type: "plan", estimatedMinutes: 30 })
  );
  const groups = groupTickets(tickets, { maxBlockMinutes: 45 });
  assert.equal(groups.length, 4); // each 30 > 45/2, so one per block
});

test("renderBriefing: writable answer slot per actionable, none for fyi", () => {
  const md = renderBriefing({
    title: "📋 brief",
    durationMinutes: 20,
    tickets: [
      mk({ id: "tkt_aaaa1111", type: "decision" }),
      mk({ id: "tkt_cccc3333", type: "fyi" }),
    ],
  });
  assert.ok(md.includes(ANSWER_HEADER));
  assert.ok(md.includes("tkt_aaaa1111 → "));
  assert.ok(!md.split(ANSWER_HEADER)[1].includes("tkt_cccc3333"));
});

test("parseAnswers: ignores blank briefing, reads filled answers, tolerates mess", () => {
  assert.deepEqual(parseAnswers("1. thing → DECISION needed  (tkt_aaaa1111)"), []);
  assert.deepEqual(parseAnswers("tkt_aaaa1111 → "), []);
  assert.deepEqual(parseAnswers("tkt_aaaa1111 → Outlook first"), [
    { ticketId: "tkt_aaaa1111", answer: "Outlook first" },
  ]);
  assert.deepEqual(parseAnswers("notes: a test\ntkt_aaaa1111 = go\nrandom"), [
    { ticketId: "tkt_aaaa1111", answer: "go" },
  ]);
});
