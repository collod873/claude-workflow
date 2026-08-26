# The installer derives every list it acts on and overwrites only what it generated

Recorded 2026-08-26.

Installing the pipeline into a second repo is one command. It **derives** every list it acts on from
the state of this repo and the target — never from a list written inside the script — and it writes
only paths it wholly owns, overwriting them unconditionally and reporting what it overwrote.

Ruled by the owner 2026-08-26, with [#82](https://github.com/collod873/claude-workflow/issues/82).

## The trap is one level up from where the ticket looked for it

[#82](https://github.com/collod873/claude-workflow/issues/82) proposed *"an installer, not a
manifest"* on the grounds that the list of what carries over *is* what the script copies, so it
cannot drift. That is true of the **files**. It is not true of the **script**.

**A script that enumerates what to copy is a manifest with a shebang on it.** Add a lane, forget the
script, and it installs an incomplete system in silence — the same drift, now executable and in a
file nobody thinks to audit, because it looks like code rather than like `UPSTREAM.md`. `GOAL.md`
C4's test is *does this need maintenance to stay true* — and it has to be applied to the installer,
not only to what the installer installs.

So derivation is a **constraint on the ruling**, not an implementation note:

| What | Derived from |
|---|---|
| Which stubs to write | globbing this repo's reusable workflows |
| Which labels to create | this repo's own label set |
| Which files to copy | one marked directory in this repo |
| The check contract | probing the **target** repo (ADR-0056) |

Nothing it does may be a list a human keeps current. A lane added here appears in a target on the
next run because the glob found it, not because someone remembered.

## The scope, along the venue seam

[ADR-0055](0055-a-lane-ships-as-a-reusable-workflow-and-a-second-repo-carrie.md) splits the machine
exactly where `DESIGN.md` §06 already draws its line, and the split is what makes the scope
enumerable rather than negotiable.

**Copies — the free venues.** They run on the workstation with no Actions involved, so there is
nothing to phone. Once the gauntlet is contract-driven (ADR-0056) these are small and
language-agnostic: the same bytes in a Python repo as here.

- `bin/gauntlet`, `bin/node-on-path.sh`
- `.claude/hooks/gauntlet.sh` and its hook entry point
- `.husky/pre-push` — Node targets only, where `"prepare": "husky"` already self-installs it
- `docs/agents/` — convention text with one per-repo variable, the repo name, read from
  `git remote`

**Calls — the paid venues.** One stub per lane the target takes. Six lines, no content.

**Generates.** `.claude/contract.json`, by probing.

**Wires — scriptable, but not a file copy.** The target's labels; `CLAUDE_CODE_OAUTH_TOKEN`;
ADR-0055's read-only PAT; `.github/ISSUE_TEMPLATE/`. One-time and here rather than there: this
repo's Actions setting permitting its reusable workflows to be called by repos the owner owns.

**Refuses.** Everything already distributed by a mechanism that works:

- **Skills and cross-repo tooling.** `~/.claude/skills/*` symlinks to `~/.agents/skills/*`, and
  `~/bin/file-issue` to `~/.agents/skills/bin/file-issue`. The verbs are already installed once,
  estate-wide, with no manifest and no per-repo copy. This is the precedent the whole ruling stands
  on, and duplicating it would be the second copy of a solved problem.
- **Session capture.** Global since
  [ADR-0018](0018-capture-runs-globally-the-auditor-and-the-release-run-in-thi.md); carries nothing.
- **`.Workflow/agent-workflows/`.** Never copied — ADR-0055.
- **This repo's own record** — `docs/adr/`, `CONTEXT.md`, `DESIGN.md`, `GOAL.md`. The machine's
  design is not part of the machine.

## Divergence on re-run

**The installer owns a set of paths, overwrites them unconditionally, never merges, and reports what
it changed. It writes nothing outside that set.**

Generation is what makes this safe rather than reckless: everything it writes, it can rewrite from
source, so there is no local content to preserve and no merge to get wrong. A hand edit to an owned
file is unsupported — the same contract `.husky/pre-push` already has in this repo, where husky
regenerates the hook and nobody expects otherwise. Reporting rather than acting silently is this
repo's standing habit: the gauntlet announces an over-budget venue and keeps running, and lane 09's
reconciler comments *why* rather than reopening without a word.

`.claude/settings.json` is the one file a target may legitimately share, so the installer owns
**entries** rather than the file: it replaces the hook entries whose command path is one of its own
and leaves every other entry untouched. That is a match on a derived path, not a list of entries to
preserve.

## Where it lives

In `bin/` here, run from this clone against a target path. No new distribution mechanism is
introduced, because the operator has this repo checked out by construction and a caller repo needs
nothing from it at runtime but the reusable workflows.

Symlinking it into `~/.agents/skills/bin/` alongside `file-issue` and `publish-issue-graph` is the
obvious later move and is deliberately not taken now: it puts a file this map owns into a repo this
map does not, ahead of any evidence that running it from a clone is inconvenient.

## Consequences

**Partial installation needs no mechanism.** A repo's lanes are whichever stubs it has, so
`DESIGN.md` §11 question 1's standing recommendation — *"the gauntlet and the cross-repo counter
only"* — is a shorter argument list rather than a mode, a flag, or a supported configuration to
test.

**A lane whose stub the target lacks is invisible, not broken.** There is no partial-install state
to detect and no reconciliation between what a repo has and what it could have. If that turns out to
matter, the thing that answers it is the cross-repo counter, which is already the design's answer to
drift between repos.

**Re-running is the update path**, so there is no version, no upgrade command and nothing to migrate
— consistent with ADR-0055's `@main`, where the called half updates itself and only the copied half
needs the re-run at all.

## What would reverse this

A target repo that needs a genuinely different free-venue setup — not a different command, which the
contract already carries, but a different *shape* of hook. That would mean the copied half is not
actually language-agnostic, and the seam is drawn in the wrong place.
