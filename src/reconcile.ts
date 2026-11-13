import { accountWaitOf } from "./account-wait.ts";
import { admission } from "./admit.ts";
import { DISPATCH_COVERS_MINUTES, dispatchedSince, onGitHubSchedule } from "./dispatched.ts";
import { type ChecksWait, checkedRuns, checksWaitOf, waitedLine, waitedOf, waitsLine } from "./checks-wait.ts";
import { type Blocker, blockersOf, dependentsOf } from "./issue-links.ts";
import { ENROLLED_CALLER, ghRead, Stopped, ticketBranch } from "./post.ts";
import { BUILDING, CHECKING, HELD, OWNER, STUCK, TICKET, WAITING } from "./spelled.ts";

export interface IssueState {
  repo: string;
  number: number;
  labels: string[];
  blockers: Blocker[];
  checks?: { wait: ChecksWait; runs: number[] } | undefined;
  waited?: boolean;
  accountsBack?: number | undefined;
  buildingSince?: number | undefined;
  liveRun?: boolean;
  restarted?: boolean;
  refused?: boolean;
  admissible?: boolean;
  merged?: number | undefined;
}

export type Action =
  | { kind: "add-label" | "remove-label"; repo: string; number: number; label: string }
  | { kind: "waited"; repo: string; number: number; wait: ChecksWait; runs: number[] }
  | { kind: "restart"; repo: string; number: number }
  | { kind: "admit"; repo: string; number: number }
  | { kind: "flag"; repo: string; number: number }
  | { kind: "close"; repo: string; number: number; pr: number };

const STALE_AFTER = 3_600_000;
const RESTARTED = "<!-- reconcile: restarted -->";
const READMITTED = "<!-- reconcile: readmitted -->";
const refusalOf = (number: number) => `#${number} does not build, since `;

function waitRule({ repo, number, labels, blockers, checks, waited, accountsBack }: IssueState, now: number): Action[] {
  if (blockers.length === 0 && checks === undefined && waited !== true && accountsBack === undefined) return [];
  const met: Action[] = checks === undefined || checks.runs.length < checks.wait.count ? [] : [{ kind: "waited", repo, number, wait: checks.wait, runs: checks.runs.slice(0, checks.wait.count) }];
  const parked = labels.includes(WAITING);
  const blocked = blockers.some(({ open }) => open) || (checks !== undefined && met.length === 0) || (accountsBack !== undefined && now < accountsBack);
  if (parked && !blocked) return [...met, { kind: "remove-label", repo, number, label: WAITING }];
  if (!parked && blocked) return [{ kind: "add-label", repo, number, label: WAITING }];
  return met;
}

function staleRule({ repo, number, labels, buildingSince, liveRun, restarted }: IssueState, now: number): Action[] {
  if (!labels.includes(BUILDING) || HELD.some((held) => labels.includes(held))) return [];
  if (buildingSince === undefined || liveRun || now - buildingSince <= STALE_AFTER) return [];
  return [{ kind: restarted ? "flag" : "restart", repo, number }];
}

function admitRule({ repo, number, labels, refused, admissible }: IssueState): Action[] {
  if (!refused || !admissible || labels.includes(BUILDING) || HELD.some((held) => labels.includes(held))) return [];
  return [{ kind: "admit", repo, number }];
}

function mergedRule({ repo, number, merged }: IssueState): Action[] {
  return merged === undefined ? [] : [{ kind: "close", repo, number, pr: merged }];
}

export const reconcile = (states: IssueState[], now = Date.now()): Action[] => states.flatMap((state) => [...waitRule(state, now), ...staleRule(state, now), ...admitRule(state), ...mergedRule(state)]);

interface Listed {
  number: number;
  body: string;
  labels: { name: string }[];
}

function runsOf(wait: ChecksWait): number[] {
  try {
    return checkedRuns(wait);
  } catch (error) {
    if (!(error instanceof Stopped)) throw error;
    console.error(`reconcile: ${error.message}, so what waits on them stays waiting`);
    return [];
  }
}

function waitOf(body: string): Pick<IssueState, "checks" | "waited" | "accountsBack"> {
  const wait = checksWaitOf(body);
  const accountsBack = accountWaitOf(body)?.until;
  return wait === undefined ? { waited: waitedOf(body), accountsBack } : { checks: { wait, runs: runsOf(wait) }, accountsBack };
}

const labelsNow = (repo: string, number: number): string[] =>
  ghRead(["issue", "view", String(number), "--repo", repo, "--json", "labels", "--jq", ".labels[].name"], `the labels of ${repo}#${number} could not be read, so nothing is marked`).split("\n").filter((label) => label !== "");

function relabel(repo: string, number: number, to: string): void {
  ghRead(["issue", "edit", String(number), "--repo", repo, "--remove-label", TICKET], `${repo}#${number} could not be unlabelled ${TICKET} to ${to} it`);
  ghRead(["issue", "edit", String(number), "--repo", repo, "--add-label", TICKET], `${repo}#${number} could not be labelled ${TICKET} again to ${to} it`);
}

function restart(repo: string, number: number): void {
  ghRead(["issue", "comment", String(number), "--repo", repo, "--body", `${RESTARTED}\nReconcile restarted #${number}: it was labelled \`${BUILDING}\` for over an hour with no live run.`], `the restart of ${repo}#${number} could not be recorded`);
  ghRead(["issue", "edit", String(number), "--repo", repo, "--remove-label", BUILDING], `${repo}#${number} could not be unlabelled ${BUILDING} to restart it`);
  relabel(repo, number, "restart");
  console.log(`reconcile: ${repo}#${number} restarted by relabelling it ${TICKET}`);
}

function flag(repo: string, number: number): void {
  ghRead(["issue", "edit", String(number), "--repo", repo, "--add-label", STUCK], `${repo}#${number} could not be labelled ${STUCK}`);
  const text = `@${OWNER} #${number} is still labelled \`${BUILDING}\` with no live run an hour after reconcile restarted it once, so it is labelled \`${STUCK}\`. Look at its last run, and take \`${STUCK}\` off once the cause is fixed.`;
  ghRead(["issue", "comment", String(number), "--repo", repo, "--body", text], `the owner could not be called on ${repo}#${number}`);
  console.log(`reconcile: ${repo}#${number} labelled ${STUCK}, as its build stayed stale after a restart`);
}

function readmit(repo: string, number: number): void {
  ghRead(["issue", "comment", String(number), "--repo", repo, "--body", `${READMITTED}\nReconcile re-admitted #${number}: the chain that refused it is valid now.`], `the re-admission of ${repo}#${number} could not be recorded`);
  relabel(repo, number, "re-admit");
  console.log(`reconcile: ${repo}#${number} re-admitted, as its chain is valid now`);
}

function waitedOn(repo: string, number: number, wait: ChecksWait, runs: number[]): void {
  const body = ghRead(["issue", "view", String(number), "--repo", repo, "--json", "body", "--jq", ".body"], `the body of ${repo}#${number} could not be read, so it stays waiting`);
  if (!body.includes(waitsLine(wait))) return;
  ghRead(["issue", "edit", String(number), "--repo", repo, "--body", `${body.replace(waitsLine(wait), waitedLine(wait, runs))}\n`], `${repo}#${number} could not record the full checks it waited on, so it stays waiting`);
  console.log(`reconcile: ${repo}#${number} waited on ${wait.count} full checks of ${wait.repo}: runs ${runs.join(", ")}`);
}

function close(repo: string, number: number, pr: number): void {
  ghRead(["issue", "close", String(number), "--repo", repo, "--reason", "completed", "--comment", `Reconcile closed #${number}: its PR #${pr} merged but GitHub never closed it.`], `${repo}#${number} could not be closed after its PR #${pr} merged`);
  console.log(`reconcile: ${repo}#${number} closed, as its PR #${pr} merged`);
}

function apply(action: Action): void {
  if (action.kind === "close") return close(action.repo, action.number, action.pr);
  if (action.kind === "waited") return waitedOn(action.repo, action.number, action.wait, action.runs);
  if (action.kind === "restart") return restart(action.repo, action.number);
  if (action.kind === "admit") return readmit(action.repo, action.number);
  if (action.kind === "flag") return flag(action.repo, action.number);
  const { kind, repo, number, label } = action;
  const held = labelsNow(repo, number).includes(label);
  if (held === (kind === "add-label")) return;
  ghRead(["issue", "edit", String(number), "--repo", repo, kind === "add-label" ? "--add-label" : "--remove-label", label], `${repo}#${number} could not be ${kind === "add-label" ? "labelled" : "unlabelled"} ${label}`);
  console.log(`reconcile: ${repo}#${number} ${kind === "add-label" ? "labelled" : "unlabelled"} ${label}`);
}

interface Event {
  event: string;
  created_at?: string;
  label?: { name: string };
  body?: string;
}

function liveTitles(repo: string): string[] {
  return ["queued", "in_progress"].flatMap((status) =>
    ghRead(["run", "list", "--repo", repo, "--status", status, "--limit", "1000", "--json", "displayTitle", "--jq", ".[].displayTitle"], `the live runs of ${repo} could not be read, so nothing is reconciled`).split("\n"),
  );
}

const timelineOf = (repo: string, number: number): Event[] =>
  (JSON.parse(ghRead(["api", `repos/${repo}/issues/${number}/timeline?per_page=100`, "--paginate", "--slurp"], `the history of ${repo}#${number} could not be read, so nothing is reconciled`)) as Event[][]).flat();

function admitOf(repo: string, number: number, events: Event[]): Pick<IssueState, "refused" | "admissible"> {
  const comments = events.flatMap(({ event, body }) => (event === "commented" ? [body ?? ""] : []));
  const refusedAt = comments.findLastIndex((body) => body.includes(refusalOf(number)));
  const refused = refusedAt > comments.findLastIndex((body) => body.includes(READMITTED));
  return refused ? { refused, admissible: admission(String(number), "so nothing is reconciled", repo) === undefined } : { refused };
}

function buildOf(number: number, live: string[], events: Event[]): Pick<IssueState, "buildingSince" | "liveRun" | "restarted"> {
  const since = events.filter(({ event, label }) => event === "labeled" && label?.name === BUILDING).at(-1)?.created_at;
  const restarted = events.some(({ event, body }) => event === "commented" && (body ?? "").includes(RESTARTED));
  const named = new RegExp(`#${number}\\b`);
  return { buildingSince: since === undefined ? undefined : Date.parse(since), liveRun: live.some((title) => named.test(title)), restarted };
}

function mergedOf(repo: string, number: number): number | undefined {
  const pr = ghRead(["pr", "list", "--repo", repo, "--head", ticketBranch(String(number)), "--state", "merged", "--json", "number", "--jq", ".[0].number"], `the merged PR of ${repo}#${number} could not be read, so nothing is reconciled`);
  return pr === "" ? undefined : Number(pr);
}

const openWith = (repo: string, label: string): Listed[] =>
  JSON.parse(ghRead(["issue", "list", "--repo", repo, "--label", label, "--state", "open", "--limit", "1000", "--json", "number,labels,body"], `the open ${label}s of ${repo} could not be read, so nothing is reconciled`)) as Listed[];

const waitingStatesOf = (repo: string, tickets: Listed[]): IssueState[] =>
  openWith(repo, WAITING)
    .filter(({ number }) => !tickets.some((ticket) => ticket.number === number))
    .map(({ number, labels, body }) => ({ repo, number, labels: labels.map(({ name }) => name), blockers: blockersOf(repo, number), ...waitOf(body) }));

const dependentStatesOf = (repo: string, closed: number): IssueState[] =>
  dependentsOf(repo, closed)
    .filter((dependent) => dependent.open && dependent.repo !== repo)
    .map((dependent) => ({ repo: dependent.repo, number: dependent.number, labels: dependent.labels, blockers: blockersOf(dependent.repo, dependent.number), ...waitOf(dependent.body) }));

function statesOf(repo: string): IssueState[] {
  const listed = openWith(repo, TICKET);
  const building = listed.some(({ labels }) => labels.some(({ name }) => name === BUILDING));
  const live = building ? liveTitles(repo) : [];
  return listed.map(({ number, labels, body }) => {
    const names = labels.map(({ name }) => name);
    const events = timelineOf(repo, number);
    return { repo, number, labels: names, blockers: blockersOf(repo, number), ...waitOf(body), ...(names.includes(BUILDING) ? buildOf(number, live, events) : admitOf(repo, number, events)), ...(names.includes(CHECKING) ? { merged: mergedOf(repo, number) } : {}) };
  }).concat(waitingStatesOf(repo, listed));
}

function machineClockCovers(repo: string): string | undefined {
  try {
    return dispatchedSince(repo, ENROLLED_CALLER, DISPATCH_COVERS_MINUTES, "Reconcile");
  } catch (error) {
    console.error(`reconcile: ${error instanceof Error ? error.message : String(error)}, so this scheduled pass reconciles anyway`);
    return undefined;
  }
}

if (import.meta.main) {
  const [named, closed] = process.argv.slice(2);
  const repo = named ?? ghRead(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], "the repo could not be read, so nothing is reconciled");
  const covered = onGitHubSchedule() ? machineClockCovers(repo) : undefined;
  if (covered !== undefined) {
    console.log(`reconcile: the machine clock's dispatched Reconcile already ran at ${covered}, so GitHub's late schedule run reconciles nothing`);
    process.exit(0);
  }
  try {
    const dependents = closed === undefined ? [] : dependentStatesOf(repo, Number(closed));
    for (const action of reconcile([...statesOf(repo), ...dependents])) apply(action);
  } catch (error) {
    if (!(error instanceof Stopped)) throw error;
    console.error(`reconcile: ${error.message}`);
    process.exit(1);
  }
}
