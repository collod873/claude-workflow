/**
 * The label vocabulary the enrol lane writes into a target — never named in this tree. ADR-0057's
 * surviving rule (kept by ADR-0133) is that every list an installer acts on is derived: the
 * vocabulary lives as prose in `docs/agents/pipeline-labels.md` and `docs/agents/issue-tracker.md`,
 * describing labels that already exist on this repository, and a second copy here in code would be
 * exactly the enumerated manifest that ADR rejected. `enrol.ts` reads this repository's own live
 * labels instead and hands the result to the pure decision this module holds.
 *
 * That decision — given what this repository carries and what a target already has, what needs
 * creating or correcting — is kept here on its own so it is asserted without an API in the loop,
 * the same split `stub-set.ts` draws for the caller stubs.
 */

/** One label as GitHub reports or accepts it — name, color (hex, no leading `#`), and description. */
export interface Label {
  name: string;
  color: string;
  description: string;
}

/** One label a target needs written, and which of the two calls that takes. */
export interface LabelChange {
  label: Label;
  /**
   * `true` — the target already carries a label of this name, with a different color or
   * description. `false` — the target carries no label of this name at all.
   */
  exists: boolean;
}

/**
 * What to change in a target that currently holds `target`, given this repository carries `own`.
 *
 * A label `target` carries that `own` does not is never touched: GitHub seeds every new
 * repository with a stock label set, and deleting a target's own labels is not this lane's
 * business.
 */
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
