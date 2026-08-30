import type { GhExec } from "./gh.ts";

/**
 * The one way a lane that stopped reaches the owner: `needs-human` on the **ticket**, assigned.
 *
 * On the ticket rather than the pull request because the tracker is where the owner looks — the
 * issue list is worked, the PR list is not — and *assigned* because a label sits in a list while
 * an assignment notifies. This existed twice before it existed once: `fixer.ts` and `integrate.ts`
 * each applied a label named `blocked` to the pull request, and no label of that name has ever
 * existed in this repo, so both escalations had been failing for as long as they had been reachable
 * (measured 2026-08-30: zero PRs ever carried it). `docs/agents/pipeline-labels.md` names
 * `needs-human` as the canonical position for "an agent tried and stopped", and this is the one
 * writer of it that lanes share.
 *
 * `--force` on the create makes it idempotent — `gh issue edit --add-label` fails on a label
 * nobody has created yet, and every lane that escalates would otherwise carry the same seeding
 * step. Colour and description match `shape.yml`'s: one meaning, one look.
 */
export const NEEDS_HUMAN_LABEL = "needs-human";
const NEEDS_HUMAN_COLOR = "d93f0b";
const NEEDS_HUMAN_DESCRIPTION = "Ticket stalled; a human decision or action is required";

/**
 * `assignee` is optional only so a caller that has no owner to hand (a workstation run with no
 * `SIGNAL_ASSIGNEE`) still labels rather than throws away the escalation; every workflow sets one.
 */
export function escalateToOwner(gh: GhExec, issueNumber: number, assignee: string | undefined): void {
  gh(["label", "create", NEEDS_HUMAN_LABEL, "--color", NEEDS_HUMAN_COLOR, "--description", NEEDS_HUMAN_DESCRIPTION, "--force"]);
  gh(["issue", "edit", String(issueNumber), "--add-label", NEEDS_HUMAN_LABEL]);
  if (assignee) gh(["issue", "edit", String(issueNumber), "--add-assignee", assignee]);
}
