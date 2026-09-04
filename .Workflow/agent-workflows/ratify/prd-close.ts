import { pathToFileURL } from "node:url";
import { execGh, type GhExec } from "../shared/gh";
import { dispatchRatificationDue, type RatificationDueDispatch } from "../shared/ratification-dispatch";

export const CLOSE_STATE_REASON = "completed";

export const PRD_LABEL = "prd";

export interface EntrypointInput {
  issueNumber?: number;
  stateReason: string | null | undefined;
  labels: string[];
  head: string;
  gh?: GhExec;
  dispatch?: (gh: GhExec, dispatch: RatificationDueDispatch) => void;
  log?: (line: string) => void;
}

export interface EntrypointOutcome {
  sent: boolean;
}

export function ratifyOnPrdClose(input: EntrypointInput): EntrypointOutcome {
  const gh = input.gh ?? execGh;
  const send = input.dispatch ?? dispatchRatificationDue;
  const log = input.log ?? ((line: string) => console.log(line));
  const { stateReason, labels, issueNumber } = input;

  if (stateReason !== CLOSE_STATE_REASON || !labels.includes(PRD_LABEL)) {
    log(
      `#${issueNumber ?? "?"} out of scope: state_reason=${stateReason ?? "unspecified"}, ` +
        `labels=${labels.length > 0 ? labels.join(",") : "none"}; not a completed PRD close.`,
    );
    return { sent: false };
  }

  send(gh, { head: input.head, prdClosed: true });
  log(`#${issueNumber ?? "?"} closed as delivered; ratification is due at ${input.head}.`);
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

  console.log(outcome.sent ? "ratification-due dispatched" : "out of scope; nothing dispatched");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
