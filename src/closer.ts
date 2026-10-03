import { spawnSync } from "node:child_process";
import { splitClosed, splitInto } from "./builder.ts";
import { commentOnPr, commentOnTicket, commentsOn, labelsOf, labelsUnread, markWith, NEEDS_HUMAN, RESOLVING, WAITING, type MarkedLabel } from "./post.ts";
import { FINGERPRINT, REVIEWED_FROM, TICKET_BRANCH } from "./reviewer.ts";
import { exitFor, stopsOf } from "./stops.ts";
import { quoted, why } from "./ticket-shape.ts";

const stoppedAt = stopsOf({ unresliced: "Close: the re-slice will not start once the ticket is closed" });
type Stop = ReturnType<typeof stoppedAt>;

const MERGED = /^Merge pull request #(\d+) from \S+?(?:\/ticket\/(\d+))?$/;
const NAMED = /^(?:[ ,]*#\d+)+/;
const BUILDS = /^Builds #(\d+)[ \t]*$/m;
const MACHINE_BRANCH = /^(ticket|land)\//;
const NO_PR = /^no pull requests found/m;
const REQUIRED_CHECKS = ["check", "review"];
const PASSED = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);

const run = (command: string, args: string[]) => spawnSync(command, args, { encoding: "utf8", maxBuffer: Infinity });
const gh = (args: string[]) => run("gh", args);
const quietly = { ...process.env, GH_TOKEN: process.env.QUIET_GH_TOKEN };
const quietGh = (args: string[]) => spawnSync("gh", args, { encoding: "utf8", env: quietly });
const git = (args: string[]) => run("git", args);

class Unread extends Error {}

const unread = (line: string): never => {
  throw new Unread(`close: ${line}`);
};

function read(got: ReturnType<typeof run>, line: string): string {
  return got.status === 0 ? got.stdout.trim() : unread(line);
}

const ghRead = (args: string[], line: string) => read(gh(args), line);
const gitRead = (args: string[], line: string) => read(git(args), line);

function answered(got: ReturnType<typeof run>, line: string): boolean {
  if (got.status !== 0 && got.status !== 1) unread(line);
  return got.status === 0;
}

function labelsHeld(ticket: string): string[] {
  const held = labelsOf(ticket, gh);
  return held === "unread" ? unread(labelsUnread(ticket)) : held;
}

function commentsRead(number: string, line: string): string[] {
  return commentsOn(number, gh) ?? unread(line);
}

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

interface QueuedPr {
  number: string;
  headRefName: string;
  headRefOid: string;
  checks: Checks;
}

type Checks = "green" | "pending" | "red";

interface CheckRun {
  name?: string;
  status?: string;
  conclusion?: string;
}

function checksOf(rollup: CheckRun[]): Checks {
  const latest = REQUIRED_CHECKS.map((name) => rollup.filter((ran) => ran.name === name).at(-1));
  if (latest.some((ran) => ran?.status === "COMPLETED" && !PASSED.has(ran.conclusion ?? ""))) return "red";
  return latest.every((ran) => ran?.status === "COMPLETED") ? "green" : "pending";
}

const NOTHING_MARKED = "so nothing is marked";

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
  const held = labelsHeld(ticket);
  if (![label, NEEDS_HUMAN, RESOLVING].some((kept) => held.includes(kept))) mark(ticket, label);
}

const LANDING = "landing" as const satisfies MarkedLabel;

function wantedOn(pr: QueuedPr, merging: QueuedPr | undefined, held: string[]): MarkedLabel | undefined {
  if (pr.checks === "red") return undefined;
  if (pr === merging && (pr.checks === "green" || held.includes(LANDING))) return LANDING;
  return pr.checks === "green" ? "queued" : "checking";
}

function settle(ticket: string, pr: QueuedPr, merging: QueuedPr | undefined, conflicted: boolean): void {
  const held = labelsHeld(ticket);
  const wanted = conflicted || held.includes(RESOLVING) ? undefined : wantedOn(pr, merging, held);
  const writes = wanted !== undefined && !held.includes(NEEDS_HUMAN) && (wanted !== "checking" || held.includes(LANDING));
  if (writes && !held.includes(wanted)) mark(ticket, wanted);
  else if (!writes && held.includes(LANDING) && !held.includes(NEEDS_HUMAN)) mark(ticket, "checking");
}

function wakeBuilder(ticket: string, reason: string): void {
  gh(["workflow", "run", "fix.yml", "-f", `ticket=${ticket}`, "-f", `reason=${reason}`]);
}

function resliced(ticket: string): Stop | undefined {
  const started = gh(["workflow", "run", "reslice.yml", "-f", `issue=${ticket}`]);
  return started.status === 0 ? undefined : stoppedAt("unresliced", `close: #${ticket} closed, but the re-slice would not start: ${quoted((started.stderr || started.stdout).trim().split("\n")[0] ?? "")}`);
}

const headLine = (oid: string) => `Head: \`${oid}\``;

const conflicts = (pr: QueuedPr, reason: string) =>
  /conflict/i.test(reason) || !answered(git(["merge-tree", "--write-tree", "--quiet", "origin/main", `origin/${pr.headRefName}`]), `whether PR #${pr.number} conflicts with main could not be read, ${NOTHING_MARKED}`);

function conflictReportedAtHead(pr: QueuedPr): boolean {
  return commentsRead(pr.number, `the comments on PR #${pr.number} could not be read, ${NOTHING_MARKED}`).some((said) => FAILED_BRANCH_UPDATE.test(said) && said.includes(headLine(pr.headRefOid)) && conflicts(pr, said));
}

type Moved = "updated" | "conflicted" | "retried";

function updateBranch(pr: QueuedPr): Moved {
  const { number, headRefName, headRefOid } = pr;
  const ticket = TICKET_BRANCH.exec(headRefName)?.[1];
  const updated = gh(["pr", "update-branch", number]);
  if (updated.status === 0) {
    commentOnPr(number, `${branchUpdate(number)} ${thisRun}`, gh);
    if (ticket !== undefined) markOnce(ticket, LANDING);
    return "updated";
  }
  const reason = (updated.stderr || updated.stdout).trim().split("\n")[0] || "no reason given";
  if (!conflicts(pr, reason)) {
    console.log(`close: PR #${number} could not be brought up to date with main, and will be tried again: ${reason}`);
    return "retried";
  }
  commentOnPr(number, `${failedBranchUpdate(number)} ${reason}\n\n${headLine(headRefOid)}\n\nRun: ${thisRun}`, gh);
  if (ticket !== undefined && labelsHeld(ticket).includes(NEEDS_HUMAN)) console.log(`close: #${ticket} is labelled ${NEEDS_HUMAN}, so the conflict on PR #${number} wakes no builder`);
  else if (ticket !== undefined) {
    mark(ticket, RESOLVING);
    wakeBuilder(ticket, `#${ticket}'s ${failedBranchUpdate(number)} ${reason}`);
  }
  return "conflicted";
}

const upToDate = (pr: QueuedPr) =>
  answered(git(["merge-base", "--is-ancestor", "origin/main", `origin/${pr.headRefName}`]), `whether PR #${pr.number} is up to date with main could not be read, ${NOTHING_MARKED}`);

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
            moved.set(pr, outcome);
            return outcome === "updated";
          })
      : undefined;
  for (const pr of queued) {
    const ticket = TICKET_BRANCH.exec(pr.headRefName)?.[1];
    if (ticket !== undefined && moved.get(pr) !== "updated") settle(ticket, pr, merging, moved.get(pr) === "conflicted");
  }
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
  const asked = gh(["pr", "view", `ticket/${parent}`, "--json", "state", "--jq", ".state"]);
  if (asked.status !== 0 && !NO_PR.test(asked.stderr)) unread(`the PR of #${parent} could not be read, so #${ticket} is not woken`);
  const state = asked.stdout.trim();
  if (state !== "MERGED" && state !== "CLOSED") return "";
  const woke = gh(["issue", "edit", ticket, "--remove-label", WAITING]);
  return woke.status === 0 ? `; #${ticket} builds now, the PR of #${parent} ${state.toLowerCase()}` : `; #${ticket} could not be woken: ${quoted((woke.stderr || woke.stdout).trim().split("\n")[0] ?? "")}`;
}

function wokenWaiting(ticket: string, body: string, merged: string | undefined): string {
  const comments = commentsRead(ticket, `the comments on #${ticket} could not be read, so it is not woken`);
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
  const queued = queue();
  const subject = gitRead(["log", "-1", "--format=%s", "HEAD"], "the merge on main could not be read, so no ticket is closed");
  const merge = process.argv[2] === "queue" ? undefined : built(subject);
  if (merge === undefined) {
    console.log(`close: ${queued}${wokenAfterParents()}`);
    return undefined;
  }
  const { ticket, pr } = merge;
  const asked = gh(["issue", "view", ticket, "--json", "body", "--jq", ".body"]);
  if (asked.status !== 0) return stoppedAt("unread", `close: ticket ${ticket} could not be read, so nothing judged it`);
  const prComments = commentsRead(pr, `the comments on PR #${pr} could not be read, ${leftAsItIs(ticket)}`);
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

function closeOrStop(): Stop | undefined {
  try {
    return close();
  } catch (error) {
    if (error instanceof Unread) return stoppedAt("unread", error.message);
    throw error;
  }
}

if (import.meta.main) process.exit(exitFor(closeOrStop()));
