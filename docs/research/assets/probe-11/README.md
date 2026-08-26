# probe-11 — the setup-script portability experiment

The two artifacts run on 2026-08-22 UTC to answer
[`#11`](https://github.com/collod873/claude-workflow/issues/11). Findings are in
[`../claude-cloud-sessions-2026-08.md` §9](../claude-cloud-sessions-2026-08.md); the verbatim run
log is
[issue #11, comment 5377211001](https://github.com/collod873/claude-workflow/issues/11#issuecomment-5377211001).

- `setup-script.sh` — pasted into the **Setup script** field of a throwaway cloud environment
  (`probe-11`, network Trusted, no environment variables). Attempts the `agent-skills` clone, then
  writes two probe skills and a two-hook `settings.json` by heredoc into every candidate home.
- `session-prompt.md` — the first message of the cloud session, against `collod873/claude-workflow`
  on `main`.

Two design choices are the reason the run is conclusive, and both are easy to lose on a rerun:

- **The hook denies a sentinel rather than logging one.** A hook that fired and allowed is
  indistinguishable from a hook that never loaded, and that ambiguity is the exact fail-open shape
  the venue ruling is about. `echo PROBE_SENTINEL_BLOCK_ME` gets blocked or it prints; there is no
  third outcome.
- **The two slash commands must be sent by a human.** `disable-model-invocation: true` suppresses
  *model-side* invocation by design, so a session invoking `/probe-flagged` itself and failing would
  have proved nothing. The prompt tells the session to stop and wait for a user turn.

The environment was archived after the run. To rerun, recreate it — and note the script writes to
all four candidate homes, which is what keeps §9 from isolating whether `/root` alone suffices. A
single-home variant is the sharper experiment.
