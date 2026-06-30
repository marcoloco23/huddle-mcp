---
name: agenda
description: Book and run agent briefings. Use when the user wants to schedule the queued agent requests onto their calendar ("book my agent briefings", "what do the agents need from me", "run my agenda"), or to record decisions after reviewing one. Drives the agenda-mcp queue together with the user's connected Google Calendar MCP.
---

# Agenda — book and run agent briefings

`agenda-mcp` is a coordination broker: parallel coding agents queue their plans
and questions into it instead of interrupting the user. This skill is the
**orchestrator side** — it turns that queue into real calendar events and records
the user's decisions back. The broker never touches the calendar itself; you bridge
it to whatever **Google Calendar MCP** the user has connected.

Prerequisites: both `agenda-mcp` and a Google Calendar MCP are connected.

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
   - duration = `durationMinutes`.
3. `confirm_meeting` with the `meeting_id`, the calendar event id the calendar MCP
   returned, and the `start`/`end` you booked.

Then tell the user what you scheduled and when — one line per meeting.

## Running a briefing (recording decisions)

When the user is reviewing (at the booked time, or on demand):

1. `get_briefing` for the meeting to re-read the agenda + full tickets.
2. Walk the actionable items with the user. For each, call `resolve` with the
   `ticket_id` (shown in the briefing in parentheses) and the user's decision.
3. `resolve` flips each ticket to `answered`; the worker agents unblock on their
   next `check_response`. FYIs need no action.

## Quick status

`list_agenda` (optionally `status: queued`) shows what's waiting, scheduled, or
answered — use it for "what do the agents need from me?"

## Notes

- Never invent calendar availability — always read freebusy via the calendar MCP.
- One blocker = one ASAP meeting; routine items bundle into one briefing block.
- If `plan_meetings` returns nothing, the queue is empty — say so.
