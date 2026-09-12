import { pathToFileURL } from "node:url";
import { requestDispatch } from "../shared/dispatch-request";
import { execGh, type GhExec } from "../shared/gh";
import { reason } from "../shared/reason";
import { signalsFixer, signalsReview, type RunEnding } from "./doors";

export const FIXER_NEEDED_WIRE = "fixer-needed";

export const REVIEW_WANTED_WIRE = "review-wanted";

export const SIGNALS = ["fixer", "review"] as const;

export type Signal = (typeof SIGNALS)[number];

export function isSignal(value: string): value is Signal {
  return (SIGNALS as readonly string[]).includes(value);
}

export interface SignalRequest {
  signal: Signal;
  ending: RunEnding;
  runId: string;
  pr: string;
  baseSha: string;
}

export function ringReader(gh: GhExec, request: SignalRequest): boolean {
  if (request.signal === "fixer") {
    if (!signalsFixer(request.ending)) return false;
    requestDispatch(gh, { event_type: FIXER_NEEDED_WIRE, client_payload: { run_id: request.runId } });
    return true;
  }

  if (!signalsReview(request.ending)) return false;
  const headSha = gh(["pr", "view", request.pr, "--json", "headRefOid", "--jq", ".headRefOid"]).trim();
  requestDispatch(gh, {
    event_type: REVIEW_WANTED_WIRE,
    client_payload: { run_id: request.runId, head_sha: headSha, base_sha: request.baseSha },
  });
  return true;
}

function main(): void {
  const signal = process.env.SIGNAL || "";
  if (!isSignal(signal)) {
    console.error(`signal: ${JSON.stringify(signal)} is not a reader this lane rings`);
    process.exitCode = 1;
    return;
  }

  const ending: RunEnding = {
    eventAction: process.env.EVENT_ACTION || "",
    immutability: process.env.IMMUTABILITY_RESULT || "",
    verify: process.env.VERIFY_RESULT || "",
  };

  const rung = ringReader(execGh, {
    signal,
    ending,
    runId: process.env.GITHUB_RUN_ID || "",
    pr: process.env.PR || "",
    baseSha: process.env.GITHUB_SHA || "",
  });

  console.log(
    rung
      ? `rang the ${signal}`
      : `an \`${ending.eventAction}\` whose immutability ended ${ending.immutability || "unrun"} and verify ${ending.verify || "unrun"} is not the ${signal}'s to read`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(`::error::could not ring the reader: ${reason(err)}`);
    process.exitCode = 1;
  }
}
