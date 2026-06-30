---
name: huddle
description: Book and run agent briefings. Use when the user wants to schedule the queued agent requests onto their calendar ("book my agent briefings", "what do the agents need from me", "run my huddle"), or to record decisions after reviewing one. Drives the huddle-mcp queue together with the user's connected Google Calendar MCP.
---

# Huddle — book and run agent briefings

`huddle-mcp` is a coordination broker: parallel coding agents queue their plans
and questions into it instead of interrupting the user. This skill is the
**orchestrator side** — it turns that queue into real calendar events and records
the user's decisions back. The broker never touches the calendar itself; you bridge
it to whatever **Google Calendar MCP** the user has connected.

Prerequisites: both `huddle-mcp` and a Google Calendar MCP are connected.

## Booking the queue

1. `plan_meetings` → returns `unbookedMeetings`, each with `desiredWindow`
   (`asap` | `next-block`), `durationMinutes`, and `briefingMarkdown`.
2. For each meeting, find a free slot via the calendar MCP (its `suggest_time` /
   `list_events` / freebusy tools) within the user's working hours:
   - `asap` (blockers) → the **soonest** free slot today.
   - `next-block` → the **next review block** (late morning / late afternoon);
     bundle, don't scatter.
   Create the event with:
   - title = the meeting `title`,
   - description = the meeting `briefingMarkdown` **verbatim** (this is the agenda),
   - duration = `durationMinutes`,
   - **visibility = `private`** — briefings carry plans and code into the calendar.
3. `confirm_meeting` with the `meeting_id`, the calendar event id the calendar MCP
   returned, and the `start`/`end` you booked.

Then tell the user what you scheduled and when — one line per meeting.

Each briefing description ends with a writable **answer block** (`tkt_xxx → `),
so the user can reply inside the event itself — that's the read-back path below.

## Closing the loop — two ways, both unblock the waiting agents

**A. The user answers inside the calendar event** (e.g. they say "read my huddle
answers", or you're checking after a booked briefing's time):

1. `list_agenda` → find `booked` meetings and their `calendarEventId`.
2. For each, fetch the event via the calendar MCP (`get_event`) and take its
   `description` — the user will have filled in the `tkt_xxx → …` lines.
3. Pass that description to `ingest_answers`. It parses every filled answer and
   resolves the matching tickets in one call, returning `resolved` + `skipped`.
4. Report what was resolved; the worker agents unblock on their next
   `check_response`. FYIs need no answer.

**B. The user tells you decisions in chat** — call `resolve` per `ticket_id`
(shown in the briefing in parentheses) with their decision. Same effect.

Prefer A when a briefing was booked (let the user answer in the event); use B for
quick verbal decisions.

## Quick status

`list_agenda` (optionally `status: queued`) shows what's waiting, scheduled, or
answered — use it for "what do the agents need from me?"

## Notes

- Never invent calendar availability — always read freebusy via the calendar MCP.
- One blocker = one ASAP meeting; routine items bundle into one briefing block.
- If `plan_meetings` returns nothing, the queue is empty — say so.
- Changed your mind on a decision? `reopen` the ticket, then re-answer.
- Dropping a meeting? `discard_meeting` re-queues its open tickets and returns the
  `calendarEventId` for you to delete via the calendar MCP. Stale *proposals*
  (never booked, >24h) auto-expire on the next `plan_meetings`.
