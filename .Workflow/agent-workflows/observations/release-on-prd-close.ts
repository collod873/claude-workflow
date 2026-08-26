import { pathToFileURL } from "node:url";
import { execGh, type GhExec } from "../shared/gh";
import { execGit, type GitExec } from "../shared/git";
import { runRelease, type RunReleaseOptions, type RunReleaseResult } from "./run-release";

/**
 * The PRD-close connector (spec #63 §Solution move 4): fires the release
 * path the moment a PRD issue closes as delivered. `run-release.ts`'s
 * `runRelease` already does the whole release decision — reads
 * `LAST_RELEASE_REF` as `base`, evaluates `computeReleaseScope` with
 * `prdClosed: true`, and opens the PR when it fires — unchanged; this
 * module is only the gate that decides whether a given issue close is a
 * genuine, in-scope PRD-close event at all, and calls into that seam
 * exactly once when it is.
 *
 * `prdClosed` is unconditionally `true` on every call this gate lets
 * through: `computeReleaseScope`'s own trigger is `prdClosed ||
 * releasedCount >= threshold`, so a PRD close alone always satisfies it.
 * This connector's whole job is deciding *whether* `runRelease` runs, not
 * what it decides once it does — that judgement stays entirely inside the
 * seam #68 already landed.
 */

/**
 * The only close reason that claims a PRD was delivered — mirrors
 * `close-gate.ts`'s `DELIVERY_CLOSE_REASON` both in name and in why it
 * exists twice: `release-on-prd-close.yml`'s job-level `if` is the first
 * reader (so a close claiming nothing never starts a runner), and this
 * constant is the second, for a local run and for the case where that
 * condition is ever edited wrong. `release-on-prd-close.test.ts` asserts
 * the workflow file still names it.
 */
export const CLOSE_STATE_REASON = "completed";

/**
 * The label `/to-spec` applies to a spec issue (see `to-tickets.yml`'s own
 * `if`), read here as "this issue was a PRD" — the second half of the same
 * two-condition scope the workflow's `if` spells out, and the second reader
 * of it for the same reason `CLOSE_STATE_REASON` is.
 */
export const PRD_LABEL = "prd";

export interface EntrypointInput {
  /** For the log line only — not read by any decision this module makes. */
  issueNumber?: number;
  /** `github.event.issue.state_reason`. */
  stateReason: string | null | undefined;
  /** Label names on the issue at close time — `github.event.issue.labels[*].name`. */
  labels: string[];
  /** The commit `runRelease` scopes its release through — `GITHUB_SHA` in production. */
  head: string;
  /** The repo the release's git reads and writes land in. */
  repoDir: string;
  git?: GitExec;
  gh?: GhExec;
  /** Forwarded to `runRelease`. Defaults to its own `computeReleaseScope` default. */
  threshold?: number;
  /** Forwarded to `runRelease`'s `composeRelease` call. Omit for `gh`'s own default. */
  prBase?: string;
  /**
   * The release seam itself, injected so a test can record calls without
   * exercising `run-release.ts`'s real git/gh behaviour — mirrors
   * `close-gate.ts`'s injected `exec`/`gh`. Defaults to the real
   * `runRelease`.
   */
  runRelease?: (options: RunReleaseOptions) => RunReleaseResult;
  log?: (line: string) => void;
}

export interface EntrypointOutcome {
  /** `false` when the close was out of this connector's scope — `runRelease` was never called. */
  ran: boolean;
  opened?: boolean;
  releasedCount?: number;
  output?: string;
}

/**
 * The connector. Every write it can trigger goes through the injected
 * `runRelease` (which itself writes only through its own injected `git`/
 * `gh`), so a test asserts "the release module ran exactly once" or "no
 * `gh` call was made" rather than assuming either.
 */
export function runReleaseOnPrdClose(input: EntrypointInput): EntrypointOutcome {
  const git = input.git ?? execGit;
  const gh = input.gh ?? execGh;
  const release = input.runRelease ?? runRelease;
  const log = input.log ?? ((line: string) => console.log(line));
  const { stateReason, labels, issueNumber } = input;

  if (stateReason !== CLOSE_STATE_REASON || !labels.includes(PRD_LABEL)) {
    log(
      `#${issueNumber ?? "?"} out of scope: state_reason=${stateReason ?? "unspecified"}, ` +
        `labels=${labels.length > 0 ? labels.join(",") : "none"} — not a completed PRD close.`,
    );
    return { ran: false };
  }

  const result = release({
    git,
    gh,
    repoDir: input.repoDir,
    head: input.head,
    prdClosed: true,
    threshold: input.threshold,
    prBase: input.prBase,
  });

  log(
    result.opened
      ? `#${issueNumber ?? "?"} opened a release PR: ${result.output ?? ""}`.trim()
      : `#${issueNumber ?? "?"} released nothing (${result.releasedCount} released observation(s) in scope).`,
  );

  return { ran: true, opened: result.opened, releasedCount: result.releasedCount, output: result.output };
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

  const outcome = runReleaseOnPrdClose({
    issueNumber,
    stateReason: process.env.STATE_REASON || null,
    labels,
    head,
    repoDir: process.cwd(),
  });

  console.log(outcome.ran ? `ran (opened=${outcome.opened ?? false})` : "out of scope — no release attempted");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
