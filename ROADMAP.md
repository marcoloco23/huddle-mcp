# huddle-mcp — Roadmap

Written from the user's seat: a developer running **fleets of parallel coding
agents** who doesn't want to be interrupted on the agents' schedule. huddle's job
is to protect that person's attention — collect what the agents need, batch it by
urgency, put it on the calendar, and carry the answers back. Everything below is
ranked by how much it improves *that* experience, not by how interesting it is to
build.

## North star

> The agents run themselves and **book time with me like colleagues would**. I open
> my calendar, see a couple of briefings, answer them in the event, and the agents
> pick up my decisions and keep going — without me ever context-switching between
> five threads.

We're most of the way to the *surface* of that (queue → batch → briefing → answer
in the event → resolve). What's missing is the parts that make it run *without me
driving it*, and the parts that make it *trustworthy enough to leave on*.

## Design principles (don't regress these)

1. **Auth-free by default.** The broker never holds calendar credentials. Install
   stays one line, zero setup. New power is opt-in, never a setup tax.
2. **The broker stays dumb; the edges stay smart.** Parsing/batching is pure and
   local; the calendar and the agent runtime live behind MCPs/skills.
3. **Simplicity over features.** Every tool earns its place. If the briefing or the
   loop gets more complex, it's because it removed a context switch, not added one.
4. **Ship public, npx-installable, minimal deps.** Same bar as knuspr/overview.

## The one real tension: auth-free vs. autonomy

Today huddle *can't book itself* — it can't see free/busy by design, so a human or
an orchestrator skill has to run `plan_meetings` → book → `confirm_meeting`. Two
ways forward, and we want **both, in this order**:

- **Scheduled orchestrator (default, keeps auth-free).** A recurring Claude Code
  routine runs the `huddle` skill every N minutes: it books the queue via the
  *connected* calendar MCP and runs `ingest_answers` on due briefings. No new creds,
  no daemon — it reuses the user's existing scheduling. This is the v0.3 autonomy
  path.
- **Connected mode (opt-in).** For headless/server use, allow huddle to take its own
  calendar token so it can self-book with no orchestrator present. Explicitly opt-in,
  documented as the "I run agents on a box with no human MCP client" mode.

---

## Now — v0.2.x · make today's loop solid

Small, high-confidence fixes that remove the friction we already hit.

- **`reopen` a decided ticket.** *Why:* the moment a wrong/early answer lands, you're
  stuck — there's no way to change your mind. Re-opens the ticket (status back to
  `scheduled`/`queued`), so a corrected decision can flow.
- **`discard_meeting` + auto-expire stale proposals.** *Why:* proposed meetings that
  never get booked linger forever. Add the tool and auto-expire proposals older than
  24h on the next `plan_meetings`.
- **Private event visibility by default.** *Why:* briefings carry plans, code, and
  decisions into calendar events that may sync/share. Default the booked event to
  `private`.
- **CI publish (GitHub Action + npm automation token).** *Why:* publishing keeps
  hitting 2FA OTP by hand. A release workflow with an automation token kills the
  friction and matches "ship public" cleanly.
- **Smoke suites become real CI tests.** *Why:* lock in the parser/scheduler/loop
  behavior before it grows.

## Next — v0.3 · autonomy (the agents really do book themselves)

The biggest jump in daily value: stop having to say "book my briefings."

- **Scheduled office-hours orchestrator.** A ready-made recurring routine that runs
  plan → book → confirm and the answer read-back on a cadence, using the connected
  calendar MCP. Ships as a documented schedule, not new server code.
- **Configurable policy (`huddle.config.json`).** Working hours, timezone, default
  calendar, max meetings/day, batching cadence, ASAP threshold. *Why:* these are
  hardcoded in the skill today; everyone's day is shaped differently.
- **Recurring review blocks the queue fills.** *Why:* instead of scattering events,
  hold one or two standing "office hours" the briefings drop into — a calmer calendar.

## Next — v0.4 · close the last mile (resume the agent)

The honest gap: answering a ticket unblocks it in the store, but a worker that
already ended its turn never comes back. This is what makes the loop *feel* alive.

- **Resolution events → agent resume.** On `resolve`/`ingest_answers`, emit a signal
  the runtime can act on to re-invoke the waiting agent with the decision (Claude Code
  hook / background-task / scheduled re-trigger). *Why:* "answered" must become
  "agent actually continued."
- **`wait_for_response` (efficient long-poll).** *Why:* workers busy-poll
  `check_response` today; let them park cheaply until answered or timeout.

## Later — v0.5 · the human's experience

- **Notifications.** Ping me when a blocker gets booked and when a briefing is due —
  via my connected Slack/Gmail MCP or a push. *Why:* I shouldn't have to watch the
  calendar; huddle should reach me at the right moment, and only then.
- **Calendar → huddle sync.** If I move, decline, or delete a booked briefing, reflect
  it (reschedule, or re-open the slot). *Why:* right now the event is fire-and-forget;
  my edits should mean something.
- **Snooze / reschedule a briefing** from chat or the event.

## Later — v0.6 · briefings that scale with the fleet

As the agent count grows, a flat list stops working.

- **Dedupe & cluster.** Collapse near-duplicate questions across agents; group related
  decisions so I answer a theme once.
- **Priority ordering + a one-line summary.** Lead each briefing with "the 2 decisions
  that unblock the most work."
- **Rich context.** Let agents attach links (PRs, files, diffs); render them in the
  briefing so I can decide without spelunking.

## Later — v0.7 · reach

- **Outlook / Microsoft Graph** as a second provider — same event payload, different
  MCP, no broker change.
- **Shared queue across machines.** For agents running in containers/cloud, an optional
  shared backend (keep local JSON as the zero-setup default) so a distributed fleet
  huddles together.

## Exploration / someday

- **Dashboard + metrics** — time-to-decision, decisions/day, which agents ask the most
  (echoing overview-mcp's mission-control surface).
- **Claude Code plugin packaging** — one command installs the MCP *and* the skill.
- **Request templates** for common ask types.

---

### How the recent decisions map here

From the first live briefing's own agenda: *Outlook vs. hosted queue* → both land in
**v0.7** (Outlook first); *`discard_meeting` + auto-expire* → **v0.2.x**; *README
npm-first* → done in v0.2. The `reopen` gap surfaced while demoing the answer-loop →
top of **v0.2.x**.
