import type { GhExec } from "./gh";
import { parseIssueNumber } from "./issue-url";

/**
 * `spec/gap`: the one route in this pipeline for *the contract is wrong*, as opposed to *the code
 * is wrong*.
 *
 * [ADR-0034](../../../docs/adr/0034-spec-gap-fires-the-spec-author-and-an-acceptance-test-an-imp.md)
 * gave the label a reader — lane 02's amendment path (`spec/amend.ts`) — and ruled that where a
 * test and the spec disagree and neither is obviously wrong, the spec wins by construction, because
 * the test was authored from the spec and nothing else and neither side is the implementer's to
 * settle. [ADR-0038](../../../docs/adr/0038-lane-07-s-conformance-reviewer-files-spec-gap-where-the-spec.md)
 * gave it its first writer, lane 07's conformance reviewer.
 *
 * It lives in `shared/` because it now has two writers and they are in different lanes: lane 07,
 * which reads a diff against a spec, and the fixer, which watches an acceptance test refuse to move
 * across two independent attempts
 * ([ADR-0119](../../../docs/adr/0119-a-fixer-that-stops-making-no-progress-files-spec-gap-rather.md)).
 * One filer rather than two keeps the label, the title shape and the routing identical whichever
 * lane noticed — a second copy is exactly how `blocked` came to be applied by two lanes to a label
 * that had never existed (`shared/needs-human.ts`).
 */

/** The label a filed spec/gap issue carries — read back by lane 02's amendment path (ADR-0034, `spec/amend.ts`). */
export const SPEC_GAP_LABEL = "spec/gap";

const SPEC_GAP_COLOR = "5319e7";
const SPEC_GAP_DESCRIPTION = "The spec is silent, ambiguous or self-contradictory here";

/**
 * Files one `spec/gap` against `prdIssueNumber` and returns its number.
 *
 * `--force` on the label create for `escalateToOwner`'s reason: `gh issue create --label` fails on
 * a label nobody has created yet, and a lane whose escalation silently 403s is an escalation that
 * does not exist.
 */
export function fileSpecGap(gh: GhExec, prdIssueNumber: number, title: string, report: string): number {
  gh(["label", "create", SPEC_GAP_LABEL, "--color", SPEC_GAP_COLOR, "--description", SPEC_GAP_DESCRIPTION, "--force"]);
  const body = [`Filed against #${prdIssueNumber} (ADR-0034).`, "", report].join("\n");
  const created = gh(["issue", "create", "--title", title, "--body", body, "--label", SPEC_GAP_LABEL]);
  return parseIssueNumber(created, title);
}
