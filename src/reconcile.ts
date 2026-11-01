import { blockersOf } from "./issue-links.ts";
import { ghRead, Stopped } from "./post.ts";
import { TICKET, WAITING } from "./spelled.ts";

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
}

export interface Action {
  kind: "add-label" | "remove-label";
  repo: string;
  number: number;
  label: string;
}

function waitRule({ repo, number, labels, blockers }: IssueState): Action[] {
  if (blockers.length === 0) return [];
  const parked = labels.includes(WAITING);
  const blocked = blockers.some(({ open }) => open);
  if (parked && !blocked) return [{ kind: "remove-label", repo, number, label: WAITING }];
  if (!parked && blocked) return [{ kind: "add-label", repo, number, label: WAITING }];
  return [];
}

export const reconcile = (states: IssueState[]): Action[] => states.flatMap(waitRule);

interface Listed {
  number: number;
  labels: { name: string }[];
}

const labelsNow = (repo: string, number: number): string[] =>
  ghRead(["issue", "view", String(number), "--repo", repo, "--json", "labels", "--jq", ".labels[].name"], `the labels of ${repo}#${number} could not be read, so nothing is marked`).split("\n").filter((label) => label !== "");

function apply({ kind, repo, number, label }: Action): void {
  const held = labelsNow(repo, number).includes(label);
  if (held === (kind === "add-label")) return;
  ghRead(["issue", "edit", String(number), "--repo", repo, kind === "add-label" ? "--add-label" : "--remove-label", label], `${repo}#${number} could not be ${kind === "add-label" ? "labelled" : "unlabelled"} ${label}`);
  console.log(`reconcile: ${repo}#${number} ${kind === "add-label" ? "labelled" : "unlabelled"} ${label}`);
}

function statesOf(repo: string): IssueState[] {
  const listed = JSON.parse(ghRead(["issue", "list", "--repo", repo, "--label", TICKET, "--state", "open", "--limit", "1000", "--json", "number,labels"], `the open tickets of ${repo} could not be read, so nothing is reconciled`)) as Listed[];
  return listed.map(({ number, labels }) => ({ repo, number, labels: labels.map(({ name }) => name), blockers: blockersOf(repo, number) }));
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
