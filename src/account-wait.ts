import { calledOwner, type Caller, commentOnTicket, gh, ghRead, mark } from "./post.ts";
import { WAITING } from "./spelled.ts";
import { quoted } from "./ticket-shape.ts";

export interface AccountWait {
  until: number;
  login: boolean;
  said: string;
}

const MINUTE = 60_000;
export const UNREAD_RESET_WAIT = 60 * MINUTE;
export const LOGIN_WAIT = 30 * MINUTE;
const LOGIN_WAITS_IN_A_ROW = 3;
const IN_A_ROW_WITHIN = 60 * MINUTE;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const RESETS = /resets (?:([a-z]{3})[a-z]* (\d{1,2}),? (?:at )?)?(\d{1,2})(?::(\d{2}))? ?(am|pm) \(([^)]+)\)/i;

function wallClockAt(at: number, zone: string): { year: number; month: number; day: number; asUtc: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
      .formatToParts(at)
      .map(({ type, value }) => [type, Number(value)]),
  ) as Record<string, number>;
  const [year = 0, month = 1, day = 1] = [parts.year, parts.month, parts.day];
  return { year, month: month - 1, day, asUtc: Date.UTC(year, month - 1, day, parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0) };
}

function zonedInstant(year: number, month: number, day: number, hour: number, minute: number, zone: string): number {
  const wall = Date.UTC(year, month, day, hour, minute);
  const guess = wall - (wallClockAt(wall, zone).asUtc - wall);
  return wall - (wallClockAt(guess, zone).asUtc - guess);
}

const knownZone = (zone: string) => Intl.supportedValuesOf("timeZone").includes(zone) || zone === "UTC";

export function resetOf(said: string, from: number): number | undefined {
  const [, monthName, dayOf, hourOf = "", minuteOf = "0", half = "", zone = ""] = RESETS.exec(said) ?? [];
  if (hourOf === "" || !knownZone(zone)) return undefined;
  const hour = (Number(hourOf) % 12) + (half.toLowerCase() === "pm" ? 12 : 0);
  const today = wallClockAt(from, zone);
  const month = monthName === undefined ? undefined : MONTHS.indexOf(monthName.toLowerCase());
  if (month === -1) return undefined;
  const at = (year: number, monthAt: number, day: number) => zonedInstant(year, monthAt, day, hour, Number(minuteOf), zone);
  if (month === undefined) {
    const reset = at(today.year, today.month, today.day);
    return reset > from ? reset : at(today.year, today.month, today.day + 1);
  }
  const reset = at(today.year, month, Number(dayOf));
  return reset > from ? reset : at(today.year + 1, month, Number(dayOf));
}

const WAITS_FOR = "Waits for a Claude account until ";
const LOGIN_WAIT_NUMBERED = ", login wait ";
const WAITS = new RegExp(`^${WAITS_FOR}(\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\dZ)(?:${LOGIN_WAIT_NUMBERED}(\\d+) of \\d+)?\\.$`, "m");
const WAITS_ANY = new RegExp(`\\n*^${WAITS_FOR}.*$`, "gm");

const stamp = (at: number) => `${new Date(at).toISOString().slice(0, 16)}Z`;

export function accountWaitOf(body: string): { until: number; loginWaits: number } | undefined {
  const [, until, loginWaits] = WAITS.exec(body) ?? [];
  return until === undefined ? undefined : { until: Date.parse(until), loginWaits: Number(loginWaits ?? 0) };
}

const waitsLine = (until: number, loginWaits: number) => `${WAITS_FOR}${stamp(until)}${loginWaits === 0 ? "" : `${LOGIN_WAIT_NUMBERED}${loginWaits} of ${LOGIN_WAITS_IN_A_ROW}`}.`;

export function parkedOnAccounts(issue: string, wait: AccountWait, now = Date.now()): { parked: string } | { stuck: string } {
  const body = ghRead(["issue", "view", issue, "--json", "body", "--jq", ".body"], `the body of #${issue} could not be read, so it was not parked to wait for a Claude account`);
  const before = accountWaitOf(body);
  const inARow = before !== undefined && before.loginWaits > 0 && now - before.until <= IN_A_ROW_WITHIN ? before.loginWaits : 0;
  const loginWaits = wait.login ? inARow + 1 : 0;
  const why = wait.login ? `every Claude account failed to log in: ${quoted(wait.said)}` : `every Claude account is at its usage limit: ${quoted(wait.said)}`;
  if (loginWaits > LOGIN_WAITS_IN_A_ROW) return { stuck: `${why}, after ${LOGIN_WAITS_IN_A_ROW} waits of ${LOGIN_WAIT / MINUTE} minutes in a row` };
  const parked = `#${issue} waits until ${stamp(wait.until).replace("T", " ").replace("Z", " UTC")}, as ${why}`;
  if (before !== undefined && before.until > now) {
    mark(issue, WAITING);
    return { parked };
  }
  ghRead(["issue", "edit", issue, "--body", `${[body.replace(WAITS_ANY, "").trimEnd(), waitsLine(wait.until, loginWaits)].filter((part) => part !== "").join("\n\n")}\n`], `the time #${issue} waits for a Claude account would not save, so it was not parked`);
  mark(issue, WAITING);
  commentOnTicket(issue, `${parked}. Reconcile takes \`${WAITING}\` off on its first pass after then, and it resumes from where it stopped.`, gh);
  return { parked };
}

export function waitedForAccounts(issue: string, caller: Caller, wait: AccountWait): number {
  const parking = parkedOnAccounts(issue, wait);
  if ("stuck" in parking) return calledOwner(issue, caller, parking.stuck);
  console.log(parking.parked);
  return 0;
}
