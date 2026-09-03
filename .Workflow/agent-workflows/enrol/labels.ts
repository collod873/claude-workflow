export interface Label {
  name: string;
  color: string;
  description: string;
}

export interface LabelChange {
  label: Label;
  exists: boolean;
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
