# A run ends by writing what surprised it into the module's CONTEXT.md, or writing nothing

Recorded 2026-08-23.

Every implementer run ends with one question: *what did you learn that, had you known it at the
start, would have changed what you did?* A real answer is appended to the module's `CONTEXT.md`.
Nothing means nothing gets written — the bar is surprise, not diligence.

[ADR-0005](0005-accepting-a-shaped-idea-is-what-files-its-adrs.md) covers rulings made at shaping
time. It does not cover what a run *learns* mid-flight, which is where W6 — write the autopsy while
it still stings — had no home in the design.

## Considered options

- **`docs/findings/`** — rejected. A new directory with no reader is an inbox, and Lumaria already
  proved an inbox with no consumer decays.
- **An ADR per surprise** — rejected. An ADR is a ruling and needs the owner's signature
  ([ADR-0006](0006-agents-draft-vocabulary-and-rulings-the-owner-signs-them.md)). A surprise is an
  observation, and routing observations through the owner is the queue-filling C7 caps.
- **The module's `CONTEXT.md`** — chosen. It is already in the implementer's brief, so it is read by
  construction rather than by hope, and it sits next to the code it describes (W4).

## Consequences

An observation that hardens into a rule crosses into ADR-0006's territory and gets signed there;
until then it is just something the next run knows.

This also makes `DESIGN.md`'s open question 7 answerable. Asking whether an unread document was ever
loaded into a context where it changed an outcome requires a document with a defined load event —
`CONTEXT.md` has one, a `docs/findings/` file would not.
