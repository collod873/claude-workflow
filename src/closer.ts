import { appendFileSync } from "node:fs";
import { splitClosed, splitInto } from "./builder.ts";
import { answered, commentOnPr, commentOnTicket, commentsRead, gh, ghAs, ghRead, git, gitRead, type Held, heldOn, labelsHeld, markWith, NOTHING_MARKED, prOfTicket, readOrStop, RESOLVING, REVIEWED_FROM, TICKET_BRANCH, ticketBranch, unread, WAITING, type MarkedLabel } from "./post.ts";
import { FINGERPRINT } from "./reviewer.ts";
import { CHECKING, LANDING, QUEUED } from "./spelled.ts";
import { FOREIGN } from "./stage.ts";
import { exitFor, stopsOf } from "./stops.ts";
import { quoted, why } from "./ticket-shape.ts";

const stoppedAt = stopsOf({ unresliced: "Close: the re-slice will not start once the ticket is closed" });
type Stop = ReturnType<typeof stoppedAt>;

const MERGED = new RegExp(`^Merge pull request #(\\d+) from \\S+?(?:/${ticketBranch("(\\d+)")})?$`);
const NAMED = /^(?:[ ,]*#\d+)+/;
const BUILDS = /^Builds #(\d+)[ \t]*$/m;
const MACHINE_BRANCH = new RegExp(`^(?:${ticketBranch("")}|land/)`);
const caller = /\/([^/@]+)@/.exec(process.env.CALLED_FROM ?? "")?.[1];
const REQUIRED_CHECKS = FOREIGN ? ["check"] : ["check", "review"];
const PASSED = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);

const quietly = { ...process.env, GH_TOKEN: process.env.QUIET_GH_TOKEN };
const quietGh = ghAs(quietly);

const ticketState = (ticket: string, line: string) => ghRead(["issue", "view", ticket, "--json", "state,stateReason", "--jq", '.state + " " + .stateReason'], `the state of #${ticket} could not be read, ${line}`);

interface Marks {
  filed?: string;
  firstCommit?: string;
  prOpened?: string;
  checksGreen?: string;
  merged?: string;
}

interface Wait {
  label: string;
  ms: number;
}

interface Collisions {
  branchUpdates: number;
  failedBranchUpdates: number;
  reReviews: number;
}

const failedBranchUpdate = (pr: string) => `PR #${pr} could not be brought up to date with main:`;
const branchUpdate = (pr: string) => `PR #${pr} brought up to date with main by`;
const FAILED_BRANCH_UPDATE = new RegExp(`^${failedBranchUpdate("\\d+")}`);
const BRANCH_UPDATE = new RegExp(`^${branchUpdate("\\d+")} `);
const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: runId } = process.env;
const thisRun = server && repository && runId ? `${server}/${repository}/actions/runs/${runId}` : "a run outside Actions";

function collisions(comments: string[]): Collisions {
  const branchUpdates = comments.filter((comment) => BRANCH_UPDATE.test(comment)).length;
  const failedBranchUpdates = comments.filter((comment) => FAILED_BRANCH_UPDATE.test(comment)).length;
  const judged = comments.filter((comment) => FINGERPRINT.test(comment)).length;
  return { branchUpdates, failedBranchUpdates, reReviews: Math.max(judged - 1, 0) };
}

const STEPS: { key: keyof Marks; label: string }[] = [
  { key: "filed", label: "filed" },
  { key: "firstCommit", label: "first commit" },
  { key: "prOpened", label: "PR opened" },
  { key: "checksGreen", label: "checks green" },
  { key: "merged", label: "merged" },
];

interface Built {
  ticket: string;
  pr: string;
}

function built(subject: string): Built | undefined {
  const [, pr, branch] = MERGED.exec(subject) ?? [];
  if (pr === undefined) return undefined;
  const ticket = branch ?? BUILDS.exec(ghRead(["pr", "view", pr, "--json", "body", "--jq", ".body"], `the body of the merged PR #${pr} could not be read, so the ticket it built is left as it is`))?.[1];
  return ticket === undefined ? undefined : { ticket, pr };
}

const leftAsItIs = (ticket: string) => `so #${ticket} is left as it is`;

function marksFor({ ticket, pr }: Built): Marks {
  const left = leftAsItIs(ticket);
  return {
    filed: ghRead(["issue", "view", ticket, "--json", "createdAt", "--jq", ".createdAt"], `when #${ticket} was filed could not be read, ${left}`),
    firstCommit: gitRead(["log", "--format=%aI", "--reverse", "HEAD^1..HEAD^2"], `the commits PR #${pr} merged could not be read, ${left}`)
      .split("\n")
      .find((line) => line !== ""),
    prOpened: ghRead(["pr", "view", pr, "--json", "createdAt", "--jq", ".createdAt"], `when PR #${pr} opened could not be read, ${left}`),
    checksGreen: ghRead(["pr", "checks", pr, "--json", "completedAt", "--jq", "[.[].completedAt] | sort | last"], `when the checks of PR #${pr} ended could not be read, ${left}`),
    merged: gitRead(["log", "-1", "--format=%cI", "HEAD"], `when PR #${pr} merged could not be read, ${left}`),
  };
}

function waits(marks: Marks): Wait[] {
  const found: Wait[] = [];
  STEPS.reduce((before, after) => {
    const from = marks[before.key];
    const to = marks[after.key];
    const ms = from === undefined || to === undefined ? Number.NaN : Date.parse(to) - Date.parse(from);
    if (!Number.isNaN(ms)) found.push({ label: `${before.label} to ${after.label}`, ms });
    return after;
  });
  return found;
}

function human(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function speedReport(marks: Marks, collided: Collisions): string {
  const found = waits(marks);
  const lines = ["Speed report", ""];
  if (found.length === 0) {
    lines.push("- timing not available");
  } else {
    const total = found.reduce((sum, wait) => sum + wait.ms, 0);
    const longest = found.reduce((slowest, wait) => (wait.ms > slowest.ms ? wait : slowest));
    lines.push(...found.map((wait) => `- ${wait.label}: ${human(wait.ms)}`));
    lines.push(`- total, filed to merged: ${human(total)}`);
    lines.push(`- longest wait: ${human(longest.ms)}, ${longest.label}`);
  }
  lines.push(`- branch updates: ${collided.branchUpdates}`);
  lines.push(`- failed branch updates: ${collided.failedBranchUpdates}`);
  lines.push(`- re-reviews: ${collided.reReviews}`);
  lines.push("", `Written by ${thisRun}`);
  return lines.join("\n");
}

const record = ({ ticket, pr }: Built, speed: string): string => [`#${ticket} is done: PR #${pr} merged`, "", speed].join("\n");

const recorded = (said: string) => (said === "" ? "" : `; record ${said}`);

interface BehindPr {
  number: string;
  headRefName: string;
  headRefOid: string;
}

interface QueuedPr extends BehindPr {
  checks: Checks;
}

type Checks = "green" | "pending" | "red";

export interface CheckRun {
  name?: string;
  status?: string;
  conclusion?: string;
}

export function checksOf(rollup: CheckRun[]): Checks {
  const latest = REQUIRED_CHECKS.map((name) => rollup.filter((ran) => ran.name === name).at(-1));
  if (latest.some((ran) => ran?.status === "COMPLETED" && !PASSED.has(ran.conclusion ?? ""))) return "red";
  return latest.every((ran) => ran?.status === "COMPLETED") ? "green" : "pending";
}


function queuedPrs(): QueuedPr[] {
  const line = `the open PRs could not be read, ${NOTHING_MARKED}`;
  const listed = ghRead(["pr", "list", "--state", "open", "--json", "number,headRefName,headRefOid,autoMergeRequest,statusCheckRollup"], line);
  try {
    return (JSON.parse(listed) as { number: number; headRefName: string; headRefOid: string; autoMergeRequest: unknown; statusCheckRollup: CheckRun[] | null }[])
      .filter((pr) => MACHINE_BRANCH.test(pr.headRefName) && pr.autoMergeRequest !== null)
      .sort((a, b) => a.number - b.number)
      .map((pr) => ({ number: String(pr.number), headRefName: pr.headRefName, headRefOid: pr.headRefOid, checks: checksOf(pr.statusCheckRollup ?? []) }));
  } catch {
    return unread(line);
  }
}

const mark = markWith(quietly);

function markOnce(ticket: string, label: MarkedLabel): void {
  const held = labelsHeld(ticket, gh);
  if (heldOn(held) === undefined && ![label, RESOLVING].some((kept) => held.has(kept))) mark(ticket, label);
}


function wantedOn(pr: QueuedPr, merging: QueuedPr | undefined, held: Held): MarkedLabel | undefined {
  if (pr.checks === "red") return undefined;
  if (pr === merging && (pr.checks === "green" || held.has(LANDING))) return LANDING;
  return pr.checks === "green" ? QUEUED : CHECKING;
}

let inHand: string | undefined;

function holding<Ended>(ticket: string, run: () => Ended): Ended {
  const was = inHand;
  inHand = ticket;
  const ended = run();
  inHand = was;
  return ended;
}

function settle(ticket: string, pr: QueuedPr, merging: QueuedPr | undefined, conflicted: boolean): void {
  const held = labelsHeld(ticket, gh);
  const wanted = conflicted || held.has(RESOLVING) ? undefined : wantedOn(pr, merging, held);
  if (heldOn(held) !== undefined) return;
  const writes = wanted !== undefined && (wanted !== CHECKING || held.has(LANDING));
  if (writes && !held.has(wanted)) mark(ticket, wanted);
  else if (!writes && held.has(LANDING)) mark(ticket, CHECKING);
}

export function wakeBuilder(ticket: string, reason: string): ReturnType<typeof gh> {
  return gh(["workflow", "run", caller ?? "fix.yml", "-f", `ticket=${ticket}`, "-f", `reason=${reason}`]);
}

function resliced(ticket: string): Stop | undefined {
  if (caller !== undefined) return undefined;
  const started = gh(["workflow", "run", "reslice.yml", "-f", `issue=${ticket}`]);
  return started.status === 0 ? undefined : stoppedAt("unresliced", `close: #${ticket} closed, but the re-slice would not start: ${quoted((started.stderr || started.stdout).trim().split("\n")[0] ?? "")}`);
}

const headLine = (oid: string) => `Head: \`${oid}\``;

const CONFLICT = /conflict/i;

const conflicts = (pr: BehindPr, reason: string) =>
  CONFLICT.test(reason) || !answered(git(["merge-tree", "--write-tree", "--quiet", "origin/main", `origin/${pr.headRefName}`]), `whether PR #${pr.number} conflicts with main could not be read, ${NOTHING_MARKED}`);

function conflictReportedAtHead(pr: QueuedPr): boolean {
  return commentsRead(pr.number, `the comments on PR #${pr.number} could not be read, ${NOTHING_MARKED}`, gh).some((said) => FAILED_BRANCH_UPDATE.test(said) && said.includes(headLine(pr.headRefOid)) && conflicts(pr, said));
}

interface Retried {
  retried: string;
}

type Moved = "updated" | "conflicted" | Retried;

export function updateBranch(pr: BehindPr, say = console.log): Moved {
  const { number, headRefName, headRefOid } = pr;
  const ticket = TICKET_BRANCH.exec(headRefName)?.[1];
  const updated = gh(["pr", "update-branch", number]);
  if (updated.status === 0) {
    commentOnPr(number, `${branchUpdate(number)} ${thisRun}`, gh);
    if (ticket !== undefined) markOnce(ticket, LANDING);
    return "updated";
  }
  const reason = (updated.stderr || updated.stdout).trim().split("\n")[0] || "no reason given";
  if (!conflicts(pr, reason)) return { retried: reason };
  commentOnPr(number, `${failedBranchUpdate(number)} ${reason}\n\n${headLine(headRefOid)}\n\nRun: ${thisRun}`, gh);
  const held = ticket === undefined ? undefined : heldOn(labelsHeld(ticket, gh));
  if (held !== undefined) say(`close: #${ticket ?? ""} is labelled ${held}, so the conflict on PR #${number} wakes no builder`);
  else if (ticket !== undefined) {
    mark(ticket, RESOLVING);
    wakeBuilder(ticket, `#${ticket}'s ${failedBranchUpdate(number)} ${reason}`);
  }
  return "conflicted";
}

const upToDate = (pr: QueuedPr) =>
  answered(git(["merge-base", "--is-ancestor", "origin/main", `origin/${pr.headRefName}`]), `whether PR #${pr.number} is up to date with main could not be read, ${NOTHING_MARKED}`);

function merged({ number, headRefOid }: QueuedPr): string {
  const merge = gh(["pr", "merge", number, "--merge", "--match-head-commit", headRefOid]);
  if (merge.status === 0) return `PR #${number} merged, green and up to date with main`;
  return `PR #${number} could not be merged, so auto-merge is left to merge it: ${(merge.stderr || merge.stdout).trim().split("\n")[0] || "no reason given"}`;
}

function queue(): string {
  gitRead(["fetch", "--quiet", "origin"], `origin could not be fetched, ${NOTHING_MARKED}`);
  const queued = queuedPrs();
  const merging = queued.find((pr) => pr.checks !== "red" && upToDate(pr));
  const moved = new Map<QueuedPr, Moved>();
  const next =
    merging === undefined
      ? queued
          .filter((pr) => pr.checks === "green")
          .find((pr) => {
            const outcome = conflictReportedAtHead(pr) ? "conflicted" : updateBranch(pr);
            if (typeof outcome === "object") console.log(`close: PR #${pr.number} could not be brought up to date with main, and will be tried again: ${outcome.retried}`);
            moved.set(pr, outcome);
            return outcome === "updated";
          })
      : undefined;
  for (const pr of queued) {
    const ticket = TICKET_BRANCH.exec(pr.headRefName)?.[1];
    if (ticket !== undefined && moved.get(pr) !== "updated") holding(ticket, () => settle(ticket, pr, merging, moved.get(pr) === "conflicted"));
  }
  if (merging?.checks === "green") return merged(merging);
  if (merging !== undefined) return `PR #${merging.number} is up to date with main, so the queue waits for it`;
  return next === undefined ? "no green PR waits behind main" : `PR #${next.number} brought up to date with main`;
}

function wokenFromSplit(parent: string, split: string, merged: string | undefined): string {
  const ended = (piece: string) => (piece === merged ? "CLOSED COMPLETED" : ticketState(piece, `so #${parent} is not woken`));
  const pieces = ((NAMED.exec(split.slice(splitInto(parent).length).trimStart())?.[0] ?? "").match(/#\d+/g) ?? []).map((named) => named.slice(1));
  if (pieces.length === 0) return `; #${parent} waits, and no split record names what for`;
  const states = pieces.map((piece) => ({ piece, state: ended(piece) }));
  const open = states.filter(({ state }) => !state.startsWith("CLOSED"));
  if (open.length > 0) return `; #${parent} still waits for ${open.map(({ piece }) => `#${piece}`).join(", ")}`;
  const how = states.map(({ piece, state }) => `#${piece} ${state === "CLOSED COMPLETED" ? "merged" : "closed unbuilt"}`).join(", ");
  commentOnTicket(parent, `${splitClosed(parent)} ${how}. #${parent} builds now.\n\nRun: ${thisRun}`, gh);
  const woke = gh(["issue", "edit", parent, "--remove-label", WAITING]);
  return woke.status === 0 ? `; #${parent} builds now, its split tickets all closed: ${how}` : `; #${parent} could not be woken: ${quoted((woke.stderr || woke.stdout).trim().split("\n")[0] ?? "")}`;
}

function wokenAfterParent(ticket: string, body: string): string {
  const parent = REVIEWED_FROM.exec(why(body))?.[1];
  if (parent === undefined) return "";
  const pr = prOfTicket(parent, ["state"], gh);
  const state = pr === "none" ? undefined : pr.state;
  if (state !== "MERGED" && state !== "CLOSED") return "";
  const woke = gh(["issue", "edit", ticket, "--remove-label", WAITING]);
  return woke.status === 0 ? `; #${ticket} builds now, the PR of #${parent} ${state.toLowerCase()}` : `; #${ticket} could not be woken: ${quoted((woke.stderr || woke.stdout).trim().split("\n")[0] ?? "")}`;
}

function wokenWaiting(ticket: string, body: string, merged: string | undefined): string {
  const comments = commentsRead(ticket, `the comments on #${ticket} could not be read, so it is not woken`, gh);
  const split = comments.find((said) => said.startsWith(splitInto(ticket)));
  return split === undefined ? wokenAfterParent(ticket, body) : wokenFromSplit(ticket, split, merged);
}

function wokenAfterParents(merged?: string): string {
  const line = `the tickets labelled ${WAITING} could not be read, so none is woken`;
  const listed = ghRead(["issue", "list", "--state", "open", "--label", WAITING, "--limit", "100", "--json", "number,body"], line);
  let waiting: { number: number; body: string }[];
  try {
    waiting = JSON.parse(listed) as { number: number; body: string }[];
  } catch {
    return unread(line);
  }
  return waiting.map(({ number, body }) => wokenWaiting(String(number), body, merged)).join("");
}

function close(): Stop | undefined {
  const subject = gitRead(["log", "-1", "--format=%s", "HEAD"], "the merge on main could not be read, so no ticket is closed");
  const merge = process.argv[2] === "queue" ? undefined : built(subject);
  inHand = merge?.ticket;
  const queued = queue();
  if (merge === undefined) {
    console.log(`close: ${queued}${wokenAfterParents()}`);
    return undefined;
  }
  const { ticket, pr } = merge;
  const asked = gh(["issue", "view", ticket, "--json", "body", "--jq", ".body"]);
  if (asked.status !== 0) return stoppedAt("unread", `close: ticket ${ticket} could not be read, so nothing judged it`);
  const prComments = commentsRead(pr, `the comments on PR #${pr} could not be read, ${leftAsItIs(ticket)}`, gh);
  const speed = speedReport(marksFor(merge), collisions(prComments));
  const posted = commentOnTicket(ticket, record(merge, speed), gh);
  const [refusal] = posted.refusals;
  if (refusal !== undefined) return stoppedAt("unrecorded", `close: #${ticket} got no closing record: ${quoted(refusal)}`);
  const state = ticketState(ticket, "so it is not closed");
  mark(ticket, "--closed");
  if (state !== "CLOSED COMPLETED") {
    if (state.startsWith("CLOSED")) quietGh(["issue", "reopen", ticket]);
    if (quietGh(["issue", "close", ticket, "--reason", "completed"]).status !== 0) return stoppedAt("unrecorded", `close: #${ticket} is done but could not be closed${recorded(posted.said)}`);
  }
  console.log(`close: #${ticket} closed as completed, its PR merged${recorded(posted.said)}${wokenAfterParents(ticket)}`);
  return resliced(ticket);
}

if (import.meta.main) {
  process.on("exit", (code) => {
    if (code !== 0 && inHand !== undefined && process.env.GITHUB_OUTPUT !== undefined) appendFileSync(process.env.GITHUB_OUTPUT, `ticket=${inHand}\n`);
  });
  process.exit(exitFor(readOrStop("close", close)));
}
