# One gate per rule: the workstation close hook stands down where the repo ships a tracker-side gate

Recorded 2026-08-25.

Status: superseded by ADR-0088

Lane 09 moved the close gate to `issues.closed` but left era 6's machine-global
`~/.claude/hooks/close-gate.py` wired in `~/.claude/settings.json`, so one rule had two
enforcers. They had already drifted when #55's drill found them: the tracker gate judges only a
`completed` close, because a `not planned` one claims no delivery ([ADR-0013](0013-the-close-gate-judges-only-a-close-marked-completed.md)), and nothing in
592 lines of the hook has ever known that a close carries a reason at all. The hook now stands
down in any repo whose working tree contains `.github/workflows/close-gate.yml`, and judges every
other repo exactly as before.

## Considered options

- **Retire the hook entirely.** Cleanest if the tracker is meant to be the only venue, but the
  hook is machine-global: every repo with no tracker gate would lose its close guard the same
  afternoon, for a reason recorded only here.
- **Teach the hook the `not planned` rule.** Fixes the one drift found and leaves the structural
  problem — two copies of a grammar that must agree, with no compiler between them — in place to
  drift again.

## Consequences

The stand-down is a deliberate fail-open, so it is read off the working tree rather than the
remote: a hook that asked GitHub would fail open on every network hiccup, which is the one shape
this gate must not have. A close aimed elsewhere with `-R` is still judged locally, since the tree
under `cwd` says nothing about the gate that repo ships. Adding `close-gate.yml` to a repo now
silently disables the local gate there — intended, and the reason the stand-down logs a
`tracker-gate-owns-repo` row instead of passing silently, so it stays countable the way
`DESIGN.md` §6 asks of anything claiming to catch something.

