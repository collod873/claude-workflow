import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { splitInto } from "./builder.ts";
import { commentOnPr, commentOnTicket, commentsOn, NEEDS_HUMAN, WAITING } from "./post.ts";
import { FINGERPRINT, REVIEWED_FROM, TICKET_BRANCH } from "./reviewer.ts";
import { exitFor, stopsOf } from "./stops.ts";
import { quoted, why } from "./ticket-shape.ts";

const stoppedAt = stopsOf({ unresliced: "Close: the re-slice will not start once the ticket is closed" });
type Stop = ReturnType<typeof stoppedAt>;

const MERGED = /^Merge pull request #(\d+) from \S+?(?:\/ticket\/(\d+))?$/;
const NAMED = /^(?:[ ,]*#\d+)+/;
const BUILDS = /^Builds #(\d+)[ \t]*$/m;
const MACHINE_BRANCH = /^(ticket|land)\//;
const REQUIRED_CHECKS = ["check", "review"];
const PASSED = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);

const run = (command: string, args: string[]) => spawnSync(command, args, { encoding: "utf8", maxBuffer: Infinity });
const gh = (args: string[]) => run("gh", args);
const quietly = { ...process.env, GH_TOKEN: process.env.QUIET_GH_TOKEN };
const quietGh = (args: string[]) => spawnSync("gh", args, { encoding: "utf8", env: quietly });
const ticketState = (ticket: string) => gh(["issue", "view", ticket, "--json", "state,stateReason", "--jq", '.state + " " + .stateReason']).stdout.trim();
const git = (args: string[]) => run("git", args);

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

function ticketBuilt(subject: string): string | undefined {
  const [, pr, branch] = MERGED.exec(subject) ?? [];
  if (branch !== undefined || pr === undefined) return branch;
  const asked = gh(["pr", "view", pr, "--json", "body", "--jq", ".body"]);
  return asked.status === 0 ? BUILDS.exec(asked.stdout)?.[1] : undefined;
}

const prNumber = (subject: string): string | undefined => MERGED.exec(subject)?.[1];

function ghText(args: string[]): string | undefined {
  const got = gh(args);
  return got.status === 0 ? got.stdout.trim() : undefined;
}

function gitText(args: string[]): string | undefined {
  const got = git(args);
  return got.status === 0 ? got.stdout.trim() : undefined;
}

function marksFor(ticket: string, pr: string | undefined): Marks {
  return {
    filed: ghText(["issue", "view", ticket, "--json", "createdAt", "--jq", ".createdAt"]),
    firstCommit: gitText(["log", "--format=%aI", "--reverse", "HEAD^1..HEAD^2"])?.split("\n").find((line) => line !== ""),
    prOpened: pr === undefined ? undefined : ghText(["pr", "view", pr, "--json", "createdAt", "--jq", ".createdAt"]),
    checksGreen: pr === undefined ? undefined : ghText(["pr", "checks", pr, "--json", "completedAt", "--jq", "[.[].completedAt] | sort | last"]),
    merged: gitText(["log", "-1", "--format=%cI", "HEAD"]),
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

function speedReport(marks: Marks, collided: Collisions | undefined): string {
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
  lines.push(`- branch updates: ${collided === undefined ? "not available" : collided.branchUpdates}`);
  lines.push(`- failed branch updates: ${collided === undefined ? "not available" : collided.failedBranchUpdates}`);
  lines.push(`- re-reviews: ${collided === undefined ? "not available" : collided.reReviews}`);
  lines.push("", `Written by ${thisRun}`);
  return lines.join("\n");
}

const record = (ticket: string, pr: string | undefined, speed: string): string => [`#${ticket} is done: ${pr === undefined ? "its build" : `PR #${pr}`} merged`, "", speed].join("\n");

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

function queuedPrs(): QueuedPr[] {
  const listed = gh(["pr", "list", "--state", "open", "--json", "number,headRefName,headRefOid,autoMergeRequest,statusCheckRollup"]);
  if (listed.status !== 0) return [];
  try {
    return (JSON.parse(listed.stdout) as { number: number; headRefName: string; headRefOid: string; autoMergeRequest: unknown; statusCheckRollup: CheckRun[] | null }[])
      .filter((pr) => MACHINE_BRANCH.test(pr.headRefName) && pr.autoMergeRequest !== null)
      .sort((a, b) => a.number - b.number)
      .map((pr) => ({ number: String(pr.number), headRefName: pr.headRefName, headRefOid: pr.headRefOid, checks: checksOf(pr.statusCheckRollup ?? []) }));
  } catch {
    return [];
  }
}

const labelsOf = (issue: string) => (ghText(["issue", "view", issue, "--json", "labels", "--jq", ".labels[].name"]) ?? "").split("\n");

const mark = (ticket: string, label: string) => spawnSync(join(import.meta.dirname, "..", "bin", "mark"), [ticket, label], { stdio: "ignore", env: quietly });

function markOnce(ticket: string, label: string): void {
  const held = labelsOf(ticket);
  if (!held.includes(label) && !held.includes(NEEDS_HUMAN)) mark(ticket, label);
}

const LANDING = "landing";

const wantedOn = (pr: QueuedPr, merging: QueuedPr | undefined) => (pr.checks === "green" ? (pr === merging ? LANDING : "queued") : pr.checks === "pending" ? "checking" : undefined);

function settle(ticket: string, pr: QueuedPr, wanted: string | undefined): void {
  const held = labelsOf(ticket);
  const writes = wanted !== undefined && !held.includes(NEEDS_HUMAN) && (wanted !== "checking" || held.includes(LANDING));
  if (writes && !held.includes(wanted)) mark(ticket, wanted);
  else if (!writes && held.includes(LANDING)) for (const on of [ticket, pr.number]) quietGh(["api", "-X", "DELETE", `repos/{owner}/{repo}/issues/${on}/labels/${LANDING}`]);
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
  /conflict/i.test(reason) || git(["merge-tree", "--write-tree", "--quiet", "origin/main", `origin/${pr.headRefName}`]).status === 1;

function conflictReportedAtHead(pr: QueuedPr): boolean {
  return (commentsOn(pr.number, gh) ?? []).some((said) => FAILED_BRANCH_UPDATE.test(said) && said.includes(headLine(pr.headRefOid)) && conflicts(pr, said));
}

type Moved = "updated" | "conflicted" | "retried";

function updateBranch(pr: QueuedPr): Moved {
  const { number, headRefName, headRefOid } = pr;
  const ticket = TICKET_BRANCH.exec(headRefName)?.[1];
  const updated = gh(["pr", "update-branch", number]);
  if (updated.status === 0) {
    commentOnPr(number, `${branchUpdate(number)} ${thisRun}`, gh);
    if (ticket !== undefined) markOnce(ticket, "checking");
    return "updated";
  }
  const reason = (updated.stderr || updated.stdout).trim().split("\n")[0] || "no reason given";
  if (!conflicts(pr, reason)) {
    console.log(`close: PR #${number} could not be brought up to date with main, and will be tried again: ${reason}`);
    return "retried";
  }
  commentOnPr(number, `${failedBranchUpdate(number)} ${reason}\n\n${headLine(headRefOid)}\n\nRun: ${thisRun}`, gh);
  if (ticket !== undefined && labelsOf(ticket).includes(NEEDS_HUMAN)) console.log(`close: #${ticket} is labelled ${NEEDS_HUMAN}, so the conflict on PR #${number} wakes no builder`);
  else if (ticket !== undefined) {
    mark(ticket, "resolving");
    wakeBuilder(ticket, `#${ticket}'s ${failedBranchUpdate(number)} ${reason}`);
  }
  return "conflicted";
}

const upToDate = (pr: QueuedPr) => git(["merge-base", "--is-ancestor", "origin/main", `origin/${pr.headRefName}`]).status === 0;

function queue(): string {
  git(["fetch", "--quiet", "origin"]);
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
    if (ticket !== undefined) settle(ticket, pr, moved.get(pr) === "updated" || moved.get(pr) === "conflicted" ? undefined : wantedOn(pr, merging));
  }
  if (merging !== undefined) return `PR #${merging.number} is up to date with main, so the queue waits for it`;
  return next === undefined ? "no green PR waits behind main" : `PR #${next.number} brought up to date with main`;
}

const ended = (piece: string, merged: string | undefined) => (piece === merged ? "CLOSED COMPLETED" : ticketState(piece));

function wokenFromSplit(parent: string, split: string, merged: string | undefined): string {
  const pieces = ((NAMED.exec(split.slice(splitInto(parent).length).trimStart())?.[0] ?? "").match(/#\d+/g) ?? []).map((named) => named.slice(1));
  if (pieces.length === 0) return `; #${parent} waits, and no split record names what for`;
  const states = pieces.map((piece) => ({ piece, state: ended(piece, merged) }));
  const open = states.filter(({ state }) => !state.startsWith("CLOSED"));
  if (open.length > 0) return `; #${parent} still waits for ${open.map(({ piece }) => `#${piece}`).join(", ")}`;
  const how = states.map(({ piece, state }) => `#${piece} ${state === "CLOSED COMPLETED" ? "merged" : "closed unbuilt"}`).join(", ");
  commentOnTicket(parent, `Every ticket #${parent} was split into has closed: ${how}. #${parent} builds now.\n\nRun: ${thisRun}`, gh);
  const woke = gh(["issue", "edit", parent, "--remove-label", WAITING]);
  return woke.status === 0 ? `; #${parent} builds now, its split tickets all closed: ${how}` : `; #${parent} could not be woken: ${quoted((woke.stderr || woke.stdout).trim().split("\n")[0] ?? "")}`;
}

function wokenAfterParent(ticket: string, body: string): string {
  const parent = REVIEWED_FROM.exec(why(body))?.[1];
  if (parent === undefined) return "";
  const state = ghText(["pr", "view", `ticket/${parent}`, "--json", "state", "--jq", ".state"]);
  if (state !== "MERGED" && state !== "CLOSED") return "";
  const woke = gh(["issue", "edit", ticket, "--remove-label", WAITING]);
  return woke.status === 0 ? `; #${ticket} builds now, the PR of #${parent} ${state.toLowerCase()}` : `; #${ticket} could not be woken: ${quoted((woke.stderr || woke.stdout).trim().split("\n")[0] ?? "")}`;
}

function wokenWaiting(ticket: string, body: string, merged: string | undefined): string {
  const comments = commentsOn(ticket, gh);
  if (comments === undefined) return "";
  const split = comments.find((said) => said.startsWith(splitInto(ticket)));
  return split === undefined ? wokenAfterParent(ticket, body) : wokenFromSplit(ticket, split, merged);
}

function wokenAfterParents(merged?: string): string {
  const listed = ghText(["issue", "list", "--state", "open", "--label", WAITING, "--limit", "100", "--json", "number,body"]);
  try {
    const waiting = JSON.parse(listed ?? "[]") as { number: number; body: string }[];
    return waiting.map(({ number, body }) => wokenWaiting(String(number), body, merged)).join("");
  } catch {
    return "";
  }
}

function close(): Stop | undefined {
  const queued = queue();
  const subject = git(["log", "-1", "--format=%s", "HEAD"]).stdout.trim();
  const ticket = process.argv[2] === "queue" ? undefined : ticketBuilt(subject);
  if (ticket === undefined) {
    console.log(`close: ${queued}${wokenAfterParents()}`);
    return undefined;
  }
  const asked = gh(["issue", "view", ticket, "--json", "body", "--jq", ".body"]);
  if (asked.status !== 0) return stoppedAt("unread", `close: ticket ${ticket} could not be read, so nothing judged it`);
  const pr = prNumber(subject);
  const prComments = pr === undefined ? undefined : commentsOn(pr, gh);
  const speed = speedReport(marksFor(ticket, pr), prComments === undefined ? undefined : collisions(prComments));
  const posted = commentOnTicket(ticket, record(ticket, pr, speed), gh);
  const [refusal] = posted.refusals;
  if (refusal !== undefined) return stoppedAt("unrecorded", `close: #${ticket} got no closing record: ${quoted(refusal)}`);
  const state = ticketState(ticket);
  mark(ticket, "--closed");
  if (state !== "CLOSED COMPLETED") {
    if (state.startsWith("CLOSED")) quietGh(["issue", "reopen", ticket]);
    if (quietGh(["issue", "close", ticket, "--reason", "completed"]).status !== 0) return stoppedAt("unrecorded", `close: #${ticket} is done but could not be closed${recorded(posted.said)}`);
  }
  console.log(`close: #${ticket} closed as completed, its PR merged${recorded(posted.said)}${wokenAfterParents(ticket)}`);
  return resliced(ticket);
}

if (import.meta.main) process.exit(exitFor(close()));
