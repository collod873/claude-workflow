# A test's timeout is sized for the slowest venue it runs in, never the fastest

Recorded 2026-08-25.

Most of this repo's suites drive their subject as a real process, because a hook's contract *is* its
exit code and its log file. Process spawns are exactly where a shared hosted runner is slowest:
`backfill.test.ts` runs in 0.8s on the workstation and 10.1s on a two-core runner, and vitest's 5s
default turned that 12× spread into the test's verdict. The timeout is therefore set globally to 30s
in `vitest.config.ts`, sized against the slowest venue, and any hand-rolled poll inside a test is
sized to trip before it — a specific "timed out waiting for a capture file" beats a generic one.

## Consequences

A genuinely hung test now takes 30s to report instead of 5s. That is the trade, and it is the right
way round: a slow red is read, and a red that means "the runner was busy" is not. This is
[DESIGN.md](../../DESIGN.md) §12 move 0 — quarantine the flake — becoming a real move on the first
check that went red for an environment reason, which is what move 0 reserved itself for.

Sizing for the slowest venue is not licence to leave a wall-clock margin unexamined. The same run
that produced this ADR also had `session-capture.test.ts` red on the runner and green here, and that
one was **not** environment: the test faked "node is absent" by scrubbing `PATH`, which
`node_on_path` repairs unconditionally, so the branch it named was reached only on machines where
node happens to live outside the standard dirs. It passed locally by geography while hiding a real
bug in the hook. Before raising a timeout, establish that the failure is about *how long* the venue
took and not about *what the venue is* — a test that changes its answer per machine is unsound, not
slow.
