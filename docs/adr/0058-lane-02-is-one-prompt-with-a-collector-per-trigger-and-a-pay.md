# Lane 02 is one prompt with a collector per trigger, and a payload is assembled rather than re-derived from a rendering

Recorded 2026-08-26.

There is **one** spec author, one prompt file, and a **collector per trigger** that assembles the
same five-field object before the model runs. The three triggers differ in where decided context
already lives, never in what the author needs, so the difference belongs in the collector and not in
a second prompt.

The object — **Decided context**, `CONTEXT.md`'s new term and `DESIGN.md` §00's existing phrase — is
the owner's words verbatim, the decisions with their reasons, the rulings already filed, the
boundaries, and the guesses still open.

| Trigger | Event | Collector reads |
|---|---|---|
| An accepted sheet | `approved` on an issue carrying `idea` | The idea body verbatim; the latest `decision-sheet:v1` marker; the accept's marker (below) |
| A closed map | `to-spec` on a `wayfinder:dest-spec` map ([ADR-0059](0059-a-closed-map-reaches-lane-02-by-its-to-spec-label-never-by-b.md)) | The map body, then one level down its Decisions-so-far links, preferring the durable record a gist names over its resolution comment |
| The owner, in session | `/to-spec` in a live grill | Nothing. The conversation **is** the decided context |

## The accept's marker has to carry a payload

`marker.ts` exists so that *"nothing re-derives a sheet from its own rendering"*, and the sheet
already travels as `<!-- decision-sheet:v1 {…} -->`. **`ACCEPTED_MARKER` carries no payload**, so the
one thing lane 02 most needs is the one thing only prose holds: §01 requires it to **cite the rulings
rather than restate them**, and the ADR numbers are assigned by `bin/new-adr` at accept time and
appear nowhere in the sheet. A collector would have to parse the accept comment's markdown — the
precise failure the marker was built to prevent, arriving one comment later.

So `ACCEPTED_MARKER` gains the payload `accept.ts` already computes and throws away: the ADR paths it
filed, the terms it coined, and the route it recorded.

## Considered options

- **Three prompts, one per trigger.** Rejected against `DESIGN.md` §06's rule that *a check is
  defined once; the venue chooses only the scope and the failure mode. A check defined twice drifts.*
  Three copies of the two non-negotiables — criteria quote the owner's words, invented intent becomes
  a numbered open question — is three places for one of them to rot.
- **One normaliser stage, spending a model.** Rejected. Every collector above is a fetch and a link
  walk; nothing in it is a judgement. A model would put ADR-0014's forbidden shape at the top of the
  lane, and it would raise §02's cost from 2 Opus stages to 3 for no verdict.
- **Serialise the in-session trigger so a runner can read it back.** Rejected, and this is `DESIGN.md`
  §00's ruling upheld rather than reopened: *"lossy compression that pays double tokens for less
  signal."* Nothing has moved under it. What changes is only that the local door stops being a
  **second implementation** — one prompt file in this repo, two callers, and the local caller passes
  the live conversation where the cloud caller passes the collected payload.

## Consequences

**The map collector is already built and already ruled elsewhere.** `to-spec/SKILL.md` walks an index
today — *"follow it one level: fetch each linked issue… prefer the durable record its gist names
(e.g. an ADR) over its resolution comment"* — under `agent-skills` ADR-0009, which measured the
alternative and found the binding constraint is **double-reading** rather than size: nearly every
`Decisions so far` gist ends by naming an ADR, so zooming the ticket *and* picking the ADR up while
reading the repo costs ~45K tokens for a completed map against ~25K for preferring the durable record.
That preference matters more here than it did there, because
[ADR-0060](0060-the-spec-author-reads-the-repo-through-an-allow-list-and-can.md) gives this author
`Read` and `Grep` over `docs/adr/` and therefore both routes to the same decision.

**`accept.ts` says this ADR's own subject was pending.** *"Move 6 fires on this same `approved`
label, so there is nothing here for it to replace."* The trigger was never open; the payload was.

**The in-session author is not bound by
[ADR-0060](0060-the-spec-author-reads-the-repo-through-an-allow-list-and-can.md)'s allow list**, and
that is the honest statement of what keeps it safe: the cold path is bounded by its toolbelt, the hot
path by the owner sitting in it. One lane, two bindings, written down rather than drifted into.
