import type { GhExec } from "./gh";
import { reason } from "./reason";
import rawCatalogue from "./labels.json";

export type LabelFamily = "in-flight" | "machine" | "owner" | "verb" | "kind" | "fire";

export interface CatalogueLabel {
  name: string;
  color: string;
  description: string;
  family: LabelFamily;
}

export const DESCRIPTION_LIMIT = 100;

export const FAMILY_COLORS: Record<LabelFamily, string> = {
  "in-flight": "0e8a16",
  machine: "1d76db",
  owner: "d93f0b",
  verb: "5319e7",
  kind: "c2c2c2",
  fire: "fbca04",
};

export const FAMILY_HOLDERS: Record<LabelFamily, string> = {
  "in-flight": "In flight: a lane is on it now",
  machine: "Waiting on the machine",
  owner: "Waiting on the owner",
  verb: "Verbs only the owner applies",
  kind: "Kind, never state",
  fire: "Yours to fire",
};

export const SHAPING_LABEL = "1-shaping";
export const SPECCING_LABEL = "2-speccing";
export const SLICING_LABEL = "3-slicing";
export const ACCEPTING_LABEL = "4-accepting";
export const BUILDING_LABEL = "5-building";
export const VERIFYING_LABEL = "6-verifying";
export const FIXING_LABEL = "7-fixing";
export const REVIEWING_LABEL = "7-reviewing";
export const LANDING_LABEL = "8-landing";
export const RATIFYING_LABEL = "ratifying";

export const SLICED_LABEL = "3-sliced";
export const WAITING_LABEL = "waiting";
export const QUEUED_LABEL = "queued";
export const SLICEABLE_LABEL = "sliceable";

export const NEEDS_HUMAN_LABEL = "needs-human";
export const BY_HAND_LABEL = "by-hand";
export const DECIDE_LABEL = "1-decide";
export const QUESTIONS_OPEN_LABEL = "2-questions-open";
export const SLICE_FAILED_LABEL = "slice-failed";
export const SHAPE_REFUSED_LABEL = "shape-refused";
export const SPEC_GAP_LABEL = "spec/gap";

export const TO_BUILD_LABEL = "to-build";
export const TO_SPEC_LABEL = "to-spec";

export const PRD_LABEL = "prd";
export const IDEA_LABEL = "idea";
export const FINDING_LABEL = "lane-07-finding";

export const TICKET_LABEL = "ticket";

export const LABEL_CATALOGUE: readonly CatalogueLabel[] = rawCatalogue as CatalogueLabel[];

const BY_NAME = new Map(LABEL_CATALOGUE.map((label) => [label.name, label]));

export function labelsOf(...families: LabelFamily[]): string[] {
  return LABEL_CATALOGUE.filter((label) => families.includes(label.family)).map((label) => label.name);
}

const LANE_LABELS = new Set(labelsOf("in-flight", "machine"));

const STATE_LABELS = new Set([...LANE_LABELS, DECIDE_LABEL, QUESTIONS_OPEN_LABEL]);

export type StateLabel =
  | typeof SHAPING_LABEL
  | typeof SPECCING_LABEL
  | typeof SLICING_LABEL
  | typeof ACCEPTING_LABEL
  | typeof BUILDING_LABEL
  | typeof VERIFYING_LABEL
  | typeof FIXING_LABEL
  | typeof REVIEWING_LABEL
  | typeof LANDING_LABEL
  | typeof RATIFYING_LABEL
  | typeof SLICED_LABEL
  | typeof WAITING_LABEL
  | typeof QUEUED_LABEL
  | typeof SLICEABLE_LABEL
  | typeof DECIDE_LABEL
  | typeof QUESTIONS_OPEN_LABEL;

export function isLaneLabel(name: string): boolean {
  return LANE_LABELS.has(name);
}

export function isInFlight(name: string): boolean {
  return BY_NAME.get(name)?.family === "in-flight";
}

export function wearsLane(labels: readonly string[], label: string): boolean {
  return labels.includes(label) && !labels.some((each) => each !== label && LANE_LABELS.has(each));
}

export function ensureLabel(gh: GhExec, name: string): void {
  const label = BY_NAME.get(name);
  if (label === undefined) throw new Error(`${name} is not in the label catalogue`);
  gh(["label", "create", label.name, "--color", label.color, "--description", label.description, "--force"]);
}

export function readIssueLabels(gh: GhExec, issueNumber: number): string[] {
  try {
    const parsed = JSON.parse(gh(["issue", "view", String(issueNumber), "--json", "labels"])) as {
      labels?: Array<{ name?: string }>;
    };
    return (parsed.labels ?? []).flatMap((label) => (label.name === undefined ? [] : [label.name]));
  } catch {
    return [];
  }
}

function staleLaneLabels(current: readonly string[], keeping: string): string[] {
  return current.filter((each) => each !== keeping && LANE_LABELS.has(each));
}

function removals(labels: readonly string[]): string[] {
  return labels.flatMap((each) => ["--remove-label", each]);
}

export function markLane(gh: GhExec, issueNumber: number, label: StateLabel, wearing?: readonly string[]): void {
  try {
    if (!STATE_LABELS.has(label)) throw new Error(`${label} is not a lane label`);
    ensureLabel(gh, label);
    const stale = staleLaneLabels(wearing ?? readIssueLabels(gh, issueNumber), label);
    gh(["issue", "edit", String(issueNumber), ...removals(stale), "--add-label", label]);
  } catch (err) {
    console.error(`could not mark #${issueNumber} as ${label}: ${reason(err)}`);
  }
}

export function clearLane(gh: GhExec, issueNumber: number): void {
  const stale = staleLaneLabels(readIssueLabels(gh, issueNumber), "");
  if (stale.length === 0) return;
  gh(["issue", "edit", String(issueNumber), ...removals(stale)]);
}

export function laneRemovals(gh: GhExec, issueNumber: number, wearing?: readonly string[]): string[] {
  return removals(staleLaneLabels(wearing ?? readIssueLabels(gh, issueNumber), ""));
}

export function unlabel(gh: GhExec, issueNumber: number, label: string): void {
  gh(["issue", "edit", String(issueNumber), "--remove-label", label]);
}

export const LABELS_TABLE_OPEN = "<!-- labels-table:v1 -->";
export const LABELS_TABLE_CLOSE = "<!-- /labels-table:v1 -->";

const FAMILY_ORDER: LabelFamily[] = ["in-flight", "machine", "owner", "verb", "kind", "fire"];

export function renderLabelsTable(): string {
  const rows = FAMILY_ORDER.flatMap((family) =>
    LABEL_CATALOGUE.filter((label) => label.family === family).map(
      (label) => `| \`${label.name}\` | ${FAMILY_HOLDERS[family]} | \`#${label.color}\` | ${label.description} |`,
    ),
  );
  return [
    LABELS_TABLE_OPEN,
    "| Label | Who holds it | Colour | Means |",
    "|---|---|---|---|",
    ...rows,
    LABELS_TABLE_CLOSE,
  ].join("\n");
}

export function withLabelsTable(doc: string): string {
  const open = doc.indexOf(LABELS_TABLE_OPEN);
  const close = doc.indexOf(LABELS_TABLE_CLOSE);
  if (open === -1 || close === -1 || close < open) {
    throw new Error(`the doc carries no ${LABELS_TABLE_OPEN} … ${LABELS_TABLE_CLOSE} block to regenerate`);
  }
  return `${doc.slice(0, open)}${renderLabelsTable()}${doc.slice(close + LABELS_TABLE_CLOSE.length)}`;
}
