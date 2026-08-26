# Ticket format

The one shape a ticket body takes in this pipeline, read by every producer (`/triage`,
`/to-tickets`, `/wayfinder`) and parsed by the close gate (`~/.claude/hooks/close-gate.py`).
Producers reference this doc rather than restate it — a restated copy is exactly what let
`/wayfinder`'s template drift out of sync with the parser it feeds (#57).

Seeded here in `docs/agents/`, not beside the gate like the closing-record grammar
(`~/.claude/hooks/CHECKER-PROMPT.md`) — see
ADR-0017, recorded in `collod873/agent-skills`, for why the two calls differ.

## The core, gate-parsed

Every ticket body carries two headings. `count_body_criteria`
(`~/.claude/hooks/close-gate.py`) parses the first mechanically to decide whether a ticket can
close; `/drain`'s frontier filter and `/triage`'s collision check both read the second.

### `## Acceptance criteria`

One `- [ ]` item per checkable claim about the finished work, written before the work starts — see
`collod873/agent-skills`' `CONTEXT.md`, "Acceptance criterion" entry, for why. Each item must be verifiable
by a fresh context that has not seen the diff: a `path:line`, a command's exit status, an artifact
that exists. A `path:line` needs a `/` or `.` somewhere in the path (`bin/file-issue:12`,
`f.py:1`) — a bare word before the colon (`foo:12`) isn't shaped like a repo path and doesn't
count as evidence, in `bin/ticket_shape.py`'s validator or the close gate.

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

A ticket missing this heading entirely means triage never ran on it.

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
- [ ] Criterion 2

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

No `## Files claimed`. Decisions arrive labelled `wayfinder:*`, so `/triage`'s skip-branch
(sub-issues of a `prd`-labelled spec) doesn't apply, but nothing else runs `/triage` on them either
— they arrive with criteria already written by the wayfinder session that created them — so no file
claim is ever computed or written for one.

```markdown
## Question

<the decision or investigation this ticket resolves>

## Acceptance criteria

- [ ] <one checkable claim per item, written before the work — what proves this ticket is resolved>
```

Those two headings are a minimum, not a maximum — a ticket may also carry the evidence that makes
its question answerable (a reproduction, a table, links), just never the answer itself.

### Question (file-issue question / triage no-branch)

Filed by `~/bin/file-issue question` (#83) and written by `/triage`'s no-branch — an issue
undecided enough that no criteria can be written yet. Both land on the same shape, so a
human-filed question and a triage-stamped one are indistinguishable downstream. Labelled
`fuzzy`. The trailing line naming `file-issue ticketify` is required, not decorative — it's how
a reader learns the way out of `fuzzy` from the issue itself, without consulting any skill.

```markdown
## Question

<the open question — what's undecided, and what would resolve it>

Run `file-issue ticketify <n>` once this is decided, to write its acceptance criteria and
rejoin the pipeline.
```

### Triage's appended headings

`/triage` doesn't author a ticket body from scratch — its yes-branch fetches whatever issue arrived
and appends these two headings to it, verbatim:

```markdown
## Acceptance criteria

- [ ] <one checkable claim, verifiable by a fresh context that has not seen the diff>

## Files claimed

- <a repo-relative path or glob, or the sentinel `- None — no files.` if the ticket touches no files>
```
