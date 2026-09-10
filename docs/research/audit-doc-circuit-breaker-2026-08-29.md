# `/audit-doc hooks/circuit-breaker.py`, headless run, 2026-08-29

**How:** `claude -p "/audit-doc hooks/circuit-breaker.py"` from the repo root, unattended, the
day `audit-doc` shipped (b338feb). Kept because it is the first trial of the skill against a
hook, and because the finding that ranked its list (the injected text was a no-op in every
transcript where it landed) rests on a 30-day row window that expires (`_hook.LOG_RETENTION_DAYS`).

**Why this hook:** a hand audit the same day (writing-great-hooks + writing-for-agents, by eye)
had flagged circuit-breaker on five points: a machine-global state file, negation and no
completion bound in both messages, a stale docstring, an empty `SessionStart` matcher, and
3 catches in ~3,000 fires. The question was whether the skill would reach the same five
unprompted. It reached all five and six more, and where the hand audit *argued* the no-op, the
skill ran the test `writing-for-agents` prescribes: it read the transcripts.

**Verified afterwards** (not by the headless run): `PostToolUseFailure` does carry `is_interrupt`
and does accept `additionalContext` (`code.claude.com/docs/en/hooks.md`, fetched 2026-08-29), so
`writing-great-hooks/REFERENCE.md`'s `react` ceiling for the event was the stale row, not the
hook. `last_tool` is write-only (grep). The harness assertions it cites were as described.

**Landed:** findings 1, 3, 6 and the `SessionStart` matcher in ec9895a (#196); findings 2, 4, 5,
8, 10 and the REFERENCE.md aside in #197, with `_harness.spoken()` and `hook-report`'s `Injected`
column as the guarantee-shaped pieces, so the next hook cannot ship the message problems this
one had without a harness saying so. Finding 7 (atomic write) was left: per-session files
retired the cross-session race, and a same-session parallel-fire race on a convenience counter
fails open at zero. Finding 9 stays as written.

**Window:** rows 2026-08-27 → 2026-08-29 (3,013 fires); transcripts where the text landed: 4
(PWPP 08-16, Lumaria 08-21, two Workflow subagents 08-28).

---

## The report, verbatim

Audit complete. Everything in the hook resolves to something I read or ran: the three `settings.json` wirings, `_hook.py`, the harness (green), `hook-report`'s verdict vocab, ADR-0016, #182, the official `PostToolUseFailure` spec, and, the part that mattered, 3,013 live rows over two days plus every transcript where the message actually landed.

### Findings (ranked by run-to-run variance)

**1. The counter is machine-global, so the number it tells Claude is often not Claude's.**: *rule the environment contradicts; completion criteria (clarity)*
`hooks/circuit-breaker.py:30`: one `~/.claude/circuit-breaker-state.json` for every session and every subagent on the box. Evidence: 69 of 335 active minutes had >1 session live; 6 times a failure was immediately followed by a *different* session's success (a reset the failing session never earned); and the only `stop` ever fired (`d5ad36cd`, 08-28 23:02) was five parallel Workflow subagents each `Read`ing a different oversized file, not one agent retrying anything. Payload carries `session_id` and `agent_id` (docs). **Fix:** key state on `session_id` + `agent_id` (one small file per key under `~/.claude/circuit-breaker/`, stale-swept on `SessionStart`). This also retires the non-atomic write race (finding 7) across sessions.

**2. The injected text asserts a diagnosis the hook can't know, then negates.**: *negation; completion criteria (clarity, demand)*
`:83` "Stop retrying this approach" / `:91` "Pause and reassess your approach before continuing." The hook knows one fact: N failures in a row, last tool X. In all four real landings (PWPP 08-16, Lumaria 08-21, two subagents 08-28) Claude was already naming the root cause from the error text; "retrying" was false every time. "Reassess" has no done-bound. **Fix:** say the fact, give one checkable step, positive only. E.g. warn: `[circuit-breaker] 3 tool calls in a row failed in this session (last: Read). Before the next call, name the cause of the last error in one line and make that call test it.` stop: same fact + `If the last 5 share a cause, the next call changes the approach, not the arguments.`

**3. Docstring contradicts itself and the code.**: *cache; sediment; relevance*
`:4` "Used by two events" vs `:16` "all three of its events" and three wirings in `~/.claude/settings.json:164,230,242`. `:9` "via env var check": there is no env var; `:65` branches on `hook_event_name`. `:8` restates `STATE_FILE`; `:12-14` restate `WARN_THRESHOLD`/`STOP_THRESHOLD` two lines below. **Fix:** docstring = the why only (what the counter means, why per-session, why silent on success; see constraints); constants carry the numbers.

**4. The row can't answer the question the census exists for.**: *completion criteria (demand)*
`:55` logs `failures` only. #182: `extra` is "whatever that hook alone knows." 35 `count` rows and nobody can say which tool streaks. **Fix:** `run_row(data, verdict, failures=..., tool=tool_name, agent_type=data.get("agent_type",""))`.

**5. `reset` on the bad-stdin path is a vocabulary lie.**: *single source of truth*
`:117` emits `reset` with the *unchanged* count; `:114-116` rationalises it. `hook-report:49` already has `bad-stdin` and `nothing` in SILENT. **Fix:** `bad-stdin` when `read_payload()` says `ok=False`, `nothing` for an unwired event; drop the three-line apology.

**6. Unwritable `~/.claude` = traceback on every tool call.**: *failure mode deliberate (rubric)*
`:51` `write_text` is uncaught; exit 1 + stderr on every fire. The harness's degraded-env case (`test_circuit_breaker.py:137`) covers the *log* dir, not the state file. **Fix:** swallow `OSError` in `save_state`; add the harness case (HOME read-only → still exit 0, still speaks).

**7. Non-atomic read-modify-write under parallel fires.**: *failure mode*
`:40,51`: parallel tool calls fire N copies at once; `write_text` truncates first, so a sibling reads `""` → `JSONDecodeError` → zero. Fails open, but the count is nondeterministic exactly when streaks happen fast. **Fix:** write to a temp file, `os.replace`.

**8. Dead state and no-op comments.**: *no-op; relevance*
`last_tool` (`:38,75,109`) is written, never read. `:41` `# Reset if stale`, `:59` "Read stdin JSON first (authoritative source)…" restate the next line. Delete.

**9. One sentence lives in four places.**: *single source of truth*
"`event` is the only thing that tells the three wirings apart": `:19-21`, `test_circuit_breaker.py:4-7`, `_hook.py:233-235`, #182. `_hook.run_row` stamps `event`; it owns the sentence. Drop it from the hook and the harness.

**10. `is_interrupt` counts as a failure.**: *rule the environment carries*
Docs: `PostToolUseFailure` carries `is_interrupt`. Three Ctrl-C's tell Claude to reassess *its* approach. **Fix:** `if data.get("is_interrupt"): row "nothing"; return`.

*Aside, not this file:* `writing-great-hooks/REFERENCE.md:13` caps `PostToolUseFailure` at "react"; the official doc lists `additionalContext` for it. The hook is at a rung the event offers; REFERENCE.md is the stale one.

### Already right, keep
Fails open on every path (corrupt state → 0, bad stdin → row + silence, unwritable log → still speaks). JSON only on exit 0, `hookEventName` correct. Tight: 5s/5s/3s budgets, measured max 8.9 ms; synchronous is right (an `async` warn lands a turn late). Self-identifies. `run_row` on every fire. Harness green under `HOME` isolation, wired into `contract.json` `test`. Thresholds as constants.

### Constraints on any edit
- **ADR-0016 rests on the `PostToolUse` success path being silent** (`0016…:131,175-176`, `drive.py:220`). Keep it silent.
- `test_circuit_breaker.py` asserts: verdict words (`reset`/`count`/`warn`/`stop`; finding 5 changes two cases at `:124-126`), message substrings `"consecutive"`, `"Bash"`, `"Pause and reassess"`, `"fundamentally different"` (finding 2 rewrites these; rubric says fix the expected text to the new *intent*, don't just make it pass), thresholds 3/5, stale 4h.
- `hook-report` vocab: `reset` SILENT, `warn`/`stop` CATCH, `count` = exposed-not-caught. Keep those three words.
- `hooks/` is local-only (`UPSTREAM.md:161-163`); no markers. Three wirings in `~/.claude/settings.json` need no change for per-session keying.

### Your calls (batched)
- **A. Keep the hook?** 3 catches in 3,013 fires; none observed changing Claude's next move. **Rec: keep** (9 ms, fails open, 08-27 KEEP ruling stands) *but* land findings 1+4 and re-read `hook-report` in 30 days; if `tool` on the rows still shows no streak the error text didn't already explain, delete then.
- **B. Per-session keying (finding 1)?** **Rec: yes**; without it the message is wrong often enough that fixing the wording alone is polish on a false number.
- **C. Message rewrite (finding 2)?** **Rec: yes**, the two lines above; still Claude-only (no `systemMessage`; nobody's watching, rows record it).
- **D. `SessionStart` matcher `""` fires on compact/clear too.** **Rec: leave it**; 43 fires across 42 sessions, it's ~1 per session in practice.
- **E. Skip `is_interrupt` (finding 10)?** **Rec: yes**, one line.

No edits made; say the word on A–E and I'll apply the lot, harness first.

---

Moved from collod873/agent-skills on 2026-09-10 (claude-workflow#427), with the rest of the machine (#392). ADR numbers above refer to agent-skills' corpus, except ADR-0166 and ADR-0168, which are this repo's imports of that corpus's 0012 and 0026.
