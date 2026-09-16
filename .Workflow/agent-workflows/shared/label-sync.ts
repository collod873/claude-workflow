import type { GhExec } from "./gh.ts";
import { LABEL_CATALOGUE } from "./labels.ts";
import type { Label, Tracker } from "./tracker.ts";

export type { Label } from "./tracker.ts";

export interface LabelChange {
  label: Label;
  exists: boolean;
}

function asTracker(gh: GhExec): Tracker {
  return gh as unknown as Tracker;
}

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
  return asTracker(gh).repositoryLabels(repository);
}

export function catalogueDrift(gh: GhExec, repository: string): LabelChange[] {
  return labelPlan(catalogueLabels(), readLabels(gh, repository));
}

export function syncLabels(gh: GhExec, repository: string, own: Label[] = catalogueLabels()): string[] {
  const tracker = asTracker(gh);
  const changes = labelPlan(own, readLabels(gh, repository));
  for (const change of changes) {
    if (change.exists) tracker.updateLabel(repository, change.label);
    else tracker.createLabel(repository, change.label);
  }
  return changes.map((change) => change.label.name);
}
