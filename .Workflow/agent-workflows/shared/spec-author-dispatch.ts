import { requestDispatch } from "./dispatch-request";
import type { GhExec } from "./gh";

/**
 * The `repository_dispatch` action `shape/accept.ts` sends after it posts the accept comment.
 *
 * A dispatch and not the `approved` label, which is what ADR-0058's trigger table originally said:
 * the sheet collector reads the accept payload out of that comment and throws without it, so a
 * lane 02 firing on the same label would race the write it depends on ([ADR-0083](../../../docs/adr/0083-the-accept-dispatches-lane-02-rather-than-lane-02-firing-on.md)).
 *
 * **`.github/workflows/spec.yml` no longer listens for it.** #263 moved the cold door onto the
 * `to-spec` label, applied by hand to the accepted idea the same way ADR-0059 already had the
 * owner apply it to a closed map — the label is the durable trace ADR-0083's race concern needed,
 * arriving instead as a second, later click rather than as a dispatch this accept sends itself.
 * `accept.test.ts` still pins that `shape/accept.ts` sends this dispatch; nothing downstream reads
 * it, which is a known gap left for the ticket that retires the send itself.
 *
 * In `shared/` because the sender is lane 01 and the name belongs to lane 02: the one place both
 * can read it without either importing the other.
 */
export const SPEC_AUTHOR_DISPATCH_EVENT_TYPE = "sheet-accepted";

/**
 * Sends it, naming the accepted idea the sheet collector will read.
 *
 * `client_payload[issue]` matches what `applyGate` and `dispatchReadySlices` send, so every
 * issue-scoped dispatch in this pipeline carries its subject under one key.
 */
export function dispatchSpecAuthor(gh: GhExec, issueNumber: number): void {
  requestDispatch(gh, {
    event_type: SPEC_AUTHOR_DISPATCH_EVENT_TYPE,
    client_payload: { issue: issueNumber },
  });
}
