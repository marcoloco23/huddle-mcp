import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let client, home;
const call = async (n, a = {}) =>
  JSON.parse((await client.callTool({ name: n, arguments: a })).content[0].text);

before(async () => {
  home = mkdtempSync(join(tmpdir(), "huddle-test-"));
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: { ...process.env, HUDDLE_HOME: home },
  });
  client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
});

after(async () => {
  await client?.close();
  if (home) rmSync(home, { recursive: true, force: true });
});

test("exposes the full toolset", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    [
      "cancel_request", "check_response", "confirm_meeting", "discard_meeting",
      "get_briefing", "ingest_answers", "list_agenda", "plan_meetings",
      "reopen", "request_meeting", "resolve",
    ]
  );
});

test("full loop: request → plan → confirm → ingest → unblock", async () => {
  const r = await call("request_meeting", {
    agent: "auth", title: "JWT vs sessions", type: "plan", urgency: "blocker", body: "pick one",
  });
  assert.match(r.disposition, /BLOCKER/);
  const plan = await call("plan_meetings");
  const m = plan.unbookedMeetings.find((x) => x.desiredWindow === "asap");
  assert.ok(m);
  await call("confirm_meeting", {
    meeting_id: m.id, calendar_event_id: "evt1", start: "2026-07-01T09:00:00Z", end: "2026-07-01T09:10:00Z",
  });
  const ing = await call("ingest_answers", { text: `${r.ticketId} → use sessions` });
  assert.equal(ing.resolved.length, 1);
  const poll = await call("check_response", { ticket_id: r.ticketId });
  assert.equal(poll.answered, true);
  assert.equal(poll.response, "use sessions");
});

test("reopen: undoes a decision and re-opens the ticket", async () => {
  const r = await call("request_meeting", { agent: "ui", title: "dark mode?", type: "question", body: "?" });
  await call("resolve", { ticket_id: r.ticketId, decision: "yes" });
  assert.equal((await call("check_response", { ticket_id: r.ticketId })).answered, true);
  const re = await call("reopen", { ticket_id: r.ticketId });
  assert.equal(re.status, "queued");
  const poll = await call("check_response", { ticket_id: r.ticketId });
  assert.equal(poll.answered, false);
  assert.equal(poll.response, null);
});

test("discard_meeting: re-queues open tickets and returns the event id", async () => {
  const r = await call("request_meeting", { agent: "db", title: "migrate?", type: "decision", body: "?" });
  const plan = await call("plan_meetings");
  const m = plan.unbookedMeetings.find((x) => x.ticketIds.includes(r.ticketId));
  await call("confirm_meeting", {
    meeting_id: m.id, calendar_event_id: "evt2", start: "2026-07-01T10:00:00Z", end: "2026-07-01T10:10:00Z",
  });
  const d = await call("discard_meeting", { meeting_id: m.id });
  assert.equal(d.calendarEventId, "evt2");
  assert.ok(d.requeuedTickets.includes(r.ticketId));
  const t = (await call("list_agenda")).tickets.find((x) => x.id === r.ticketId);
  assert.equal(t.status, "queued");
  assert.equal(t.meetingId, null);
});

test("concurrent requests do not corrupt the store", async () => {
  const before = (await call("list_agenda")).tickets.length;
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      call("request_meeting", { agent: "x", title: `c${i}`, type: "fyi", body: "" })
    )
  );
  const after = (await call("list_agenda")).tickets.length;
  assert.equal(after, before + 20);
});
