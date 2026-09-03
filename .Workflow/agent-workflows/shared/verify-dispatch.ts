import type { GhExec } from "./gh";
import { IMPLEMENTATION_PR_DISPATCH_ACTION } from "./immutable-set";

export const VERIFY_DISPATCH_EVENT_TYPE = IMPLEMENTATION_PR_DISPATCH_ACTION;

export function dispatchVerify(
  gh: GhExec,
  dispatch: { prUrl: string; changedFiles: string[]; criteria: string[] },
): void {
  gh([
    "api",
    "repos/{owner}/{repo}/dispatches",
    "-f",
    `event_type=${VERIFY_DISPATCH_EVENT_TYPE}`,
    "-f",
    `client_payload[pr]=${dispatch.prUrl}`,
    "-f",
    `client_payload[changed_files]=${dispatch.changedFiles.join(",")}`,
    ...dispatch.criteria.flatMap((criterion) => ["-f", `client_payload[criteria][]=${criterion}`]),
  ]);
}
