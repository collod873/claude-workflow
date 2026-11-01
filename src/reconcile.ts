import { blockersOf } from "./issue-links.ts";
import { CALLER_FILE, ghRead, Stopped } from "./post.ts";
import { BUILDING, HELD, OWNER, STUCK, TICKET, WAITING } from "./spelled.ts";

export interface Blocker {
  repo: string;
  number: number;
  open: boolean;
}

export interface IssueState {
  repo: string;
  number: number;
  labels: string[];
  blockers: Blocker[];
  buildingSince?: number | undefined;
  liveRun?: boolean;
  restarted?: boolean;
}

export type Action =
  | { kind: "add-label" | "remove-label"; repo: string; number: number; label: string }
  | { kind: "restart"; repo: string; number: number }
  | { kind: "flag"; repo: string; number: number };

const STALE_AFTER = 3_600_000;
const RESTARTED = "<!-- reconcile: restarted -->";

function waitRule({ repo, number, labels, blockers }: IssueState): Action[] {
  if (blockers.length === 0) return [];
  const parked = labels.includes(WAITING);
  const blocked = blockers.some(({ open }) => open);
  if (parked && !blocked) return [{ kind: "remove-label", repo, number, label: WAITING }];
  if (!parked && blocked) return [{ kind: "add-label", repo, number, label: WAITING }];
  return [];
}

function staleRule({ repo, number, labels, buildingSince, liveRun, restarted }: IssueState, now: number): Action[] {
  if (!labels.includes(BUILDING) || HELD.some((held) => labels.includes(held))) return [];
  if (buildingSince === undefined || liveRun || now - buildingSince <= STALE_AFTER) return [];
  return [{ kind: restarted ? "flag" : "restart", repo, number }];
}

export const reconcile = (states: IssueState[], now = Date.now()): Action[] => states.flatMap((state) => [...waitRule(state), ...staleRule(state, now)]);

interface Listed {
  number: number;
  labels: { name: string }[];
}

const labelsNow = (repo: string, number: number): string[] =>
  ghRead(["issue", "view", String(number), "--repo", repo, "--json", "labels", "--jq", ".labels[].name"], `the labels of ${repo}#${number} could not be read, so nothing is marked`).split("\n").filter((label) => label !== "");

function restart(repo: string, number: number): void {
  ghRead(["workflow", "run", CALLER_FILE, "--repo", repo, "-f", `ticket=${number}`], `${repo}#${number} could not be restarted by dispatching ${CALLER_FILE}`);
  ghRead(["issue", "comment", String(number), "--repo", repo, "--body", `${RESTARTED}\nReconcile restarted #${number}: it was labelled \`${BUILDING}\` for over an hour with no live run.`], `the restart of ${repo}#${number} could not be recorded`);
  console.log(`reconcile: ${repo}#${number} restarted by dispatching ${CALLER_FILE}`);
}

function flag(repo: string, number: number): void {
  ghRead(["issue", "edit", String(number), "--repo", repo, "--add-label", STUCK], `${repo}#${number} could not be labelled ${STUCK}`);
  const text = `@${OWNER} #${number} is still labelled \`${BUILDING}\` with no live run an hour after reconcile restarted it once, so it is labelled \`${STUCK}\`. Look at its last run, and take \`${STUCK}\` off once the cause is fixed.`;
  ghRead(["issue", "comment", String(number), "--repo", repo, "--body", text], `the owner could not be called on ${repo}#${number}`);
  console.log(`reconcile: ${repo}#${number} labelled ${STUCK}, as its build stayed stale after a restart`);
}

function apply(action: Action): void {
  if (action.kind === "restart") return restart(action.repo, action.number);
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

function buildOf(repo: string, number: number, live: string[]): Pick<IssueState, "buildingSince" | "liveRun" | "restarted"> {
  const events = (JSON.parse(ghRead(["api", `repos/${repo}/issues/${number}/timeline?per_page=100`, "--paginate", "--slurp"], `the build history of ${repo}#${number} could not be read, so nothing is reconciled`)) as Event[][]).flat();
  const since = events.filter(({ event, label }) => event === "labeled" && label?.name === BUILDING).at(-1)?.created_at;
  const restarted = events.some(({ event, body }) => event === "commented" && (body ?? "").includes(RESTARTED));
  const named = new RegExp(`#${number}\\b`);
  return { buildingSince: since === undefined ? undefined : Date.parse(since), liveRun: live.some((title) => named.test(title)), restarted };
}

function statesOf(repo: string): IssueState[] {
  const listed = JSON.parse(ghRead(["issue", "list", "--repo", repo, "--label", TICKET, "--state", "open", "--limit", "1000", "--json", "number,labels"], `the open tickets of ${repo} could not be read, so nothing is reconciled`)) as Listed[];
  const building = listed.some(({ labels }) => labels.some(({ name }) => name === BUILDING));
  const live = building ? liveTitles(repo) : [];
  return listed.map(({ number, labels }) => {
    const names = labels.map(({ name }) => name);
    return { repo, number, labels: names, blockers: blockersOf(repo, number), ...(names.includes(BUILDING) ? buildOf(repo, number, live) : {}) };
  });
}

if (import.meta.main) {
  const repo = process.argv[2] ?? ghRead(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], "the repo could not be read, so nothing is reconciled");
  try {
    for (const action of reconcile(statesOf(repo))) apply(action);
  } catch (error) {
    if (!(error instanceof Stopped)) throw error;
    console.error(`reconcile: ${error.message}`);
    process.exit(1);
  }
}
