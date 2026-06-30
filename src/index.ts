#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { renderBriefing } from "./briefing.js";
import { groupTickets } from "./scheduler.js";
import {
  AgendaStore,
  makeId,
  StoreError,
  type Meeting,
  type Ticket,
} from "./store.js";

const SERVER_NAME = "agenda-mcp";
const SERVER_VERSION = "0.1.0";

const INSTRUCTIONS = [
  "A coordination broker for parallel coding agents. Worker agents queue requests",
  "instead of interrupting the user; requests are batched by urgency into briefings",
  "the user reviews at a scheduled time.",
  "",
  "WORKER AGENTS: call `request_meeting` to queue a plan/question/decision/fyi, then",
  "poll `check_response` with the returned ticketId and proceed once it is answered.",
  "Never block the user inline — queue and wait.",
  "",
  "ORCHESTRATOR / booking (this broker never touches the calendar itself):",
  "1. `plan_meetings` → proposed meetings, each with desiredWindow ('asap' | 'next-block'),",
  "   durationMinutes, and briefingMarkdown.",
  "2. For each, use the user's connected calendar MCP: find a free slot",
  "   (freebusy / suggest_time) in working hours — soonest for 'asap', the next review",
  "   block for 'next-block' — and create an event whose description IS briefingMarkdown.",
  "3. Call `confirm_meeting` with the meetingId, the created event id, and start/end.",
  "After the user reviews, call `resolve` per ticket to record each decision; that is",
  "what unblocks the waiting workers.",
].join("\n");

const ticketType = z.enum(["question", "plan", "decision", "fyi"]);
const urgency = z.enum(["blocker", "normal", "low"]);

function nowIso(): string {
  return new Date().toISOString();
}

function jsonText(value: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function errorResult(err: unknown): {
  content: [{ type: "text"; text: string }];
  isError: true;
} {
  const detail =
    err instanceof StoreError
      ? { error: err.message, kind: "store" }
      : { error: err instanceof Error ? err.message : String(err) };
  return {
    content: [{ type: "text", text: JSON.stringify(detail, null, 2) }],
    isError: true,
  };
}

async function safe<T>(fn: () => Promise<T>): Promise<
  | { content: [{ type: "text"; text: string }] }
  | { content: [{ type: "text"; text: string }]; isError: true }
> {
  try {
    return jsonText(await fn());
  } catch (err) {
    return errorResult(err);
  }
}

function ticketSummary(t: Ticket) {
  return {
    id: t.id,
    agent: t.agent,
    title: t.title,
    type: t.type,
    urgency: t.urgency,
    status: t.status,
    meetingId: t.meetingId,
  };
}

function meetingSummary(m: Meeting) {
  return {
    id: m.id,
    title: m.title,
    desiredWindow: m.desiredWindow,
    durationMinutes: m.durationMinutes,
    status: m.status,
    ticketIds: m.ticketIds,
    start: m.start,
    end: m.end,
    calendarEventId: m.calendarEventId,
    briefingMarkdown: m.briefingMarkdown,
  };
}

function disposition(t: Ticket): string {
  if (t.urgency === "blocker") {
    return "Logged as a BLOCKER — will be booked into the next free slot at the next plan_meetings.";
  }
  if (t.type === "fyi") {
    return "Logged as an FYI — appears in your next briefing, reserves no calendar time.";
  }
  return "Queued for your next briefing block.";
}

function buildServer(store: AgendaStore): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS }
  );

  // ---------- worker-facing ----------

  server.registerTool(
    "request_meeting",
    {
      title: "Request a briefing",
      description:
        "Queue a request for the user instead of interrupting them. Returns a ticketId; " +
        "poll `check_response` with it and proceed once answered. Does not touch the calendar.",
      inputSchema: {
        agent: z
          .string()
          .min(1)
          .describe("Your agent name/role, e.g. 'auth-agent' — shown in the briefing."),
        title: z.string().min(1).describe("One-line summary of what you need."),
        body: z
          .string()
          .describe("The full plan / question / context the user needs to decide."),
        type: ticketType.describe(
          "question = needs an answer; plan = review a plan; decision = pick an option; fyi = no action."
        ),
        urgency: urgency
          .optional()
          .describe("blocker = book ASAP; normal/low = bundle into next briefing. Default normal."),
        estimated_minutes: z
          .number()
          .int()
          .min(1)
          .max(120)
          .optional()
          .describe("How long the user needs to decide. Default 10 (fyi defaults to 0)."),
      },
    },
    async ({ agent, title, body, type, urgency: urg, estimated_minutes }) =>
      safe(() =>
        store.mutate((data) => {
          const ticket: Ticket = {
            id: makeId("tkt"),
            agent,
            title,
            type,
            urgency: urg ?? (type === "fyi" ? "low" : "normal"),
            body,
            estimatedMinutes: estimated_minutes ?? (type === "fyi" ? 0 : 10),
            createdAt: nowIso(),
            status: "queued",
            meetingId: null,
            response: null,
            respondedAt: null,
          };
          data.tickets.push(ticket);
          return {
            ticketId: ticket.id,
            status: ticket.status,
            disposition: disposition(ticket),
          };
        })
      )
  );

  server.registerTool(
    "check_response",
    {
      title: "Check for the user's decision",
      description:
        "Poll a ticketId. When `answered` is true, `response` holds the user's decision and " +
        "you can proceed.",
      inputSchema: { ticket_id: z.string().min(1) },
    },
    async ({ ticket_id }) =>
      safe(async () => {
        const data = await store.read();
        const t = data.tickets.find((x) => x.id === ticket_id);
        if (!t) return { ticketId: ticket_id, found: false };
        return {
          ticketId: t.id,
          found: true,
          status: t.status,
          answered: t.status === "answered",
          response: t.response,
          respondedAt: t.respondedAt,
          meetingId: t.meetingId,
        };
      })
  );

  server.registerTool(
    "cancel_request",
    {
      title: "Withdraw a request",
      description: "Cancel a queued ticket you no longer need (e.g. you resolved it yourself).",
      inputSchema: {
        ticket_id: z.string().min(1),
        reason: z.string().optional(),
      },
    },
    async ({ ticket_id }) =>
      safe(() =>
        store.mutate((data) => {
          const t = data.tickets.find((x) => x.id === ticket_id);
          if (!t) throw new StoreError(`no ticket ${ticket_id}`);
          t.status = "cancelled";
          for (const m of data.meetings) {
            m.ticketIds = m.ticketIds.filter((id) => id !== ticket_id);
          }
          t.meetingId = null;
          return { ticketId: t.id, status: t.status };
        })
      )
  );

  // ---------- orchestrator-facing ----------

  server.registerTool(
    "plan_meetings",
    {
      title: "Batch the queue into meetings",
      description:
        "Group all newly-queued tickets by urgency into proposed meetings (pure — books nothing). " +
        "Returns every unbooked meeting with desiredWindow, durationMinutes and briefingMarkdown so " +
        "you can find a slot via the calendar MCP and then call `confirm_meeting`.",
      inputSchema: {
        max_block_minutes: z
          .number()
          .int()
          .min(5)
          .max(180)
          .optional()
          .describe("Cap on a single bundled briefing (default 45); overflow spills to another block."),
      },
    },
    async ({ max_block_minutes }) =>
      safe(() =>
        store.mutate((data) => {
          const fresh = data.tickets.filter(
            (t) => t.status === "queued" && t.meetingId === null
          );
          const groups = groupTickets(fresh, { maxBlockMinutes: max_block_minutes });
          for (const g of groups) {
            const meeting: Meeting = {
              id: makeId("mtg"),
              title: g.title,
              desiredWindow: g.desiredWindow,
              durationMinutes: g.durationMinutes,
              ticketIds: g.tickets.map((t) => t.id),
              briefingMarkdown: renderBriefing({
                title: g.title,
                durationMinutes: g.durationMinutes,
                tickets: g.tickets,
              }),
              status: "proposed",
              calendarEventId: null,
              start: null,
              end: null,
              createdAt: nowIso(),
            };
            data.meetings.push(meeting);
            for (const t of g.tickets) t.meetingId = meeting.id;
          }
          const unbooked = data.meetings.filter((m) => m.status === "proposed");
          return {
            created: groups.length,
            unbookedMeetings: unbooked.map(meetingSummary),
          };
        })
      )
  );

  server.registerTool(
    "confirm_meeting",
    {
      title: "Record a booked meeting",
      description:
        "After you create the calendar event, record it here. Marks the meeting booked and its " +
        "tickets scheduled.",
      inputSchema: {
        meeting_id: z.string().min(1),
        calendar_event_id: z.string().min(1).describe("The id returned by your calendar MCP."),
        start: z.string().min(1).describe("ISO start time the event was booked at."),
        end: z.string().min(1).describe("ISO end time."),
      },
    },
    async ({ meeting_id, calendar_event_id, start, end }) =>
      safe(() =>
        store.mutate((data) => {
          const m = data.meetings.find((x) => x.id === meeting_id);
          if (!m) throw new StoreError(`no meeting ${meeting_id}`);
          m.status = "booked";
          m.calendarEventId = calendar_event_id;
          m.start = start;
          m.end = end;
          for (const id of m.ticketIds) {
            const t = data.tickets.find((x) => x.id === id);
            if (t && t.status === "queued") t.status = "scheduled";
          }
          return meetingSummary(m);
        })
      )
  );

  server.registerTool(
    "get_briefing",
    {
      title: "Get a meeting's briefing",
      description:
        "Return the rendered agenda for a meeting (use as the calendar event description, or to " +
        "re-read at review time) plus its full tickets.",
      inputSchema: { meeting_id: z.string().min(1) },
    },
    async ({ meeting_id }) =>
      safe(async () => {
        const data = await store.read();
        const m = data.meetings.find((x) => x.id === meeting_id);
        if (!m) throw new StoreError(`no meeting ${meeting_id}`);
        const tickets = m.ticketIds
          .map((id) => data.tickets.find((t) => t.id === id))
          .filter((t): t is Ticket => Boolean(t));
        return { ...meetingSummary(m), tickets };
      })
  );

  server.registerTool(
    "resolve",
    {
      title: "Record the user's decision",
      description:
        "Record the user's answer/decision for a ticket. Flips it to answered so the waiting worker " +
        "unblocks on its next `check_response`.",
      inputSchema: {
        ticket_id: z.string().min(1),
        decision: z.string().min(1).describe("The user's answer, decision, or direction."),
      },
    },
    async ({ ticket_id, decision }) =>
      safe(() =>
        store.mutate((data) => {
          const t = data.tickets.find((x) => x.id === ticket_id);
          if (!t) throw new StoreError(`no ticket ${ticket_id}`);
          t.status = "answered";
          t.response = decision;
          t.respondedAt = nowIso();
          if (t.meetingId) {
            const m = data.meetings.find((x) => x.id === t.meetingId);
            if (m) {
              const all = m.ticketIds
                .map((id) => data.tickets.find((x) => x.id === id))
                .filter((x): x is Ticket => Boolean(x));
              if (all.every((x) => x.status === "answered" || x.status === "cancelled")) {
                m.status = "done";
              }
            }
          }
          return ticketSummary(t);
        })
      )
  );

  server.registerTool(
    "list_agenda",
    {
      title: "Show the agenda",
      description:
        "Overview of tickets and meetings. Optionally filter tickets by status " +
        "(queued | scheduled | answered | cancelled).",
      inputSchema: {
        status: z
          .enum(["queued", "scheduled", "answered", "cancelled"])
          .optional()
          .describe("Filter tickets by status."),
      },
    },
    async ({ status }) =>
      safe(async () => {
        const data = await store.read();
        const tickets = status
          ? data.tickets.filter((t) => t.status === status)
          : data.tickets;
        return {
          counts: {
            queued: data.tickets.filter((t) => t.status === "queued").length,
            scheduled: data.tickets.filter((t) => t.status === "scheduled").length,
            answered: data.tickets.filter((t) => t.status === "answered").length,
          },
          tickets: tickets.map(ticketSummary),
          meetings: data.meetings.map(meetingSummary),
        };
      })
  );

  return server;
}

async function main(): Promise<void> {
  const store = new AgendaStore();
  const server = buildServer(store);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on("SIGINT", () => {
    void server.close().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void server.close().finally(() => process.exit(0));
  });

  console.error(
    `${SERVER_NAME} v${SERVER_VERSION} running on stdio · store ${store.filePath}`
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
