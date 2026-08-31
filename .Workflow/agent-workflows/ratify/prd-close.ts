import { pathToFileURL } from "node:url";
import { execGh, type GhExec } from "../shared/gh";
import { dispatchRatificationDue, type RatificationDueDispatch } from "./dispatch";

/**
 * The PRD-close sender: the moment a PRD issue closes as delivered, it rings
 * the ratifier lane's door.
 *
 * It decides nothing about the batch. ADR-0017's second work-volume trigger
 * is "a PRD closing," and that is the whole of what this module knows; what
 * is in scope, what survives ratification memory and what any of it becomes
 * are the ratifier stage's to answer, in its own workflow (ADR-0090's
 * filtered `types:`), never inside the run that noticed the close.
 *
 * This replaces the release-PR channel's own PRD-close connector, gate for
 * gate — the trigger survived #296 unchanged; only what it fires died.
 */

/**
 * The only close reason that claims a PRD was delivered, and the same rule
 * `.claude/hooks/close-gate.py` holds for a ticket (ADR-0013). It exists
 * twice: `ratify-on-prd-close.yml`'s job-level `if` is the first reader (so a
 * close claiming nothing never starts a runner), and this constant is the
 * second, for a local run and for the case where that condition is ever
 * edited wrong. `prd-close.test.ts` asserts the workflow file still names it.
 */
export const CLOSE_STATE_REASON = "completed";

/**
 * The label `/to-spec` applies to a spec issue (see `to-tickets.yml`'s own
 * `if`), read here as "this issue was a PRD" — the second half of the same
 * two-condition scope, and the second reader of it for the same reason.
 */
export const PRD_LABEL = "prd";

export interface EntrypointInput {
  /** For the log line only — not read by any decision this module makes. */
  issueNumber?: number;
  /** `github.event.issue.state_reason`. */
  stateReason: string | null | undefined;
  /** Label names on the issue at close time — `github.event.issue.labels[*].name`. */
  labels: string[];
  /** The commit the ratifier run scopes through — `GITHUB_SHA` in production. */
  head: string;
  gh?: GhExec;
  /** The dispatch seam, injected so a test asserts what was sent without reaching GitHub. */
  dispatch?: (gh: GhExec, dispatch: RatificationDueDispatch) => void;
  log?: (line: string) => void;
}

export interface EntrypointOutcome {
  /** `false` when the close was out of scope — nothing was dispatched. */
  sent: boolean;
}

/**
 * The gate. Every write it can cause goes through the injected dispatch (and
 * its own injected `gh`), so a test asserts "the door was rung exactly once"
 * or "no `gh` call was made" rather than assuming either.
 */
export function ratifyOnPrdClose(input: EntrypointInput): EntrypointOutcome {
  const gh = input.gh ?? execGh;
  const send = input.dispatch ?? dispatchRatificationDue;
  const log = input.log ?? ((line: string) => console.log(line));
  const { stateReason, labels, issueNumber } = input;

  if (stateReason !== CLOSE_STATE_REASON || !labels.includes(PRD_LABEL)) {
    log(
      `#${issueNumber ?? "?"} out of scope: state_reason=${stateReason ?? "unspecified"}, ` +
        `labels=${labels.length > 0 ? labels.join(",") : "none"} — not a completed PRD close.`,
    );
    return { sent: false };
  }

  send(gh, { head: input.head, prdClosed: true });
  log(`#${issueNumber ?? "?"} closed as delivered — ratification is due at ${input.head}.`);
  return { sent: true };
}

async function main(): Promise<void> {
  const issueNumber = Number(process.env.ISSUE_NUMBER);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    console.error("ISSUE_NUMBER must be set to a positive integer");
    process.exit(1);
  }
  const head = process.env.GITHUB_SHA;
  if (!head) {
    console.error("GITHUB_SHA must be set");
    process.exit(1);
  }
  const labels = (process.env.LABELS ?? "")
    .split(",")
    .map((label) => label.trim())
    .filter((label) => label.length > 0);

  const outcome = ratifyOnPrdClose({
    issueNumber,
    stateReason: process.env.STATE_REASON || null,
    labels,
    head,
  });

  console.log(outcome.sent ? "ratification-due dispatched" : "out of scope — nothing dispatched");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
