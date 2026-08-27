import { pathToFileURL } from "node:url";
import { z } from "zod";
import { execGh, type GhExec } from "../shared/gh";
import { reason } from "../shared/reason";

/**
 * Lane 07's counter (PRD #145, move 7a;
 * [ADR-0037](../../../docs/adr/0037-the-refuter-fleet-is-sized-by-what-the-owner-does-with-survi.md)):
 * sizes the refuter fleet by what the owner does with a surviving finding,
 * never by the refuter's own kill rate. Two-sided, and deliberately
 * asymmetric — **grow** is cheap to be wrong about (a prompt edit), so it
 * fires on thin evidence; **delete** is expensive to be wrong about (a
 * filter quietly gone), so it needs a much larger count. Both directions
 * only ever `gh issue create` — this counter never closes, reopens, or
 * edits anything, the same shape `watchdog/bypass-counter.ts` already has
 * for a one-sided counter.
 *
 * **Grow reads the tracker directly.** A lane-07 finding always reaches the
 * owner as an issue (never a notification), so its fate — closed
 * `not_planned`, or left open past the five-day expiry — is already on the
 * record. This module reads it fresh every sweep, the same "recomputes,
 * stores nothing" shape `bypass-counter.ts` has.
 *
 * **Delete does not.** A finding the refuter refuses is killed silently by
 * design (ADR-0035) — it never becomes an issue, so nothing about it is
 * tracker evidence the way a survivor's fate is. That count lives only in
 * the memory of whatever called the refuter — `review.ts`'s chain, once
 * wired — so this module takes it as `RefuterTally` rather than inventing a
 * second, undocumented place to log it. Sizing the delete trigger is still
 * this module's job; counting up to it is the caller's, exactly as it
 * already is in memory the moment the refuter fleet finishes a run.
 */

/** [ADR-0037](../../../docs/adr/0037-the-refuter-fleet-is-sized-by-what-the-owner-does-with-survi.md): 3 false alarms proposes a second refuter. */
export const GROW_THRESHOLD = 3;

/** ADR-0037: 20 findings reaching the refuter with zero ever refuted proposes the fleet's deletion. */
export const DELETE_THRESHOLD = 20;

/** ADR-0037 §8: "left untouched" — 2.5× the longest this repo has ever taken to close an issue. */
export const FALSE_ALARM_EXPIRY_DAYS = 5;
const FALSE_ALARM_EXPIRY_MS = FALSE_ALARM_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

/** The label the code that files a lane-07 finding issue is expected to apply. */
export const FINDING_LABEL = "lane-07-finding";

/** One lane-07 finding issue, as `gh issue list --json` returns it. */
export interface FindingIssue {
  number: number;
  state: string;
  /** GitHub's own reason for a close — `COMPLETED`, `NOT_PLANNED`, or absent for an open issue. */
  stateReason?: string;
  createdAt: string;
}

/**
 * How many findings the refuter has read, and how many of those it ever
 * refused — the delete trigger's own count. The caller's to produce (see
 * this file's own doc comment); this module only asks whether it clears
 * the threshold.
 */
export interface RefuterTally {
  reached: number;
  refuted: number;
}

/** `true` when `stateReason` is GitHub's spelling of "this will not be done", case-insensitively. */
function isNotPlanned(stateReason: string | undefined): boolean {
  return (stateReason ?? "").toUpperCase() === "NOT_PLANNED";
}

/**
 * Whether `issue` is a false alarm: a surviving finding the owner closed
 * `not_planned`, or one he left open past the five-day expiry.
 * `completed` — a finding he acted on — is never a false alarm, however
 * long it took.
 */
export function isFalseAlarm(issue: FindingIssue, now: Date): boolean {
  if (issue.state.toUpperCase() === "CLOSED") return isNotPlanned(issue.stateReason);
  return now.getTime() - new Date(issue.createdAt).getTime() >= FALSE_ALARM_EXPIRY_MS;
}

/** How many of `issues` are false alarms as of `now`. */
export function falseAlarmCount(issues: FindingIssue[], now: Date): number {
  return issues.filter((issue) => isFalseAlarm(issue, now)).length;
}

/** Whether `count` clears the grow trigger. */
export function shouldProposeGrow(count: number): boolean {
  return count >= GROW_THRESHOLD;
}

/** Whether `tally` clears the delete trigger — the refuter has never once refused anything. */
export function shouldProposeDelete(tally: RefuterTally): boolean {
  return tally.reached >= DELETE_THRESHOLD && tally.refuted === 0;
}

/** One direction's signal issue, as read back off the tracker to decide whether to re-propose. */
export interface SignalIssue {
  number: number;
  body: string | null;
  state: string;
  stateReason?: string | null;
}

/** A hidden marker recording the count a proposal was filed at, namespaced per direction so the two never collide. */
export function countMarker(direction: "grow" | "delete", count: number): string {
  return `<!-- lane-07-counter:${direction}:${count} -->`;
}

/** The count recorded on a `direction` marker inside `body`, or `undefined` if it carries none. */
export function markedCount(body: string, direction: "grow" | "delete"): number | undefined {
  const match = body.match(new RegExp(`<!-- lane-07-counter:${direction}:(\\d+) -->`));
  return match ? Number(match[1]) : undefined;
}

export const GROW_ISSUE_TITLE = "Lane 07's findings are keeping false alarms — propose a second refuter";
export const DELETE_ISSUE_TITLE =
  "Lane 07's refuter has refused nothing in 20 findings — propose deleting the fleet";

export function growIssueBody(count: number): string {
  return [
    `**${count}** surviving lane-07 finding${count === 1 ? "" : "s"} closed \`not planned\`, or left`,
    `untouched past the ${FALSE_ALARM_EXPIRY_DAYS}-day expiry — that many false alarms reached the`,
    "owner's queue.",
    "",
    "**Proposal:** add a second refuter ([ADR-0035](../../../docs/adr/0035-lane-07-ships-with-one-refuter-and-a-refusal-that-names-no-r.md)).",
    "Adding a refuter is a prompt edit, so this is cheap to act on and cheap to be wrong about.",
    "",
    "Close this **completed** and it will not ask again until the count above has grown. Close it",
    "**not planned** and it will not ask again at all.",
    "",
    countMarker("grow", count),
  ].join("\n");
}

export function deleteIssueBody(tally: RefuterTally): string {
  return [
    `The refuter has read **${tally.reached}** findings and refused **${tally.refuted}** of them.`,
    "",
    "**Proposal:** delete the refuter fleet ([ADR-0037](../../../docs/adr/0037-the-refuter-fleet-is-sized-by-what-the-owner-does-with-survi.md)) —",
    "a filter that has never once refused anything across this many findings is not filtering,",
    "whatever the survivors' fate. Being wrong here is expensive and silent, so this fires only",
    "at a large count.",
    "",
    "Close this **completed** and it will not ask again until the count above has grown. Close it",
    "**not planned** and it will not ask again at all.",
    "",
    countMarker("delete", tally.reached),
  ].join("\n");
}

/** One direction's outcome — mirrors `watchdog/bypass-counter.ts`'s `Outcome.code`. */
export type DirectionOutcome =
  | { code: "below-threshold" }
  | { code: "already-proposed"; issue: number }
  | { code: "declined-and-not-grown"; declinedAt: number }
  | { code: "declined-for-good"; issue: number }
  | { code: "proposed"; issue: number };

export interface CounterOutcome {
  falseAlarmCount: number;
  tally: RefuterTally;
  grow: DirectionOutcome;
  delete: DirectionOutcome;
}

/**
 * Every issue carrying a `direction` marker, whatever count it was filed at
 * — the evidence `evaluateProposal` needs to decide whether a fresh
 * proposal would repeat one the owner has already ruled on.
 */
function carriersFor(existing: SignalIssue[], direction: "grow" | "delete"): SignalIssue[] {
  const prefix = `<!-- lane-07-counter:${direction}:`;
  return existing.filter((issue) => (issue.body ?? "").includes(prefix));
}

/**
 * Decides, and if warranted files, one direction's proposal — never closes
 * or reopens anything. Shared between `grow` and `delete` because the
 * "already open / declined for good / declined but grown / never asked"
 * shape is the same lookup either direction, just against a differently
 * namespaced marker (`watchdog/bypass-counter.ts`'s own logic, generalised
 * to two directions instead of one).
 */
function evaluateProposal(options: {
  gh: GhExec;
  direction: "grow" | "delete";
  count: number;
  title: string;
  body: string;
  assignee: string;
  existing: SignalIssue[];
  log: (line: string) => void;
}): DirectionOutcome {
  const { gh, direction, count, title, body, assignee, existing, log } = options;
  const carriers = carriersFor(existing, direction);

  const standing = carriers.find((issue) => issue.state.toUpperCase() === "OPEN");
  if (standing) {
    log(`${direction}: proposal #${standing.number} already stands`);
    return { code: "already-proposed", issue: standing.number };
  }

  const refused = carriers.find(
    (issue) => issue.state.toUpperCase() === "CLOSED" && isNotPlanned(issue.stateReason ?? undefined),
  );
  if (refused) {
    log(`${direction}: #${refused.number} was closed as not planned, so this asks no further`);
    return { code: "declined-for-good", issue: refused.number };
  }

  const highestDeclined = carriers
    .map((issue) => markedCount(issue.body ?? "", direction))
    .filter((each): each is number => each !== undefined)
    .sort((a, b) => a - b)
    .pop();
  if (highestDeclined !== undefined && count <= highestDeclined) {
    log(`${direction}: not past the declined count of ${highestDeclined}`);
    return { code: "declined-and-not-grown", declinedAt: highestDeclined };
  }

  const url = gh(["issue", "create", "--title", title, "--body", body, "--assignee", assignee]).trim();
  const opened = Number(url.split("/").pop());
  log(`${direction}: opened #${opened}`);
  return { code: "proposed", issue: opened };
}

const FindingIssueSchema = z.object({
  number: z.number(),
  state: z.string(),
  stateReason: z.string().nullable().optional(),
  createdAt: z.string(),
});

const SignalIssueSchema = z.object({
  number: z.number(),
  body: z.string().nullable(),
  state: z.string(),
  stateReason: z.string().nullable().optional(),
});

function readFindingIssues(gh: GhExec): FindingIssue[] {
  const raw = gh([
    "issue",
    "list",
    "--state",
    "all",
    "--label",
    FINDING_LABEL,
    "--limit",
    "200",
    "--json",
    "number,state,stateReason,createdAt",
  ]);
  return FindingIssueSchema.array()
    .parse(JSON.parse(raw))
    .map((issue) => ({ ...issue, stateReason: issue.stateReason ?? undefined }));
}

/** Every issue this repo carries, open or closed — read once and reused for both directions' markers. */
function readSignals(gh: GhExec): SignalIssue[] {
  const raw = gh(["issue", "list", "--state", "all", "--limit", "200", "--json", "number,body,state,stateReason"]);
  return SignalIssueSchema.array().parse(JSON.parse(raw));
}

export interface CounterOptions {
  gh: GhExec;
  /** How many findings the refuter has read and refused since evidence began — see `RefuterTally`'s own doc comment for why this is a parameter rather than fetched here. */
  tally: RefuterTally;
  /** Who a filed proposal is assigned to, so it notifies rather than sits in a list. */
  assignee: string;
  now?: Date;
  log?: (line: string) => void;
}

export function runCounter(options: CounterOptions): CounterOutcome {
  const { gh, tally, assignee } = options;
  const now = options.now ?? new Date();
  const log = options.log ?? ((line: string) => console.log(line));

  const alarmCount = falseAlarmCount(readFindingIssues(gh), now);
  const signals = readSignals(gh);

  const grow: DirectionOutcome = shouldProposeGrow(alarmCount)
    ? evaluateProposal({
        gh,
        direction: "grow",
        count: alarmCount,
        title: GROW_ISSUE_TITLE,
        body: growIssueBody(alarmCount),
        assignee,
        existing: signals,
        log,
      })
    : (log(`grow: ${alarmCount} false alarm(s) — below the threshold of ${GROW_THRESHOLD}`), { code: "below-threshold" });

  const del: DirectionOutcome = shouldProposeDelete(tally)
    ? evaluateProposal({
        gh,
        direction: "delete",
        count: tally.reached,
        title: DELETE_ISSUE_TITLE,
        body: deleteIssueBody(tally),
        assignee,
        existing: signals,
        log,
      })
    : (log(`delete: ${tally.reached} reached, ${tally.refuted} refused — below the trigger`), {
        code: "below-threshold",
      });

  return { falseAlarmCount: alarmCount, tally, grow, delete: del };
}

async function main(): Promise<void> {
  try {
    const assignee = process.env.SIGNAL_ASSIGNEE;
    if (!assignee) throw new Error("SIGNAL_ASSIGNEE must be set — an unassigned issue notifies nobody");

    const reached = Number(process.env.REFUTER_TALLY_REACHED ?? "0");
    const refuted = Number(process.env.REFUTER_TALLY_REFUTED ?? "0");

    const outcome = runCounter({ gh: execGh, assignee, tally: { reached, refuted } });
    console.log(
      `grow: ${outcome.grow.code} (${outcome.falseAlarmCount} false alarms); ` +
        `delete: ${outcome.delete.code} (${outcome.tally.reached} reached, ${outcome.tally.refuted} refused)`,
    );
  } catch (err) {
    console.error(`counter failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
