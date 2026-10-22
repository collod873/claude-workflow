import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checked, faultsClosed, readiedTree, LABELLED_WAITING, splitClosed, splitInto } from "./builder.ts";
import { answered, CALLER_FILE as caller, commentOnPr, commentOnTicket, commentsRead, ENROLLED_REVIEW, FAULT_FROM, gh, ghAs, ghRead, git, gitRead, type Held, heldOn, labelsHeld, MACHINE_REPO, markWith, NOTHING_MARKED, opened, prOfTicket, readOrStop, RESOLVING, REVIEWED_FROM, TICKET_BRANCH, ticketBranch, unread, WAITING, type MarkedLabel } from "./post.ts";
import { CHECKING, LANDING, QUEUED } from "./spelled.ts";
import { exitFor, type Stop, stoppedAt } from "./stops.ts";
import { quoted, waitsOn, why } from "./ticket-shape.ts";

const MERGED = new RegExp(`^Merge pull request #(\\d+) from \\S+?(?:/${ticketBranch("(\\d+)")})?$`);
const NAMED = /^(?:[ ,]*#\d+)+/;
const BUILDS = /^Builds #(\d+)[ \t]*$/m;
const REQUIRED_CHECKS = ["check", ENROLLED_REVIEW];
const PASSED = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);
const ENDED_STATES = new Set(["SUCCESS", "FAILURE", "ERROR"]);

const quietly = { ...process.env, GH_TOKEN: process.env.QUIET_GH_TOKEN };
const quietGh = ghAs(quietly);

const ticketState = (ticket: string, line: string) => ghRead(["issue", "view", ticket, "--json", "state,stateReason", "--jq", '.state + " " + .stateReason'], `the state of #${ticket} could not be read, ${line}`);

const failedBranchUpdate = (pr: string) => `PR #${pr} could not be brought up to date with main:`;
const branchUpdate = (pr: string) => `PR #${pr} brought up to date with main by`;
const FAILED_BRANCH_UPDATE = new RegExp(`^${failedBranchUpdate("\\d+")}`);
const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: runId } = process.env;
const thisRun = server && repository && runId ? `${server}/${repository}/actions/runs/${runId}` : "a run outside Actions";

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

const record = ({ ticket, pr }: Built): string => `#${ticket} is done: PR #${pr} merged`;

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
  context?: string;
  status?: string;
  conclusion?: string;
  state?: string;
}

const ranAs = (run: CheckRun) => ({
  name: run.name ?? run.context ?? "",
  ended: run.state === undefined ? run.status === "COMPLETED" : ENDED_STATES.has(run.state),
  passed: run.state === undefined ? PASSED.has(run.conclusion ?? "") : run.state === "SUCCESS",
});

export function checksOf(rollup: CheckRun[]): Checks {
  const required = REQUIRED_CHECKS.map((name) => rollup.map(ranAs).filter((run) => run.name === name));
  if (required.some((runs) => runs.some((run) => run.ended && !run.passed))) return "red";
  return required.every((runs) => runs.length > 0 && runs.every((run) => run.ended)) ? "green" : "pending";
}


function queuedPrs(): QueuedPr[] {
  const line = `the open PRs could not be read, ${NOTHING_MARKED}`;
  const listed = ghRead(["pr", "list", "--state", "open", "--json", "number,headRefName,headRefOid,autoMergeRequest,statusCheckRollup"], line);
  try {
    return (JSON.parse(listed) as { number: number; headRefName: string; headRefOid: string; autoMergeRequest: unknown; statusCheckRollup: CheckRun[] | null }[])
      .filter((pr) => TICKET_BRANCH.test(pr.headRefName) && pr.autoMergeRequest !== null)
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
  return gh(["workflow", "run", caller, "-f", `ticket=${ticket}`, "-f", `reason=${reason}`]);
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

type Moved = "updated" | "conflicted" | "red" | Retried;

const firstLine = (got: { stdout: string; stderr: string }) => (got.stderr || got.stdout).trim().split("\n")[0] || "no reason given";

function mergedWithMain(headRefName: string): { head: string } | Retried {
  const fetched = git(["fetch", "--quiet", "origin", "main", headRefName]);
  if (fetched.status !== 0) return { retried: firstLine(fetched) };
  const checkedOut = git(["checkout", "--quiet", "--detach", `origin/${headRefName}`]);
  if (checkedOut.status !== 0) return { retried: firstLine(checkedOut) };
  const merged = git(["merge", "--quiet", "--no-edit", "origin/main"]);
  if (merged.status !== 0) {
    git(["merge", "--abort"]);
    const named = `${merged.stdout}${merged.stderr}`.split("\n").filter((line) => line.startsWith("CONFLICT")).join("; ");
    return { retried: named || firstLine(merged) };
  }
  return { head: gitRead(["rev-parse", "HEAD"], `the head of ${headRefName} merged with main could not be read, ${NOTHING_MARKED}`) };
}

const checkStatus = (head: string, state: "success" | "failure", description: string) => gh(["api", "-X", "POST", `repos/{owner}/{repo}/statuses/${head}`, "-f", `state=${state}`, "-f", "context=check", "-f", `description=${description}`]);

function wokenOnConflict(pr: BehindPr, ticket: string | undefined, reason: string, say: (line: string) => void): void {
  const { number, headRefOid } = pr;
  commentOnPr(number, `${failedBranchUpdate(number)} ${reason}\n\n${headLine(headRefOid)}\n\nRun: ${thisRun}`, gh);
  const held = ticket === undefined ? undefined : heldOn(labelsHeld(ticket, gh));
  if (held !== undefined) say(`close: #${ticket ?? ""} is labelled ${held}, so the conflict on PR #${number} wakes no builder`);
  else if (ticket !== undefined) {
    mark(ticket, RESOLVING);
    wakeBuilder(ticket, `#${ticket}'s ${failedBranchUpdate(number)} ${reason}`);
  }
}

function wokenOnRed(pr: BehindPr, ticket: string | undefined, verdict: string, say: (line: string) => void): void {
  const { number } = pr;
  const held = ticket === undefined ? undefined : heldOn(labelsHeld(ticket, gh));
  if (ticket !== undefined) commentOnTicket(ticket, `PR #${number} was brought up to date with main and the full check of the result ended red, so it carries no green check and does not merge: ${quoted(verdict)}\n\nRun: ${thisRun}`, gh);
  if (held !== undefined) say(`close: #${ticket ?? ""} is labelled ${held}, so the red check on PR #${number} wakes no builder`);
  else if (ticket !== undefined) {
    mark(ticket, RESOLVING);
    wakeBuilder(ticket, `#${ticket}'s PR #${number} was brought up to date with main and the full check of the result ended red: ${quoted(verdict)}`);
  }
}

export function updateBranch(pr: BehindPr, say = console.log): Moved {
  const { number, headRefName } = pr;
  const ticket = TICKET_BRANCH.exec(headRefName)?.[1];
  const merged = mergedWithMain(headRefName);
  if ("retried" in merged) {
    if (!conflicts(pr, merged.retried)) return merged;
    wokenOnConflict(pr, ticket, merged.retried, say);
    return "conflicted";
  }
  const { unready } = readiedTree();
  if (unready !== undefined) return { retried: `the tree's setup failed: ${unready}` };
  const judged = checked();
  const pushed = git(["push", "--quiet", "origin", `HEAD:refs/heads/${headRefName}`]);
  if (pushed.status !== 0) return { retried: firstLine(pushed) };
  if ("red" in judged) {
    const posted = checkStatus(merged.head, "failure", `red on the closer's full check after its update with main: ${quoted(judged.verdict)}`);
    if (posted.status !== 0) return { retried: firstLine(posted) };
    commentOnPr(number, `${branchUpdate(number)} ${thisRun}, and the full check of the result ended red: ${quoted(judged.verdict)}`, gh);
    wokenOnRed(pr, ticket, judged.verdict, say);
    return "red";
  }
  if (!judged.unjudged) {
    const posted = checkStatus(merged.head, "success", "judged by the closer's full check after its update with main (#1345)");
    if (posted.status !== 0) return { retried: firstLine(posted) };
  }
  commentOnPr(number, `${branchUpdate(number)} ${thisRun}`, gh);
  if (ticket !== undefined) markOnce(ticket, LANDING);
  return "updated";
}

const upToDate = (pr: QueuedPr) =>
  answered(git(["merge-base", "--is-ancestor", "origin/main", `origin/${pr.headRefName}`]), `whether PR #${pr.number} is up to date with main could not be read, ${NOTHING_MARKED}`);

function merged({ number, headRefOid }: QueuedPr): string {
  const merge = gh(["pr", "merge", number, "--merge", "--match-head-commit", headRefOid]);
  if (merge.status === 0) return `PR #${number} merged, green and up to date with main`;
  return `PR #${number} could not be merged, so auto-merge is left to merge it: ${(merge.stderr || merge.stdout).trim().split("\n")[0] || "no reason given"}`;
}

interface Queued {
  said: string;
  stranded?: { pr: QueuedPr; reason: string };
}

function queue(): Queued {
  gitRead(["fetch", "--quiet", "origin"], `origin could not be fetched, ${NOTHING_MARKED}`);
  const queued = queuedPrs();
  const merging = queued.find((pr) => pr.checks !== "red" && upToDate(pr));
  const moved = new Map<QueuedPr, Moved>();
  let stranded: Queued["stranded"];
  const handedOn = merging === undefined && process.env.QUICK_LANE === "true" ? queued.find((pr) => pr.checks === "green") : undefined;
  if (handedOn !== undefined && process.env.GITHUB_OUTPUT !== undefined) appendFileSync(process.env.GITHUB_OUTPUT, "update=true\n");
  const next =
    merging === undefined && handedOn === undefined
      ? queued
          .filter((pr) => pr.checks === "green")
          .find((pr) => {
            const outcome = conflictReportedAtHead(pr) ? "conflicted" : updateBranch(pr);
            if (typeof outcome === "object" && TICKET_BRANCH.test(pr.headRefName)) stranded ??= { pr, reason: outcome.retried };
            moved.set(pr, outcome);
            return outcome === "updated";
          })
      : undefined;
  for (const pr of queued) {
    const ticket = TICKET_BRANCH.exec(pr.headRefName)?.[1];
    if (ticket !== undefined && moved.get(pr) !== "updated" && !(handedOn !== undefined && pr.checks === "green")) holding(ticket, () => settle(ticket, pr, merging, moved.get(pr) === "conflicted" || moved.get(pr) === "red"));
  }
  if (merging?.checks === "green") return { said: merged(merging) };
  if (merging !== undefined) return { said: `PR #${merging.number} is up to date with main, so the queue waits for it` };
  if (next !== undefined) return { said: `PR #${next.number} brought up to date with main` };
  if (handedOn !== undefined) return { said: `PR #${handedOn.number} waits for the update job to bring it up to date with main` };
  return { said: "no green PR waits behind main", stranded };
}

function unmoved({ stranded }: Queued): Stop | undefined {
  if (stranded === undefined) return undefined;
  inHand = TICKET_BRANCH.exec(stranded.pr.headRefName)?.[1];
  return stoppedAt("unmoved", `close: PR #${stranded.pr.number} could not be brought up to date with main, and no other PR moved, so this run ends red to be run again: ${stranded.reason}`);
}

const endedOrMerged = (ticket: string, merged: string | undefined, held: string) => (ticket === merged ? "CLOSED COMPLETED" : ticketState(ticket, `so #${held} is not woken`));
const stillWaits = (ticket: string, open: string[]) => `; #${ticket} still waits for ${open.map((waited) => `#${waited}`).join(", ")}`;

function openWaitedOn(ticket: string, body: string, merged: string | undefined, known: string[]): string[] {
  return waitsOn(body).filter((waited) => waited !== ticket && !known.includes(waited) && !endedOrMerged(waited, merged, ticket).startsWith("CLOSED"));
}

const howEnded = (states: { number: string; state: string }[]) => states.map(({ number, state }) => `#${number} ${state === "CLOSED COMPLETED" ? "merged" : "closed unbuilt"}`).join(", ");

function wokenFromSplit(parent: string, body: string, split: string, merged: string | undefined): string {
  const pieces = ((NAMED.exec(split.slice(splitInto(parent).length).trimStart())?.[0] ?? "").match(/#\d+/g) ?? []).map((named) => named.slice(1));
  if (pieces.length === 0) return `; #${parent} waits, and no split record names what for`;
  const states = pieces.map((piece) => ({ piece, state: endedOrMerged(piece, merged, parent) }));
  const open = [...states.filter(({ state }) => !state.startsWith("CLOSED")).map(({ piece }) => piece), ...openWaitedOn(parent, body, merged, pieces)];
  if (open.length > 0) return stillWaits(parent, open);
  const how = howEnded(states.map(({ piece, state }) => ({ number: piece, state })));
  commentOnTicket(parent, `${splitClosed(parent)} ${how}. #${parent} builds now.\n\nRun: ${thisRun}`, gh);
  const woke = gh(["issue", "edit", parent, "--remove-label", WAITING]);
  return woke.status === 0 ? `; #${parent} builds now, its split tickets all closed: ${how}` : `; #${parent} could not be woken: ${quoted((woke.stderr || woke.stdout).trim().split("\n")[0] ?? "")}`;
}

function wokenAfterParent(ticket: string, body: string, merged: string | undefined): string {
  const parent = REVIEWED_FROM.exec(why(body))?.[1];
  if (parent === undefined) return "";
  const pr = prOfTicket(parent, ["state"], gh);
  const state = pr === "none" ? undefined : pr.state;
  if (state !== "MERGED" && state !== "CLOSED") return "";
  const open = openWaitedOn(ticket, body, merged, [parent]);
  if (open.length > 0) return stillWaits(ticket, open);
  const woke = gh(["issue", "edit", ticket, "--remove-label", WAITING]);
  return woke.status === 0 ? `; #${ticket} builds now, the PR of #${parent} ${state.toLowerCase()}` : `; #${ticket} could not be woken: ${quoted((woke.stderr || woke.stdout).trim().split("\n")[0] ?? "")}`;
}

function wokenWaiting(ticket: string, body: string, merged: string | undefined): string {
  const comments = commentsRead(ticket, `the comments on #${ticket} could not be read, so it is not woken`, gh);
  const parked = comments.filter((said) => said.includes(LABELLED_WAITING)).at(-1);
  if (parked === undefined) return wokenAfterParent(ticket, body, merged);
  return parked.startsWith(splitInto(ticket)) ? wokenFromSplit(ticket, body, parked, merged) : "";
}

const FAULT_FILED = new RegExp(`https://github\\.com/${MACHINE_REPO}/issues/(\\d+)`, "g");

function wokenAtFaultOrigin(fault: string, body: string, merged: string | undefined): string {
  const [, repo, origin] = FAULT_FROM.exec(why(body)) ?? [];
  if (repo === undefined || origin === undefined) return "";
  const at = `${repo}#${origin}`;
  const asked = opened(origin, `${at} could not be read, so it is not woken`, gh, repo);
  if (asked === "missing" || !(asked.labels ?? []).some(({ name }) => name === WAITING)) return "";
  const inOrigin = ghAs({ ...process.env, GH_REPO: repo });
  const parked = commentsRead(origin, `the comments on ${at} could not be read, so it is not woken`, inOrigin).filter((said) => said.includes(LABELLED_WAITING)).at(-1) ?? "";
  const filed = [...new Set(Array.from(parked.matchAll(FAULT_FILED), ([, number]) => number ?? ""))];
  if (!filed.includes(fault)) return "";
  const states = filed.map((number) => ({ number, state: endedOrMerged(number, merged, at) }));
  const open = states.filter(({ state }) => !state.startsWith("CLOSED")).map(({ number }) => `#${number}`);
  if (open.length > 0) return `; ${at} still waits for ${open.join(", ")}`;
  const how = howEnded(states);
  commentOnTicket(origin, `${faultsClosed(origin)} ${how}. #${origin} builds now.\n\nRun: ${thisRun}`, inOrigin);
  const woke = inOrigin(["issue", "edit", origin, "--remove-label", WAITING]);
  return woke.status === 0 ? `; ${at} builds now, every machine fault it filed closed: ${how}` : `; ${at} could not be woken: ${quoted((woke.stderr || woke.stdout).trim().split("\n")[0] ?? "")}`;
}

function wokenByClosedFault(closed: string | undefined): string {
  if (closed === undefined) return "";
  const body = ghRead(["issue", "view", closed, "--json", "body", "--jq", ".body"], `#${closed} could not be read, so the ticket waiting on it is not woken`);
  return wokenAtFaultOrigin(closed, body, undefined);
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
    console.log(`close: ${queued.said}${wokenAfterParents()}${wokenByClosedFault(process.argv[3])}`);
    return unmoved(queued);
  }
  return closeMerged(merge) ?? unmoved(queued);
}

const BUCKETS = "docs/buckets.md";
const ROW = /^Row: "([^"\n]+)"/m;
const BUILT_BY = (ticket: string) => new RegExp(`\\bbuilt \\d{4}-\\d{2}-\\d{2} \\(#${ticket}\\)`);

const named = (ticket: string, row: string, why: string) => `; #${ticket} names the row ${JSON.stringify(row)}, ${why}`;

function rowMoved(table: string, row: string, state: string): string | undefined {
  const lines = table.split("\n");
  const at = lines.findIndex((line) => line.startsWith(`| ${row} |`));
  const line = lines[at];
  if (line === undefined || !/ \|$/.test(line)) return undefined;
  lines[at] = `${line.slice(0, -2)}; ${state} |`;
  return lines.join("\n");
}

function treeWith(base: string, path: string[], blob: string): string | undefined {
  const [name, ...rest] = path;
  if (name === undefined) return undefined;
  const listed = git(["ls-tree", base]);
  if (listed.status !== 0) return undefined;
  const entries = listed.stdout.split("\n").filter((entry) => entry !== "");
  const kept = entries.find((entry) => entry.endsWith(`\t${name}`));
  const sha = rest.length === 0 ? blob : kept === undefined ? undefined : treeWith(kept.split(/\s/)[2] ?? "", rest, blob);
  if (sha === undefined || kept === undefined) return undefined;
  const made = git(["mktree"], entries.map((entry) => (entry === kept ? `${kept.split(/\s/).slice(0, 2).join(" ")} ${sha}\t${name}` : entry)).join("\n") + "\n");
  return made.status === 0 ? made.stdout.trim() : undefined;
}

const LAND = join(import.meta.dirname, "..", "bin", "land");

function rowLanded(ticket: string, row: string): { said: string; failed?: true } {
  const unmoved = (why: string) => ({ said: named(ticket, row, why), failed: true as const });
  const fetched = git(["fetch", "--quiet", "origin", "main"]);
  if (fetched.status !== 0) return unmoved(`and main could not be fetched, so no row moved: ${firstLine(fetched)}`);
  const main = gitRead(["rev-parse", "origin/main"], `main could not be read, so the row #${ticket} names is not moved`);
  const read = git(["show", `${main}:${BUCKETS}`]);
  if (read.status !== 0) return { said: named(ticket, row, `and main has no ${BUCKETS}, so no row moved`) };
  if (read.stdout.split("\n").some((line) => line.startsWith(`| ${row} |`) && BUILT_BY(ticket).test(line))) return { said: named(ticket, row, `which already says #${ticket} built it, so no row moved again`) };
  const table = rowMoved(read.stdout, row, `built ${new Date().toISOString().slice(0, 10)} (#${ticket}), unmeasured`);
  if (table === undefined) return unmoved(`which ${BUCKETS} on main lacks, so no row moved`);
  const blob = git(["hash-object", "-w", "--stdin"], table);
  const tree = blob.status === 0 ? treeWith(`${main}^{tree}`, BUCKETS.split("/"), blob.stdout.trim()) : undefined;
  const commit = tree === undefined ? undefined : git(["commit-tree", tree, "-p", main, "-m", `Move the row "${row}" now #${ticket} has merged`]);
  if (commit === undefined || commit.status !== 0) return unmoved("and its move could not be written, so no row moved");
  const at = mkdtempSync(join(tmpdir(), "row-move-"));
  const added = git(["worktree", "add", "--quiet", "--detach", at, commit.stdout.trim()]);
  if (added.status !== 0) return unmoved(`and no worktree could hold its move: ${firstLine(added)}`);
  const landed = spawnSync(LAND, [], { cwd: at, encoding: "utf8" });
  git(["worktree", "remove", "--force", at]);
  return landed.status === 0 ? { said: `; moved the row ${JSON.stringify(row)} on main` } : unmoved(`and bin/land did not land its move: ${firstLine(landed)}`);
}

function rowMovedFor(ticket: string, body: string): string {
  const row = ROW.exec(why(body))?.[1];
  if (row === undefined) return "";
  const move = rowLanded(ticket, row);
  if (move.failed) commentOnTicket(ticket, `The closer could not move the row ${JSON.stringify(row)} in ${BUCKETS}, so it still needs \`built <date> (#${ticket})\` in its State: ${move.said.slice(2)}\n\nRun: ${thisRun}`, gh);
  return move.said;
}

export function closeMerged(merge: Built, say = console.log): Stop | undefined {
  const { ticket, pr } = merge;
  const asked = gh(["issue", "view", ticket, "--json", "body", "--jq", ".body"]);
  if (asked.status !== 0) return stoppedAt("unread", `close: ticket ${ticket} could not be read, so nothing judged it`);
  const posted = commentOnTicket(ticket, record(merge), gh);
  const [refusal] = posted.refusals;
  if (refusal !== undefined) return stoppedAt("unrecorded", `close: #${ticket} got no closing record: ${quoted(refusal)}`);
  const state = ticketState(ticket, "so it is not closed");
  mark(ticket, "--closed");
  if (state !== "CLOSED COMPLETED") {
    if (state.startsWith("CLOSED")) quietGh(["issue", "reopen", ticket]);
    if (quietGh(["issue", "close", ticket, "--reason", "completed"]).status !== 0) return stoppedAt("unrecorded", `close: #${ticket} is done but could not be closed${recorded(posted.said)}`);
  }
  say(`close: #${ticket} closed as completed, its PR merged${recorded(posted.said)}${wokenAfterParents(ticket)}${wokenAtFaultOrigin(ticket, asked.stdout, ticket)}${rowMovedFor(ticket, asked.stdout)}`);
  return undefined;
}

if (import.meta.main) {
  process.on("exit", (code) => {
    if (code !== 0 && inHand !== undefined && process.env.GITHUB_OUTPUT !== undefined) appendFileSync(process.env.GITHUB_OUTPUT, `ticket=${inHand}\n`);
  });
  process.exit(exitFor(readOrStop("close", close)));
}
