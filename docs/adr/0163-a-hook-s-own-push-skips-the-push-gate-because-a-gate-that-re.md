---
status: constraint
date: 2026-09-05
reversal: Reversing it puts the SessionEnd hook back inside the push gate, and one `/clear` again forks the VM from 483 tasks to 7,760 in fifty seconds, the shape of 2026-09-05 16:16.
---

# A hook's own push skips the push gate, because a gate that re-enters its hook forks the machine

The SessionEnd hook publishes a session record with a real `git push` of `refs/notes/sessions`.
That push ran husky's `pre-push`, the whole suite, whose session-capture cases fire the real hook
forty times per run. Each fire dispatched a real capture, each capture pushed, each push ran
another gate. Twice on 2026-09-05 that loop outran the memory cap and earlyoom;
[ADR-0162](0162-one-push-gate-runs-per-machine-so-lane-fan-out-queues-instea.md)'s lock did not
hold it, because a nested gate inherits the held flag.

So a push a hook makes on its own behalf (the notes ref, the Knowledge-Base flush) passes
`--no-verify`, and `pre-push` exits 0 when every ref pushed is under `refs/notes/`. Notes carry
no code. The shim `_hook.sh` discards an inherited payload, name or clock and exports none.

**Rejected: stubbing the dispatch under the suite.** The suite's captures already publish to
scratch remotes; the defect was the real repo's gate, not the tests.
