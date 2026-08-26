# Capture runs globally; the auditor and the release run in this repo only

Recorded 2026-08-25.

The `SessionEnd` recorder is registered in `~/.claude/settings.json` and listens in every repo the
owner works in, because the corrections worth reading happen wherever work happens, which is mostly
not this repo. The auditor that reads those captures and the release that publishes what it finds
run here and nowhere else. Ruled in
[#36](https://github.com/collod873/claude-workflow/issues/36) §Solution 1 and §Out of scope, and
ratified by the owner on 2026-08-23.

## Why this does not contradict the estate-wide scope ruling

**Recording is not executing work.** [ADR-0002](0002-work-executes-on-github-hosted-runners-never-on-the-workstat.md)
and the 2026-08-23 "this repo and nothing else" ruling govern where the *pipeline* runs — where
model calls are spent, where PRs are opened, where an agent is allowed to act. A recorder writing
Markdown to disk does none of that: no model, no judgement, no findings, no writes outside its own
corpus directory.

The split is also what makes the corpus worth having. Capture is the only part of #36 with an
irreversible clock on it — `cleanupPeriodDays: 30` means every day without a recorder permanently
destroys a day of transcripts — so it has to be everywhere and it has to ship first. The lens is a
model call that can be tuned, re-pointed and re-run at leisure, but only against a corpus that
already exists.

## Consequences

**This is the seam every later mechanism builds against**, so it will be the first of #36's rulings
someone tries to re-litigate: the natural next thought, once the auditor works here, is to point it
at the whole estate. That is [#36](https://github.com/collod873/claude-workflow/issues/36)'s open
question 3, and it reopens **on its own terms** when lane 05 runs on a runner — not as a quiet
widening of this one.

**A global hook has global blast radius**, which is why the capture side is bound to fail open,
silently, at every step: no transcript path, no transcript file, no `node` or `python3`, unwritable
target — exit 0 and write nothing. A recorder that wedges a session end anywhere in the estate is
worse than the corpus it was protecting.
