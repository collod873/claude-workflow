---
status: constraint
date: 2026-08-25
reversal: Reversing it means either disabling a machine-global `SessionEnd` hook in `~/.claude/settings.json` — after which `cleanupPeriodDays: 30` permanently destroys the transcripts of every repo it stops covering, a day at a time, unrecoverably — or widening the auditor and release past this repo, which `audit.yml` and `capture/repo-scope.ts` are built to prevent.
---

# Capture runs globally; the auditor and the release run in this repo only

The `SessionEnd` recorder is registered in `~/.claude/settings.json` and listens in every repo the owner works in — the corrections worth reading happen wherever work happens, mostly not here. The auditor and the release run in this repo only.

This does not contradict the estate-wide scope ruling: **recording is not work** — no judgement, no writes outside its own corpus directory. Capture is the only part carrying an irreversible clock (`cleanupPeriodDays: 30` destroys a day of transcripts for every day without a recorder), so it ships first and everywhere; the lens can be re-pointed and re-run at leisure against a corpus that already exists.

**Accepted cost.** A global hook has global blast radius, so capture fails open silently at every step — no transcript, no `node`, unwritable target: exit 0, write nothing. Widening the auditor to the estate reopens on its own terms when lane 05 runs on a runner.
