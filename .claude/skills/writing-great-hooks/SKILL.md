---
name: writing-great-hooks
description: Author, change, or audit a Claude Code hook. Use when writing a hook, debugging one that misbehaves, or judging whether a repo's hooks hold.
---

# Writing great hooks

A `CLAUDE.md` line is a request the model may ignore. A hook is code the harness *runs*: same event,
same way, every session. That is the whole reason hooks exist, and every rule below protects it.

**This file restates nothing a check holds.** Where a rule is enforced, it names the enforcement and
stops. A rule written here that a check could hold is a second copy, and a second copy is how the
version of this skill you are reading replaced one that taught five disproved claims.

## Measured, not read

The official hooks reference is wrong in 15 places measured against the live product. Every claim
about how the harness treats a hook comes from Hookkit's corpus, 436 claims driven against Claude
Code 2.1.274, at `~/Claude Projects/Hookkit`:

| want | read |
|---|---|
| what an event can say, and which events are refused | `docs/verdict.md` |
| where the official docs are wrong | `docs/measured.md` |
| the evidence behind one claim | `layer1/verdicts/*.jsonl`, transcripts in `layer1/runs/<case>/` |

Grep the corpus before saying a claim is not in it. If it genuinely is not there, measure it before
building on it. Cite the verdict id in the check label that fails when the claim stops holding, never
in a comment: a comment cannot fail when it goes stale, which is how the docs got wrong.

## Pick the event, then the rung

The rung is the most power an event's exit can reach: react < inject < steer < halt < gate. Choosing
a rung the event does not offer is the first design error, and the only one that cannot be fixed
later without moving the hook.

| want | event | rung |
|---|---|---|
| the action never happens, or happens rewritten | `PreToolUse`, `PermissionRequest` | gate |
| the prompt never reaches Claude | `UserPromptSubmit` | gate |
| the turn does not end until a check passes | `Stop` | steer |
| react to what a tool did, and tell Claude why it was wrong | `PostToolUse` | steer |
| feed Claude text at the start of a session | `SessionStart` | inject |
| log, notify, format | any tier 1 or tier 2 event, `async` | react |

`docs/verdict.md` holds the full table, the tier 2 events that can only add context, and the four
that Hookkit refuses outright because nothing they say is heard. Under Hookkit's wrapper you cannot
get this wrong: `hookkit.hook()` raises at import on a refused event or a rung above the ceiling,
naming both. Workflow's hooks have no such wrapper, so there the table above is the only copy.

## Where the hook goes, and what holds it

| writing a hook for | build it with | what fails when you break it |
|---|---|---|
| the global hooks (fire in every repo) | `_hook.py`, in `Claude Projects/Workflow/.claude/hooks/` | `hook-gate.py` blocks the edit until `test_<hook>.py` is green, and blocks outright when that suite does not exist |
| anywhere else | `hookkit.py` | `hookcheck.py`: registration drift, failure mode, process leaks, keyword collisions, `Stop` hand-back |

The global hooks are one dispatcher, not a folder of scripts: every event in `~/.claude/settings.json`
calls `dispatch.py`. Edits go to `Claude Projects/Workflow`; `~/.agents/workflow` is a read-only clone
that `clone-refresh` fetches, so a change is not live until it does.

Never hand-build a wire envelope or a length bound. `_hook.py` owns both envelopes and `SAY_LITTLE`;
the dispatcher applies 200 characters to what reaches Claude and 2,000 to what reaches the screen,
spilling the rest to a log it names. A third copy is what `duplicated-code/deny-envelope` exists to
reject.

## What no check decides for you

Three judgments, in the order they bite:

1. **Does it earn its place?** A hook that duplicates a permission `deny` rule or a check the gauntlet
   already runs costs a fire per turn and guarantees nothing new. A permission rule is the lock; the
   hook is defense in depth.
2. **Safety or convenience?** This is the `kind` you declare, and it fixes the failure mode: safety
   fails closed and names a permission rule that backs it, convenience fails open so a broken hook
   never wedges the session. `hookcheck` holds you to whichever you declare by driving a crash, an
   overrun and malformed stdin at it. Declaring the wrong one is the part it cannot catch.
3. **Whose screen is it?** A refusal reaching Claude and a refusal reaching the human are different
   channels, and `systemMessage` reaches no model request at all
   (`json.systemMessage-visible-to-claude`). Say it once per audience: a block that also sets
   `systemMessage` tells the human twice, and `hookcheck` fails it.

## You cannot verify Collin's screen

Nothing in a session can read the terminal. A hook's screen output reaches no model request, so
**no claim about what appeared there is ever yours to make.** Firing a hook in a throwaway repo and
printing the string proves the string, not that it arrived; pasting it back and calling it live is a
fabricated verification and is worse than saying nothing.

Arrange the real fire in the session he is watching, say in one line what to look for, and stop.

## Prove the check can fail

A check that has never failed has not been shown to work. Plant defects and confirm each is caught:
`hookcheck.py --selftest` grades itself that way, and Hookkit's `mutate_*.py` do it for the
dispatcher, the edit gate and the stop gate. Rerun the matching one whenever you touch what it
covers. Two of Hookkit's own checks passed a first mutation pass only because their fixtures had
nothing to find, so silence proved nothing.

## Known blind spots

- **A file written by Bash bypasses every edit hook.** `PostToolUse.not-for-bash-file-writes`: an
  Edit/Write hook does not fire for a file a Bash command wrote. Ruled and filed 2026-09-17; closing
  it costs either shell parsing on `PreToolUse` or a fingerprint of every hook file per turn.
- **A `Stop` gate fires on every turn end**, including Claude asking you a question, and before
  delegated work finishes. Read `background_tasks` and defer while it is non-empty.
- **An explicitly configured `timeout` shorter than the hook fails open, silently.** Defaults are
  per-event and generous (`timeout.defaults-command-http-mcp`); there is no general guillotine. The
  exposure is a `timeout` you set yourself.

## Worked example

Copy `credential-scan.py` and `test_credential_scan.py`, the pair that carries the shape a guard
needs: it gates on `_hook.new_content`, so one reader covers Write, Edit and MultiEdit rather than
each tool growing its own branch; it names its own file and its test in `EXEMPT_NAMES`, because a
guard that reads content reads the content of the tests that exercise it; and its cases run through
`_harness.run_hook` against a checked-in baseline, so a verdict changing is a diff rather than a
judgement call. Drive a guard through the harness, never by piping a payload in by hand: a hook that
scans what you are writing scans the test payload you are writing, and self-triggers. Build a
fixture secret by concatenation (`"AKIA" + "..."`) in any file the guard is not exempt from.
