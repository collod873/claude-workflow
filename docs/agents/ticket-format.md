# Ticket format

The shape every ticket body takes, whoever writes it: `/to-tickets`, `/wayfinder`, or a session
filing with `~/bin/file-issue`. The rules machines enforce are spelled once, in
`.Workflow/agent-workflows/shared/ticket-shape.rules.json` and `bin/ticket_shape.py`
(claude-workflow/ADR-0184); this page is the author's reading of them. A spec's shape is
`docs/agents/spec-format.md`.

## Refused and held

`file-issue` **refuses** a body it can judge alone (a missing heading, a glob or more than
`claimLimit` paths in the claim, a check that reads the tracker) and files nothing: fix it.

It **holds** a body when only the author can judge: fix it, or re-run with
`--ack "<why this stands>"`, which files it and records the reason and every warning under
`## Warnings acknowledged`, where the next reader meets them.

```bash
~/bin/file-issue ticket --title "..." --body-file body.md \
  --ack "scoping ticket; the post-state criterion lands once the target repo is enrolled"
```

One warning never holds a filing: a claimed path the tree lacks and nothing in it resembles, which
is what a file the ticket creates looks like. A claimed path with a near neighbour holds it, since
that is what a typo looks like.

## `## Acceptance criteria`

One `- [ ]` item per claim about the finished work, written before the work starts. The acceptance
author turns each into a test without seeing the diff, and `bin/close-ticket` closes the ticket by
running each item's check. Every criterion is:

- **Red today.** It names what this ticket's work makes true, so its check fails before the work
  exists. What must stay true ("X is unchanged") belongs to the tests that already hold it.
  `file-issue` runs each check at filing and holds a ticket whose check already passes, skipping a
  command that names a path the ticket claims or hands over with `--test`.
- **Checked by one command.** It ends in a check marker: a space-delimited hyphen, `check:`, and one
  backtick-quoted command, with nothing after it.

  ```markdown
  - [ ] `bin/lint` reports zero findings - check: `bin/lint`
  ```

  The command is the narrowest one that fails before the work and passes after it: the test file
  proving this claim, or a `grep` against the checkout. It runs exactly as written, so it takes only
  arguments the tool honours (`bin/lint` lints the whole tree whatever it is handed). `/drain` skips a
  ticket carrying an item without a marker, and `close-ticket` records that item `UNVERIFIED` and
  closes nothing when every item is. `file-issue` holds a missing or unparseable marker.
- **Narrow.** The gate runs every check `.claude/contract.json` names on every change, so
  `npm run check`, `npm test` and their kin prove nothing this diff turned from red to green.
  `file-issue` holds them.
- **Read from the checkout.** `gh`, `curl` and `wget` read GitHub or the network and answer the same
  whether or not the diff exists, so `file-issue` and the slicer's publisher both refuse them. A
  command may read an absolute path elsewhere on the machine when the artifact under test lives
  there. A fact about production belongs to a spec's one criterion.
- **Parsed by `/bin/sh`.** `bin/close-ticket` runs every check with `shell=True`, which is dash on the
  workstation and on every Ubuntu runner. Wrap a bash-only command (process substitution, arrays)
  in `bash -c '...'`:

  ```markdown
  - [ ] the two sets share no member - check: `bash -c '! comm -12 <(sort a) <(sort b)'`
  ```

A ticket whose deliverable is a **migration** (a history rewrite, a schema backfill, a one-off
scrub) is worded as the run: "Scrub X", which only the scrub satisfies, where "Ship a script that
scrubs X" is satisfied the moment the file exists. At least one criterion asserts the post-state of
the real target, such as `git rev-list --all --objects` no longer listing the path: a suite passing
proves the script works, and only the post-state proves it ran. `file-issue` holds a
migration-shaped body whose every criterion is a test passing or a path it claims
(claude-workflow/ADR-0076).

## `## Files claimed`

Each file this ticket edits, one per line, spelled in full from the repository root:
`src/router/index.ts`. The acceptance author and the implementer read the ticket independently and
cannot ask each other, so a shortened path is one decision answered twice; the rest of the body
abbreviates only a path this section spells in full (claude-workflow/ADR-0118). A ticket that edits
no files writes the sentinel:

```markdown
## Files claimed

- None, no files.
```

- **One file per line.** A glob is refused: the reconciler holds each claim against every live run,
  so a pattern standing for a whole lane stalls that lane.
- **At most `claimLimit` paths**, refused above it. The implementer's brief inlines every claimed file
  into one prompt inside one wall-clock budget, and #539's nine files spent that whole budget on the
  first pass. Wider work is several tickets: slice it by subject and chain them. A ticket that
  reaches `reconcile.ts`'s `to-build` door wider than that is labelled `to-spec`, and lane 02 rewrites
  it as a spec under the same number.
- **The immutable set** (`vitest.config.ts` and paths under `.github/`, listed in
  `.Workflow/agent-workflows/shared/immutable-set.json`) is work no pull request may land.
  `file-issue` labels a ticket claiming it `by-hand` beside `ticket`, as it does a workstation or
  cross-repo claim; the `to-build` door stands it down, and `session-brief` hands it to the next
  session. Work needing both kinds is two tickets.

Two tickets claiming the same file collide only while one of them has a live run: a file is held
by a live run, never by a ticket (ADR-0199). Each `reconcile.ts` pass skips a ready ticket whose
claim overlaps a live run's, or that of a ticket it dispatched earlier in the pass, logs both numbers
and the path, and starts it on the pass after that run ends. A collision is never a `blockedBy` edge.

## Variants

Each producer's body is the core above plus its own framing. Every example below runs through the
real validator as a test case, so an example that drifts from the rules fails a test.

### Spec sub-issue (`/to-tickets`)

Published one per ticket. On GitHub the parent and blockers are native sub-issue and dependency
edges, so `~/bin/publish-issue-graph` omits `## Parent` and `## Blocked by` and adds a
`Part of #<parent>` line; a tracker without native edges keeps both sections.

```markdown
## Parent

#<parent issue>

## What to build

The end-to-end behaviour this ticket makes work, from the user's side, not layer by layer.

## Acceptance criteria

- [ ] <what is observably true once the work lands> - check: `<the narrowest command that fails today>`

## Files claimed

- <each file this ticket edits, in full from the repository root>

## Blocked by

- <each blocking ticket, or: None, can start immediately.>
```

### Wayfinder decision

A child issue of a Wayfinder map, labelled `wayfinder:<type>`. It carries no `## Files claimed`,
since nothing downstream builds from it; `.claude/skills/wayfinder/SKILL.md` owns the rest of its
shape.

```markdown
## Question

<the decision or investigation this ticket resolves>

## Acceptance criteria

- [ ] <one checkable claim per item, written before the work: what proves this ticket is resolved>
```

### Question (file-issue question)

An issue too undecided for criteria yet, labelled `fuzzy`. `file-issue question` appends the line
naming its way out when the body lacks it.

```markdown
## Question

<the open question: what's undecided, and what would resolve it>

Run `file-issue ticketify <n>` once this is decided, to write its acceptance criteria and
rejoin the pipeline.
```
