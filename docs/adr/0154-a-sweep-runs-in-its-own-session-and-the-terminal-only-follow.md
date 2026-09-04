---
status: constraint
date: 2026-09-04
amends: ADR-0146
reversal: Reversing it means deleting the re-exec and the follower from `bin/canary sweep` and
  accepting that every sweep dies with the terminal that started it. Getting back means
  rediscovering, from a run that vanished mid-fan-out, that the caller was never the thing doing
  the work.
---

# A sweep runs in its own session and the terminal only follows it, because a sweep outlives the terminal that starts it

A sweep fans twenty-two lanes out and then waits twenty minutes on hosted runners. Once the fires
are away the local process holds no state a lane needs — but it held the verdicts, so an agent
harness reaping the caller mid-fan-out lost every one while the runs carried on invisibly. Three
sweeps died that way, each reported as memory pressure with twenty gigabytes free.

Chunking the fan-out was the obvious answer and it failed: three concurrent lanes were reaped the
same way. The burst is a pretext, not a cause, so the fix cannot be to burst less.

So `sweep` re-execs itself under `setsid` and the terminal does nothing but `tail -f` the log and
hand back the exit code an `EXIT` trap writes. Killing the follower now costs the output, never the
run. `prove` is untouched: one lane is short enough to be worth restarting.
