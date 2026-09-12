import type { GhExec } from "./gh";
import { reason } from "./reason";

export type LabelFamily = "in-flight" | "machine" | "owner" | "verb" | "kind" | "fire";

export interface CatalogueLabel {
  name: string;
  color: string;
  description: string;
  family: LabelFamily;
}

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
export const FUZZY_LABEL = "fuzzy";
export const BY_HAND_LABEL = "by-hand";
export const DECIDE_LABEL = "1-decide";
export const QUESTIONS_OPEN_LABEL = "2-questions-open";
export const SLICE_FAILED_LABEL = "slice-failed";
export const SHAPE_REFUSED_LABEL = "shape-refused";
export const SPEC_GAP_LABEL = "spec/gap";

export const TO_BUILD_LABEL = "to-build";
export const TO_SPEC_LABEL = "to-spec";
export const APPROVED_LABEL = "approved";
export const KILLED_LABEL = "killed";
export const PARKED_LABEL = "parked";
export const GO_LONG_LABEL = "go-long";
export const GO_SHORT_LABEL = "go-short";

export const PRD_LABEL = "prd";
export const IDEA_LABEL = "idea";
export const BUG_LABEL = "bug";
export const BUILD_ORDER_LABEL = "build-order";
export const STANDARDS_PASS_LABEL = "standards-pass";
export const FINDING_LABEL = "lane-07-finding";
export const WAYFINDER_MAP_LABEL = "wayfinder:map";

export const TICKET_LABEL = "ticket";

const entry = (family: LabelFamily) => (name: string, description: string): CatalogueLabel => ({
  name,
  color: FAMILY_COLORS[family],
  description,
  family,
});

const inFlight = entry("in-flight");
const machine = entry("machine");
const owner = entry("owner");
const verb = entry("verb");
const kind = entry("kind");
const fire = entry("fire");

export const LABEL_CATALOGUE: readonly CatalogueLabel[] = [
  inFlight(SHAPING_LABEL, "Lane 01 is shaping this idea into a decision sheet right now"),
  inFlight(SPECCING_LABEL, "Lane 02 is writing or critiquing the spec right now"),
  inFlight(SLICING_LABEL, "Lane 03 is slicing this spec into tickets right now"),
  inFlight(ACCEPTING_LABEL, "Lane 04 is authoring this ticket's acceptance tests right now"),
  inFlight(BUILDING_LABEL, "Lane 05 or the mechanic is building this ticket right now"),
  inFlight(VERIFYING_LABEL, "Lane 06 is judging this ticket's pull request right now"),
  inFlight(FIXING_LABEL, "Lane 07's fixer is repairing this ticket's red run right now"),
  inFlight(REVIEWING_LABEL, "Lane 07's reviewers are reading this ticket's diff right now"),
  inFlight(LANDING_LABEL, "Lane 08 is merging and closing this ticket right now"),
  inFlight(RATIFYING_LABEL, "The ratifier is turning this spec's observations into standards right now"),
  machine(SLICED_LABEL, "Lane 03 published this spec's tickets; the build runs on them, not on it"),
  machine(WAITING_LABEL, "A ticket behind an open blocker; the reconciler starts it when the blocker delivers"),
  machine(QUEUED_LABEL, "A ticket with every blocker delivered and no worker slot yet"),
  machine(SLICEABLE_LABEL, "A spec lane 02 handed to lane 03 to slice"),
  owner(NEEDS_HUMAN_LABEL, "Ticket stalled; a human decision or action is required"),
  owner(FUZZY_LABEL, "A decision is owed before this can be ticketed"),
  owner(BY_HAND_LABEL, "Claims a workstation, cross-repo, or immutable-set path; a human builds it by hand"),
  owner(DECIDE_LABEL, "The shaper posted its decision sheet and waits for approved, killed or parked"),
  owner(QUESTIONS_OPEN_LABEL, "The spec carries open questions; the owner's edit is what moves it"),
  owner(SLICE_FAILED_LABEL, "A to-tickets run refused or failed"),
  owner(SHAPE_REFUSED_LABEL, "Refused at lane 01 stage 1: the idea already exists, or an ADR ruled it"),
  owner(SPEC_GAP_LABEL, "The spec is silent, ambiguous or self-contradictory here"),
  verb(TO_BUILD_LABEL, "The owner handing a ticket already written in full to the build; swapped for the lane label at dispatch"),
  verb(TO_SPEC_LABEL, "A closed Wayfinder Map the owner is handing to the spec author (ADR-0059)"),
  verb(APPROVED_LABEL, "The owner accepted a decision sheet; files its ADRs and dispatches"),
  verb(KILLED_LABEL, "Shaped and rejected. Becomes prior art the sweep refuses against"),
  verb(PARKED_LABEL, "Shaped and set down. No dispatch, and nothing ever re-raises it"),
  verb(GO_LONG_LABEL, "ADR-0007's route override, applied alongside approved"),
  verb(GO_SHORT_LABEL, "ADR-0007's route override, applied alongside approved"),
  kind(PRD_LABEL, "A spec issue, filed by file-issue spec"),
  kind(IDEA_LABEL, "The owner's own words about work that might be worth doing, never edited"),
  kind(BUG_LABEL, "The owner called it a break; intake, never a verdict"),
  kind(BUILD_ORDER_LABEL, "A move on the build order (ADR-0026)"),
  kind(STANDARDS_PASS_LABEL, "A standards-authorship pass, one per run"),
  kind(FINDING_LABEL, "A lane 07 finding that survived the refuter"),
  kind(WAYFINDER_MAP_LABEL, "A Wayfinder map: Notes, Decisions-so-far and Fog"),
  kind("wayfinder:research", "A Wayfinder child: research"),
  kind("wayfinder:prototype", "A Wayfinder child: prototype"),
  kind("wayfinder:grilling", "A Wayfinder child: grilling"),
  kind("wayfinder:task", "A Wayfinder child: task"),
  kind("wayfinder:dest-spec", "A Wayfinder destination that is a spec"),
  kind("wayfinder:dest-decision", "A Wayfinder destination that is a decision"),
  fire(TICKET_LABEL, "A ticket: acceptance criteria and a file claim, filed by file-issue ticket"),
];

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

export function markLane(gh: GhExec, issueNumber: number, label: StateLabel): void {
  try {
    if (!STATE_LABELS.has(label)) throw new Error(`${label} is not a lane label`);
    ensureLabel(gh, label);
    const stale = staleLaneLabels(readIssueLabels(gh, issueNumber), label);
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

export function laneRemovals(gh: GhExec, issueNumber: number): string[] {
  return removals(staleLaneLabels(readIssueLabels(gh, issueNumber), ""));
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
