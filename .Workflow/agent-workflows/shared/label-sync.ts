import { z } from "zod";
import type { GhExec } from "./gh.ts";
import { LABEL_CATALOGUE } from "./labels.ts";

export interface Label {
  name: string;
  color: string;
  description: string;
}

export interface LabelChange {
  label: Label;
  exists: boolean;
}

const RemoteLabelSchema = z.object({
  name: z.string(),
  color: z.string(),
  description: z.string().nullable().optional(),
});

export function labelPlan(own: Label[], target: Label[]): LabelChange[] {
  const targetByName = new Map(target.map((label) => [label.name, label]));
  const changes: LabelChange[] = [];
  for (const label of own) {
    const existing = targetByName.get(label.name);
    if (existing === undefined) {
      changes.push({ label, exists: false });
    } else if (existing.color !== label.color || existing.description !== label.description) {
      changes.push({ label, exists: true });
    }
  }
  return changes;
}

export function catalogueLabels(): Label[] {
  return LABEL_CATALOGUE.map(({ name, color, description }) => ({ name, color, description }));
}

export function readLabels(gh: GhExec, repository: string): Label[] {
  const raw = gh(["api", "--paginate", `repos/${repository}/labels`, "--jq", ".[] | {name, color, description}"]);
  const objects = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
  return RemoteLabelSchema.array()
    .parse(objects)
    .map((label) => ({ name: label.name, color: label.color, description: label.description ?? "" }));
}

function createLabel(gh: GhExec, repository: string, label: Label): void {
  gh([
    "api",
    "--method",
    "POST",
    `repos/${repository}/labels`,
    "-f",
    `name=${label.name}`,
    "-f",
    `color=${label.color}`,
    "-f",
    `description=${label.description}`,
  ]);
}

function updateLabel(gh: GhExec, repository: string, label: Label): void {
  gh([
    "api",
    "--method",
    "PATCH",
    `repos/${repository}/labels/${encodeURIComponent(label.name)}`,
    "-f",
    `color=${label.color}`,
    "-f",
    `description=${label.description}`,
  ]);
}

export function catalogueDrift(gh: GhExec, repository: string): LabelChange[] {
  return labelPlan(catalogueLabels(), readLabels(gh, repository));
}

export function syncLabels(gh: GhExec, repository: string, own: Label[] = catalogueLabels()): string[] {
  const changes = labelPlan(own, readLabels(gh, repository));
  for (const change of changes) {
    if (change.exists) updateLabel(gh, repository, change.label);
    else createLabel(gh, repository, change.label);
  }
  return changes.map((change) => change.label.name);
}
