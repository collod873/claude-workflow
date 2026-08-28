# Ticket format

The one shape a ticket body takes in this pipeline, read by every producer (`/to-tickets`,
`/wayfinder`, `~/bin/file-issue`) and parsed by the close gate (`close-gate.py` — the machine-global hook, or the repo's own
`.claude/hooks/` copy where it ships one; the same file either way).
Producers reference this doc rather than restate it — a restated copy is exactly what let
`/wayfinder`'s template drift out of sync with the parser it feeds (#57).

Seeded here in `docs/agents/`, not beside the gate like the closing-record grammar
(`close-gate.py`) — see
ADR-0017, recorded in `collod873/agent-skills`, for why the two calls differ.

## The core, gate-parsed

Every ticket body carries two headings. `count_body_criteria`
(`close-gate.py`) parses the first mechanically to decide whether a ticket can
close; `/drain`'s frontier filter and `file-issue ticketify`'s collision check both read the
second.

### `## Acceptance criteria`

One `- [ ]` item per checkable claim about the finished work, written before the work starts — see
`collod873/agent-skills`' `CONTEXT.md`, "Acceptance criterion" entry, for why. Each item must be verifiable
by a fresh context that has not seen the diff: a `path:line`, a command's exit status, an artifact
that exists. A `path:line` needs a `/` or `.` somewhere in the path (`src/router:12`,
`f.py:1`) — a bare word before the colon (`foo:12`) isn't shaped like a repo path and doesn't
count as evidence, in `bin/ticket_shape.py`'s validator or the close gate.

A criterion may end with a trailing check marker: an em dash, the label `check:`, and a single
backtick-quoted command naming the one thing that verifies it — so a mechanical closer can run
that command itself instead of re-deriving what to check from prose:

```markdown
- [ ] `bin/lint` reports zero findings on this file — check: `bin/lint path/to/file`
```

The delimiter is the same alternation (an em dash, an en dash, or a space-delimited single/double
hyphen) the closing-record grammar (`close-gate.py`) uses for its own trailing verdict slot
— `bin/ticket_shape.py`'s `CHECK_MARKER_DELIM` is that shared alternation — so an author never
learns two different dash rules for two different trailing markers. Writing one is optional: a
criterion nobody can mechanise is still a legitimate criterion; it simply closes on a human
reading the diff rather than a command's exit status. A marker that's attempted but doesn't
parse — a missing command, or prose trailing the closing backtick — is warned about by
`bin/ticket_shape.py`'s validator rather than silently read as plain prose.

A ticket whose deliverable is a **migration** — a history rewrite, a schema backfill, a one-off
scrub — is worded as **the run**, never as the artifact. "Ship a script that scrubs X" is satisfied
the moment the file exists; "Scrub X" isn't. At least one criterion must assert the **post-state of
what is being migrated**, checkable against the real target rather than against a fixture the
ticket's own test builds — `git rev-list --all --objects | grep -c <path>` prints 0, not `npm test
-- scrub.test.ts` exits 0. A suite passing proves the script works; it never proves the script ran,
and spec #134 closed COMPLETED over two migrations nobody had run because every criterion beneath
it was the former. `bin/ticket_shape.py` warns — never refuses — when a migration-shaped body's
every criterion is satisfied by a test passing or by a path the ticket itself claims. See ADR-0076,
recorded in `collod873/claude-workflow`.

```markdown
## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
```

### `## Files claimed`

The repo-relative paths (globs permitted) this ticket expects to touch, biased coarse — see
`CONTEXT.md`'s "Files claimed" entry and ADR-0007, both in `collod873/agent-skills`,
for why the claim exists at all. A ticket that touches no files writes the sentinel, never an empty
or missing section:

```markdown
## Files claimed

- None — no files.
```

A ticket missing this heading entirely was never shaped by a producer that computes claims —
`file-issue ticket` and `file-issue ticketify` both refuse a body without one.

## Variants

Each producer's body is the core above plus its own framing. These are complete, verbatim
examples — `test_ticket_templates.py` feeds each one through `count_body_criteria` as a test
case, so a producer whose actual output drifts from what's below fails a test rather than a denied
close.

### Spec sub-issue (`/to-tickets`, real tracker)

Published one per ticket. On GitHub, via `~/bin/publish-issue-graph` — the helper injects the
`Part of #<parent>` breadcrumb and the `## Parent` / `## Blocked by` sections below are omitted
there, carried instead by native sub-issue and dependency edges. On a tracker without a graph
helper, both sections stay in the body.

```markdown
## Parent

A reference to the parent issue on the tracker (if the source was an existing issue, otherwise omit this section).

## What to build

The end-to-end behaviour this ticket makes work, from the user's perspective — not layer-by-layer implementation.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2 — check: `<command that verifies this>`

## Files claimed

- The repo-relative paths (globs permitted) this ticket expects to touch — a ticket that touches no files writes `- None — no files.`

## Blocked by

- A reference to each blocking ticket, or "None — can start immediately".
```

### Local-file ticket (`/to-tickets`, local tracker)

One ticket per file under `.scratch/<feature-slug>/issues/<NN>-<slug>.md`. One body shape on every
tracker (#57) — only the edge encoding differs: a local ticket names its blockers by number/title
directly in prose instead of a native dependency link.

```markdown
# <NN> — <Ticket title>

**What to build:** the end-to-end behaviour this ticket makes work, from the user's perspective — not a layer-by-layer implementation list.

**Blocked by:** the numbers/titles of the tickets that gate this one, or "None — can start immediately".

**Files claimed:**

- The repo-relative paths (globs permitted) this ticket expects to touch, or `- None — no files.`

## Acceptance criteria

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
```

### Wayfinder decision

No `## Files claimed`. Decisions arrive labelled `wayfinder:*`, with criteria already written by
the wayfinder session that created them, and nothing downstream computes a claim for one — so no
file claim is ever computed or written for a decision.

```markdown
## Question

<the decision or investigation this ticket resolves>

## Acceptance criteria

- [ ] <one checkable claim per item, written before the work — what proves this ticket is resolved>
```

Those two headings are a minimum, not a maximum — a ticket may also carry the evidence that makes
its question answerable (a reproduction, a table, links), just never the answer itself.

### Question (file-issue question)

Filed by `~/bin/file-issue question` (#83) — an issue undecided enough that no criteria can be
written yet. Labelled `fuzzy`. The trailing line naming `file-issue ticketify` is required, not
decorative — it's how a reader learns the way out of `fuzzy` from the issue itself, without
consulting any skill.

```markdown
## Question

<the open question — what's undecided, and what would resolve it>

Run `file-issue ticketify <n>` once this is decided, to write its acceptance criteria and
rejoin the pipeline.
```
