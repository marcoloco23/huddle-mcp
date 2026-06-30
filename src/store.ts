import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ---------- domain model ----------

export type TicketType = "question" | "plan" | "decision" | "fyi";
export type Urgency = "blocker" | "normal" | "low";
export type TicketStatus = "queued" | "scheduled" | "answered" | "cancelled";
export type MeetingStatus = "proposed" | "booked" | "done";
export type DesiredWindow = "asap" | "next-block";

export interface Ticket {
  id: string;
  agent: string;
  title: string;
  type: TicketType;
  urgency: Urgency;
  body: string;
  estimatedMinutes: number;
  createdAt: string;
  status: TicketStatus;
  meetingId: string | null;
  response: string | null;
  respondedAt: string | null;
}

export interface Meeting {
  id: string;
  title: string;
  desiredWindow: DesiredWindow;
  durationMinutes: number;
  ticketIds: string[];
  briefingMarkdown: string;
  status: MeetingStatus;
  calendarEventId: string | null;
  start: string | null;
  end: string | null;
  createdAt: string;
}

export interface StoreData {
  version: 1;
  tickets: Ticket[];
  meetings: Meeting[];
}

function emptyStore(): StoreData {
  return { version: 1, tickets: [], meetings: [] };
}

// ---------- ids ----------

/** Short, human-skimmable id, e.g. `tkt_3f9a2c`. */
export function makeId(prefix: "tkt" | "mtg"): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

// ---------- locking ----------
//
// Multiple agents each spawn their own agenda-mcp process but share one queue
// file. Cross-process safety comes from an atomic mkdir lock: mkdir of a
// directory either succeeds (we hold the lock) or fails EEXIST (someone else
// does). Stale locks (process crashed mid-write) are reclaimed by mtime age.

const LOCK_TIMEOUT_MS = 5_000;
const LOCK_STALE_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreError";
  }
}

export class AgendaStore {
  readonly filePath: string;
  private readonly lockPath: string;

  constructor(home?: string) {
    const base = home ?? defaultHome();
    this.filePath = join(base, "queue.json");
    this.lockPath = join(base, "queue.lock");
  }

  private async acquireLock(): Promise<void> {
    await mkdir(dirname(this.lockPath), { recursive: true });
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    for (;;) {
      try {
        await mkdir(this.lockPath);
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        try {
          const st = await stat(this.lockPath);
          if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
            await rm(this.lockPath, { recursive: true, force: true });
            continue;
          }
        } catch {
          // lock vanished between mkdir and stat — retry immediately
          continue;
        }
        if (Date.now() > deadline) {
          throw new StoreError(
            "timed out acquiring the agenda store lock; another agent may be stuck"
          );
        }
        await sleep(15 + Math.floor(Math.random() * 25));
      }
    }
  }

  private async releaseLock(): Promise<void> {
    await rm(this.lockPath, { recursive: true, force: true });
  }

  /** Read the store without locking (writes are atomic, so reads never tear). */
  async read(): Promise<StoreData> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const data = JSON.parse(raw) as StoreData;
      if (!data || data.version !== 1) return emptyStore();
      return data;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
      throw err;
    }
  }

  private async write(data: StoreData): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await rename(tmp, this.filePath);
  }

  /** Atomic read-modify-write under the cross-process lock. */
  async mutate<T>(fn: (data: StoreData) => T): Promise<T> {
    await this.acquireLock();
    try {
      const data = await this.read();
      const result = fn(data);
      await this.write(data);
      return result;
    } finally {
      await this.releaseLock();
    }
  }
}

function defaultHome(): string {
  if (process.env.AGENDA_HOME) return process.env.AGENDA_HOME;
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, "agenda-mcp");
  return join(homedir(), ".config", "agenda-mcp");
}
