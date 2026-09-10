# Stop refusal channels, measured 2026-08-29

Unprompted: no issue preceded this note

ADR-0016 measured `decision: "block"` on `PostToolUse` only; `stop-gate.py` refused on `Stop` with
`exit 2` + stderr and its docstring said the JSON form had no channel there. Neither claim had been
driven on `Stop`. Two scenarios on [`harness/hooks-per-event/`](harness/hooks-per-event/README.md)
(`ST1-stop-block-json`, `ST2-stop-exit2`; `ST3`/`ST4` below were added 2026-09-04), one Haiku
session each, `--setting-sources ""`. The
stub refuses the first `Stop` and passes once `stop_hook_active` is set, so a second `Stop` fire in
the log *is* the "forced continue" reading.

| Scenario | Refusal | `Stop` fires | Reached Claude | Reached the human |
|---|---|---|---|---|
| ST1 | `{"decision": "block", "reason": …, "systemMessage": …}`, exit 0 | 2 (+0.0 s, +1.7 s) | `reason`, as a `Stop hook feedback:` user turn, obeyed (final reply `RESUMED`) | `systemMessage`, as `system/informational`: `Stop says: SYSMSG_A` |
| ST2 | `exit 2`, message on stderr | 2 (+0.0 s, +3.2 s) | stderr, as a `Stop hook feedback:` user turn, **prefixed with the hook's whole command line** (`[python3 …/stub_hook.py A stopexit2 0]: …`) | nothing |

## Findings

1. **The JSON form forces the continue on `Stop`.** Same second fire, same feedback turn, same
   obedience as `exit 2`. Nothing is lost by switching.
2. **Only the JSON form has a human channel.** `systemMessage` surfaces as an informational
   notice; the exit-2 path's stderr goes to the model alone. A gate that refused on `exit 2` told
   the human nothing on the first block of a streak; `stop-gate.py` until #196.
3. **The exit-2 feedback carries the hook's full command line.** That prefix is what a long
   `[python3 ~/.claude/hooks/stop-gate.py]: …` block in the transcript was; the JSON `reason`
   arrives bare.

## Consequence

`stop-gate.py`'s block path is the JSON form (ADR-0033 §4). `bin/lint`'s legacy `deny-envelope`
rule ("nothing in `hooks/` emits `decision: block`", written against PreToolUse's pre-port shape
before ADR-0016) exempts `hooks/stop-gate.py` and cites this file.

## The hand-back, measured 2026-09-04 (#204)

`stop-gate.py`'s hand-back and not-mine paths spoke on `systemMessage` **and**
`hookSpecificOutput.additionalContext`, with no `decision`, meaning to let the turn end. The
harness's docs say `additionalContext` on `Stop` "keeps the conversation going through the same
loop protections as `decision: "block"`", and `bin/hook-trace`'s first 7-day run read 49 of 54
hand-backs and 15 of 19 not-mine notices as *continued*. Two more scenarios on the same arm, same
method: the stub speaks once and passes on `stop_hook_active`, so a second `Stop` fire is the turn
continuing.

| Scenario | Hand-back shape | `Stop` fires | Reached Claude | Final reply |
|---|---|---|---|---|
| ST3 | `systemMessage` + `hookSpecificOutput.additionalContext`, no `decision` | **2** (+0.0 s, +1.6 s) | `additionalContext`, as a `Stop hook additional context:` turn, obeyed | `RESUMED` |
| ST4 | `systemMessage` alone | **1** | nothing | `DONE` |

4. **`additionalContext` on `Stop` is a continuation, not a channel.** The turn reopens exactly as
   it does on a block, under the same cap; the only difference is the label. A hand-back carrying
   it was never a hand-back: the breaker refused once, then "released" into a second forced turn,
   and the third `Stop` re-ran the check and did it again until the harness's 8-strike override.
   That is the 24-to-2 hand-back-to-block ratio in `~/.claude/logs/stop-gate-2026-09-04.jsonl`
   session `d87bb50d`, and the 32-to-17 over 30 days before it.
5. **`systemMessage` alone ends the turn** and still reaches the human. So a Stop hook that means
   to let the turn end has exactly one channel, and nothing to say to Claude at all.

**Consequence.** `_handback()`, `_not_mine()` and the new `_deferred()` in `stop-gate.py` emit
`systemMessage` only. `hooks/test_stop_gate.py` asserts the *absence* of `hookSpecificOutput` on
those paths (`_ends_turn`), which a pure-function harness can hold; whether the harness then ends
the turn is `bin/hook-trace --session <id>`'s reading of the transcript, which was run against the
fixed hook in a scratch repo with a red `stop` slot the same day: block `continued`, hand-back
`ended`.

## Ceiling

One run per scenario, Haiku, a single refusing hook. Contention between two `Stop` hooks both
refusing was not driven (ADR-0016's per-hook `reason` finding on Post is the prior; `Stop` carries
`stop-fire-log.py` beside the gate, which never speaks). The hand-back channel, unmeasured when
this file was first written, is ST3/ST4 above. Not driven: whether `additionalContext` *beside*
a `decision: "block"` changes anything (the gate never emits that pair), and `SubagentStop`,
whose docs describe the same decision control and which the gate is not registered on.

---

Moved from collod873/agent-skills on 2026-09-10 (claude-workflow#427), with the rest of the machine (#392). ADR numbers above refer to agent-skills' corpus, except ADR-0166 and ADR-0168, which are this repo's imports of that corpus's 0012 and 0026.
