# A contract slot names a check a reader can run, never a hook entry point

Recorded 2026-08-28.

Claude Code hands a hook its payload as JSON on stdin, so a hook path run as a plain command exits 0
having checked nothing. The probe published this repo's Stop hook as `stop.cmd` anyway — it was
present, executable, and the one `.claude/settings.json` wires — and 255 consecutive turn-end runs
reported `clean` in a median of 0.020s each, against 6.070s before the switch. A hook is asked what
check it runs, by a `# check-command:` line in the hook file, and a hook that will not say publishes
`null`.

Amends: [ADR-0056](0056-bin-gauntlet-runs-the-check-contract-instead-of-three-hardco.md).

## Consequences

Every question the probe knew how to ask — on disk, executable, wired, reproduced byte-for-byte by
`regenerate && diff` — was answered yes by a command that could not go red. So a slot is no longer
certified by anything a filesystem can answer: the published `stop.cmd` is run against a tree whose
checks fail and has to exit 1. That is the only test in this repo that asks a contract slot the
question a contract slot exists to answer.
