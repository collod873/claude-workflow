import type { GhExec } from "../shared/gh";
import { ReleaseBatch } from "./release-batch-schema";

/** The title every release PR opens with — one release, one review. */
const RELEASE_PR_TITLE = "Release: observations from this batch";

export interface ComposeReleaseOptions {
  /** The injected `gh` executor (`shared/gh.ts`) — the only seam this composer writes through. */
  gh: GhExec;
  /** The selected observations for this release, already split into mechanised and prose halves. */
  batch: ReleaseBatch;
  /** The branch the release PR merges into. Defaults to `gh`'s own default branch resolution when omitted. */
  base?: string;
  /**
   * The branch already carrying the mechanised findings' applied diffs,
   * committed (`Machinery-Commit: true`, spec #36 / #50's convention) and
   * pushed. This composer never applies a diff or pushes a branch itself —
   * only opens the PR — so `head` names work that already happened
   * upstream of it. Omit for a prose-only release to let `gh` use the
   * current branch.
   */
  head?: string;
}

/** What `composeRelease` hands back. */
export interface ComposeReleaseResult {
  /** `false` when the batch had nothing release-eligible in either half — no `gh` call was made at all. */
  opened: boolean;
  /** `gh pr create`'s own stdout (the new PR's URL). Present only when `opened` is true. */
  output?: string;
}

/**
 * Opens one pull request for a release batch (spec #36 §Solution: "Release
 * as a pull request, not an issue... One review, not N issues" — never N
 * issues, one per finding). A batch with nothing release-eligible in either
 * half makes no `gh` call at all: an empty release is not a release.
 * Otherwise this composes a body with one checklist item per prose finding
 * — mechanised findings are already visible in the PR's own diff view, so
 * they are not restated here — and calls `gh pr create` exactly once. The
 * body carries no `Closes` directive: a release describes what changed, it
 * does not close anything on its own (mirrors `renderBody.ts`'s own
 * published-ticket bodies).
 */
export function composeRelease(options: ComposeReleaseOptions): ComposeReleaseResult {
  const { gh, base, head } = options;
  const batch = ReleaseBatch.parse(options.batch);

  if (batch.mechanised.length === 0 && batch.prose.length === 0) {
    return { opened: false };
  }

  const body = renderReleaseBody(batch);
  const args = ["pr", "create", "--title", RELEASE_PR_TITLE, "--body", body];
  if (base) args.push("--base", base);
  if (head) args.push("--head", head);

  const output = gh(args);
  return { opened: true, output };
}

/**
 * Renders a release PR's body: an "Applied automatically" section naming
 * each mechanised finding (its diff is the PR's own diff, not restated
 * here), followed by a "Needs a decision" checklist — one `- [ ] <item>`
 * line per prose finding, the same list-item shape `renderBody.ts` uses for
 * a slice's acceptance criteria. Either section is omitted when its half of
 * the batch is empty.
 */
function renderReleaseBody(batch: ReleaseBatch): string {
  const sections: string[] = [];

  if (batch.mechanised.length > 0) {
    const items = batch.mechanised.map((entry) => `- ${entry.observation.finding}`).join("\n");
    sections.push(`## Applied automatically\n\n${items}`);
  }

  if (batch.prose.length > 0) {
    const items = batch.prose.map((entry) => `- [ ] ${entry.checklistItem}`).join("\n");
    sections.push(`## Needs a decision\n\n${items}`);
  }

  return sections.join("\n\n");
}
