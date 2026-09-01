---
status: constraint
date: 2026-09-01
reversal: dropping the run means reverting `ticket_shape.validate`'s spec branch to a text-only check — one function, no caller changes; a day's work.
---

# A spec's one criterion is run at filing time, in the caller's tree with a 30s budget, and a green exit refuses filing — a criterion that cannot run at all only warns

`bin/ticket_shape.py`'s `validate` never ran a check command, only read text. A spec's one
criterion (#226 §1, the "I'll know it works when I can ___" sentence) can be true before the work
exists — #236's `gh issue list --label sliceable | xargs -r …` on an empty tracker — and prose-only
reading cannot notice. That shape is red-at-publish, and this is the ruling on it.

**Scope: `spec` only.** #306 asked for "the wave-0 tracer" too, but nothing marks a ticket wave 0
yet — lands once slicing stamps one.

**Mechanism:** run the `check:` command as `close-ticket.run_check` does — same tree
(`repo_root`), no extra sandbox; `file-issue` already runs on the filer's behalf.

**Timeout: 30s** — filing is interactive; unbounded hangs `file-issue` on a slow `vitest run`.

**Verdict: exit 0 refuses, nonzero passes, cannot-run warns** — a broken check proves nothing, so
refusing on it would block filing over an environment hiccup.
