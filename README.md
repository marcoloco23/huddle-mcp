# agenda-mcp

> An MCP server that lets your parallel coding agents **schedule briefings** on your real calendar instead of interrupting you. They queue their plans and questions; the queue batches them by urgency into time-blocks booked when you're free.

When you run a fleet of agents, the bottleneck is you. Three plans and two questions land at once, on their schedule, and the context-switching wrecks your decisions. `agenda-mcp` is the fix real employees already use: don't barge in — book a meeting.

```
auth-agent  → request_meeting("JWT vs sessions", type=plan, urgency=blocker)
ui-agent    → request_meeting("dark-mode default?", type=question)
db-agent    → request_meeting("migration applied", type=fyi)

You: "book my agent briefings"
  → 🚨 Blocker · auth-agent: JWT vs sessions      11:05–11:15
  → 📋 Agent briefing · 2 items                    14:00–14:20  (the question + the FYI)
```

You review at the booked time; the agents wait and unblock once you've decided.

## The idea: a broker, not another calendar wrapper

Wrapping a calendar is a solved problem (Google ships an official Calendar MCP; there are mature OSS ones). The value here is the **coordination layer** in front of it:

- a shared **queue** any agent can drop a request into,
- an **urgency-aware batching** policy (blockers get booked ASAP; routine items bundle into the next briefing; FYIs ride along and reserve no time),
- a **briefing renderer** that aggregates everything into one agenda you skim.

So agenda-mcp is **auth-free and provider-agnostic** — it never touches your calendar. It emits the agenda + a desired time window, and the actual freebusy lookup + event creation is delegated to whatever calendar MCP you already have connected (Google, Outlook, …). **Install = one line, zero new credentials.**

## Tools

| Tool              | Who calls it  | What it does                                                            |
| ----------------- | ------------- | ---------------------------------------------------------------------- |
| `request_meeting` | worker agent  | Queue a plan/question/decision/fyi. Returns a `ticketId`. No calendar. |
| `check_response`  | worker agent  | Poll a `ticketId`; returns the user's decision once answered.          |
| `cancel_request`  | worker agent  | Withdraw a ticket you resolved on your own.                            |
| `plan_meetings`   | orchestrator  | Batch the queue into proposed meetings + rendered briefings.           |
| `confirm_meeting` | orchestrator  | Record a booked calendar event; marks its tickets scheduled.           |
| `get_briefing`    | orchestrator  | The rendered agenda + full tickets for a meeting.                      |
| `resolve`         | orchestrator  | Record the user's decision for a ticket → unblocks the worker.         |
| `list_agenda`     | orchestrator  | What's queued / scheduled / answered.                                  |

## How it fits together

```
worker agents ──request_meeting──▶ [ agenda-mcp queue ]   (local JSON, file-locked)
   (auth, ui, db…)                       │ batch by urgency + render briefing
                                         ▼
                          plan_meetings → proposed meetings (window + duration + briefing)
                                         │
your orchestrator ──▶ your Calendar MCP: freebusy → create_event(description = briefing)
                                         │
                          confirm_meeting(meetingId, eventId, start, end)
                                         ▼
        ── you review at the booked time ──▶ resolve(ticketId, decision)
                                         ▲
worker agents ──check_response(ticketId)─┘  poll, unblock, proceed
```

The bundled **`agenda` skill** (in `skills/agenda/`) drives the orchestrator side for you — say *"book my agent briefings"* and it runs `plan_meetings`, finds free slots via your calendar MCP, creates the events, and confirms them.

## Requirements

- Node.js ≥ 20
- A calendar MCP connected in the same client (e.g. Google Calendar) for the actual booking. agenda-mcp itself needs no account and no auth.

## Install — Claude Code

```json
{
  "mcpServers": {
    "agenda": {
      "command": "npx",
      "args": ["-y", "github:marcoloco23/agenda-mcp"]
    }
  }
}
```

That's it — no env vars. Connect a Google Calendar MCP alongside it for booking, and (optionally) copy `skills/agenda/` into `~/.claude/skills/` so *"book my agent briefings"* just works.

### From source

```bash
git clone https://github.com/marcoloco23/agenda-mcp.git
cd agenda-mcp
pnpm install   # builds via the prepare hook
node dist/index.js
```

## For agent authors

Worker agents should **queue and wait**, never block the user inline:

```
request_meeting({ agent, title, body, type, urgency?, estimated_minutes? })
  → { ticketId }
# do other work, then:
check_response({ ticket_id })  → { answered, response }   # proceed once answered
```

- `type`: `question` (needs an answer) · `plan` (review a plan) · `decision` (pick an option) · `fyi` (no action).
- `urgency`: `blocker` (book ASAP) · `normal` / `low` (bundle into the next briefing). Default `normal`.

## Storage

The queue is a single JSON file shared by every agent process, at
`~/.config/agenda-mcp/queue.json` (honors `XDG_CONFIG_HOME`; override with
`AGENDA_HOME`). Concurrent writes from parallel agents are guarded by an atomic
cross-process lock.

## License

MIT
