import { appendFileSync } from "node:fs";
import type { GhExec } from "./gh";

/**
 * **The token that spends a model and the token that starts the next lane are not the same token.**
 *
 * `POST /repos/{owner}/{repo}/dispatches` needs the Contents **write** permission. A
 * `permissions:` block *replaces* the default token rather than adding to it, so a job declaring
 * `contents: read` cannot send a dispatch at all — it 403s. Lane 02 and lane 03 both declared
 * `contents: read` and both ended by sending one, so both hand-offs of the intended run failed
 * silently, each after reporting a successful publish, because the dispatch is the last thing they
 * do ([#181](https://github.com/collod873/claude-workflow/issues/181)).
 *
 * Widening those two jobs to `contents: write` is one line and it is the wrong line: it hands a job
 * that runs a model the ability to push to the repository, which is exactly what
 * [ADR-0053](../../../docs/adr/0053-the-acceptance-lane-pushes-to-main-so-the-immutability-rule.md)
 * is careful about. `permissions:` is per **job**, so the fix is a split — the model job keeps
 * `contents: read`, and a second job with `contents: write` and no model in it sends what the first
 * one asked for.
 *
 * This module is the seam that makes the split possible without every sender knowing which side of
 * it they are on. A sender says *what* it wants dispatched; where that goes depends on whether the
 * job it runs in already holds a write token:
 *
 * - `DISPATCH_REQUESTS_PATH` **set** — the caller is inside a model job that cannot send. The
 *   request is appended to that file as one JSON object per line, and the workflow's own dispatch
 *   job posts each line verbatim.
 * - `DISPATCH_REQUESTS_PATH` **unset** — the caller already holds `contents: write`
 *   (`dispatch-reconcile.yml`, `integrate.yml`, `shape-accept.yml`, `implement.yml`), and sending
 *   now is both correct and one fewer moving part. This is the plain-`gh` behaviour every caller
 *   had before the split, unchanged.
 *
 * The variable is set by a workflow, never by a caller, which is what keeps this a fact about the
 * venue rather than a flag a lane can get wrong.
 */

/** One dispatch, shaped as the REST body itself — what a sender asks for and what the sender job posts. */
export interface DispatchRequest {
  event_type: string;
  client_payload: Record<string, string | number>;
}

/**
 * The environment variable a workflow sets in its model job to divert every dispatch that job would
 * otherwise send into a file. Named here so `spec.yml`, `to-tickets.yml` and the tests read one
 * spelling — the class of bug this whole module exists for is two sides of a boundary agreeing on a
 * name by having been typed the same twice.
 */
export const DISPATCH_REQUESTS_PATH_ENV = "DISPATCH_REQUESTS_PATH";

/**
 * The `gh api` argv for one request — the exact form every caller of this module used to build
 * inline, kept identical so the send path is unchanged for the jobs that still take it.
 */
function dispatchArgs(request: DispatchRequest): string[] {
  const args = ["api", "repos/{owner}/{repo}/dispatches", "-f", `event_type=${request.event_type}`];
  for (const [key, value] of Object.entries(request.client_payload)) {
    args.push("-f", `client_payload[${key}]=${value}`);
  }
  return args;
}

/**
 * Sends `request`, or records it for the job that can — see this module's header for which, and
 * why the answer is a property of the venue rather than of the caller.
 *
 * One JSON object per line, because the reader is a shell loop piping each line into
 * `gh api … --input -` and a line is the only framing that needs no parser on that side.
 */
export function requestDispatch(
  gh: GhExec,
  request: DispatchRequest,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const path = env[DISPATCH_REQUESTS_PATH_ENV];
  if (!path) {
    gh(dispatchArgs(request));
    return;
  }

  appendFileSync(path, `${JSON.stringify(request)}\n`, "utf8");
}
