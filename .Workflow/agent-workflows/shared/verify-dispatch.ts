import type { GhExec } from "./gh";
import { IMPLEMENTATION_PR_DISPATCH_ACTION } from "./immutable-set";

/**
 * The `repository_dispatch` action an implementation pull request's verification fires on
 * (ADR-0054: "an implementation PR's checks fire by repository_dispatch"), and the one function
 * that sends it.
 *
 * In `shared/` rather than `implement/` because it has four senders across four lanes — the
 * implementer (`implement/implement.ts`), the fixer (`fixer/fixer.ts`), the recoverer (through
 * `landAnswer`) and the ratifier (`ratify/land.ts`) — and three receivers (`verify.yml`'s
 * Immutability and Restore-and-run-acceptance jobs, and `integrate.yml`). `shared/` is the only
 * place all of them can reach without a lane importing a lane. Declaring the wire name twice is
 * what left both of `verify.yml`'s jobs unreachable until #145's seam audit, which is why this is
 * an alias of `IMMUTABLE_SET`'s own constant and not a second string.
 */
export const VERIFY_DISPATCH_EVENT_TYPE = IMPLEMENTATION_PR_DISPATCH_ACTION;

/**
 * Sends exactly one `VERIFY_DISPATCH_EVENT_TYPE` dispatch naming a pull request that already
 * exists — the implementer's, just opened, or the fixer's, just pushed to (a fix it pushes is a
 * new head nothing re-judges unless this is sent; PR #280 sat green-by-the-fixer and unmerged on
 * 2026-08-30 for exactly that reason).
 *
 * The payload carries three fields because trunk's `verify.yml` reads three: `pr` for lane 08 to
 * merge, `changed_files` for the Immutability job, and `criteria` for the
 * Restore-and-run-acceptance job. It carried only `pr` until #145's seam audit, which meant that
 * even once the action names were reconciled, Immutability would have refused every PR on a
 * missing file list and the acceptance job would have found no test to run. A dispatch that
 * satisfies its receivers is the whole point of sending one.
 *
 * `changed_files` is comma-joined rather than sent as an array because the Immutability job is
 * deliberately a shell string-compare with no checkout and no Node (`verify.yml`), and it splits
 * on `,`. `criteria` is sent as a real array — `gh api`'s `key[]=` repetition — because that job
 * reads it through `toJson()` and parses it as JSON.
 */
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
