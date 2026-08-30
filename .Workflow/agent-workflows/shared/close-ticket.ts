import { spawnSync } from "node:child_process";
import { childEnv } from "./child-env.ts";

/**
 * `bin/close-ticket`, as the two lanes that shell to it see it.
 *
 * Both closers in this repo run the same binary and differ only in the argv they hand it: lane 08
 * closes a ticket against the merge that delivered it (`integrate.ts`'s `runRealCloseTicket`), and
 * lane 09 closes a spec against the range its children's merges span (`reconcile.ts`'s
 * `runRealSpecClose`, which passes `--spec`). The spawn itself, and the folding of its two output
 * streams, is one decision — so it is spelled once, here, rather than once per lane.
 *
 * This lives in `shared/` rather than in either lane because a lane importing another lane's module
 * at runtime couples two schedules that have no reason to know about each other. `gh.ts` and
 * `git.ts` are the precedent: a process boundary this estate crosses from more than one place gets
 * a shared seam.
 */

/**
 * What one invocation reports back. `exitCode` is the whole decision — the binary closed the ticket
 * or it did not — and the three ways it declines are one case on purpose: a criterion's `check:`
 * command failed, the body's criteria came back every-one-unverified (#215: zero of any number is
 * not evidence), or the script could not run at all. They differ in cause and not in consequence,
 * and nothing downstream branches on the cause, so nothing downstream is offered it.
 */
export interface CloseTicketResult {
  exitCode: number;
  /** Everything the invocation said, stdout and stderr folded together. Quoted back onto the ticket when it refuses — that text names the criterion that did not check out, and nobody is watching this run's log. */
  output: string;
}

/**
 * Runs `bin/close-ticket` with `args` and folds the result into `CloseTicketResult`.
 *
 * `spawnSync` rather than `execFileSync`: the refusal path needs the output, and `execFileSync`
 * splits it across a thrown `Error`'s message and a `stdout` field. `close-ticket` writes its
 * verdict to stderr and its record to stdout, so both halves are folded together here.
 *
 * `childEnv()` because `GIT_DIR` beats a cwd, and this runs downstream of hooks that export it.
 */
export function closeTicketProcess(args: readonly string[]): CloseTicketResult {
  const result = spawnSync("bin/close-ticket", [...args], {
    encoding: "utf8",
    env: childEnv(),
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? result.error.message : ""}`;
  // A spawn that never ran has a null status; it did not close the ticket, which is all the
  // caller decides on (see `CloseTicketResult`).
  return { exitCode: result.status ?? 1, output };
}
