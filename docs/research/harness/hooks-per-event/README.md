# Harness: N hooks on one event

Drives **real headless Claude Code sessions** with an arbitrary set of hooks registered on one
event, so questions of the form *"what does the harness actually do when two hooks both refuse?"*
are answered by measurement rather than by reading the docs.

Produced the findings in [ADR-0166](../../../adr/0166-hooks-sharing-an-event-self-identify-on-systemmessage.md),
resolving [#18](https://github.com/collod873/agent-skills/issues/18), the non-blocking-channel
findings in [agent-skills ADR-0015](https://github.com/collod873/agent-skills/blob/main/docs/adr/0015-the-vendored-test-fires-as-an-edit-time-router.md),
resolving [#25](https://github.com/collod873/agent-skills/issues/25), and the `PostToolUse`
findings in [agent-skills ADR-0016](https://github.com/collod873/agent-skills/blob/main/docs/adr/0016-post-events-refusal-channels-are-per-hook-not-raced.md),
resolving [#26](https://github.com/collod873/agent-skills/issues/26).

## Files

| File | What it does |
|---|---|
| `stub_hook.py` | Instrumented stub, `PreToolUse` and `PostToolUse`. `argv: <name> <deny\|allow\|exit2\|pass\|ask\|ctx\|block> [sleep]`. Logs its own start/end epoch to `$HOOKTEST_LOG` and emits a reason, `systemMessage`, and stderr all tagged with `<name>`, so every channel is attributable. `ctx` is the non-blocking arm: exit 0, no decision, guidance on `additionalContext`. `block` is Post's refusal shape: top-level `decision: "block"` + `reason` instead of `permissionDecision`. |
| `drive.py` | Registers N stubs via `--settings`, runs `claude -p` in a scratch cwd, and reports: whether the command executed, per-hook timing and overlap, which reason reached the `tool_result`, and which tags survived anywhere in the stream. |
| `cost.py` | Marginal wall-clock cost of the 2nd and 3rd hook, spawned concurrently. |
| `collide.py` | Whether a real `gh issue close` carrying a closing record trips the live `validate-bash.py`. Assembles payloads in Python, never a shell; see the self-trigger note below. |

## Running it

```sh
python3 drive.py                      # every scenario
python3 drive.py 3-two-denies 4-deny-races-exit2
HOOKTEST_NO_HOOK_EVENTS=1 python3 drive.py 3-two-denies
python3 cost.py
python3 collide.py
```

Each run writes `raw-<scenario>.jsonl` (the full stream) and `results.json`. Add a scenario by
appending to `SCENARIOS`, a list of `(name, behaviour, sleep_seconds)`.

Six **arms** decide which tool, and which event, the hooks sit in front of. `BASH_ARM` (the
default) drives a `PreToolUse`/`Bash` `echo`; `EDIT_ARM` drives a `PreToolUse`/`Edit|Write` file
write, for questions about hooks that fire before an edit rather than before a command; `POST_ARM`
drives the same `echo` but registers the stub on `PostToolUse`/`Bash` instead, where the tool has already
run by the time the hook sees it. `TIMEOUT_ARM` is `BASH_ARM` with the hook's `timeout` cut to 2 s,
for a stub that sleeps past it (`T*` scenarios: does a timed-out refusal refuse?). `SUB_PRE_ARM` and
`SUB_STOP_ARM` have the main agent delegate the `echo` to a subagent, with the stub on
`PreToolUse`/`Bash` or on `Stop` + `SubagentStop` (`S*` scenarios: which events fire for a
subagent's work, and does the payload's `agent_type` say whose). The stub logs `hook_event_name` and
`agent_type` as columns 5–6 of its row for that arm. Findings:
[`../../hook-timeout-and-subagent-scope-2026-08-29.md`](../../hook-timeout-and-subagent-scope-2026-08-29.md).
`STOP_ARM` registers the stub on `Stop` alone, with no tool at all, and drives the two refusal
shapes there (`stopblock` / `stopexit2`; each refuses the first `Stop` and passes once
`stop_hook_active` is set, so a second fire is the forced-continue reading) and, since #204, the
two hand-back shapes (`stopctx`: `systemMessage` + `additionalContext`, no `decision`; `stopsys`:
`systemMessage` alone; same once-then-pass guard, so a second fire means the hand-back continued
the turn). Findings:
[`../../stop-refusal-channels-2026-08-29.md`](../../stop-refusal-channels-2026-08-29.md).
Put a scenario on a non-default arm by naming it in `ARMS`. The
edit and post arms' prompts ask the model to quote back the hook messages it received rather than to
*obey* an injected instruction, since obedience measures priority against the user's own prompt, which is
a different question from delivery. This matters more on `POST_ARM` than `EDIT_ARM`: Post's message
has no discrete stream event of its own (it shows up only inside the model's own thinking or reply),
so a prompt that never asks for it undercounts delivery: a byte-identical `P3-two-blocks` config
reported zero surfaced tags on one run under the unprompted `PROMPT` and both on the next, purely
because nothing asked the model to say so.

Two flags carry the method:

- **`--setting-sources ""`** excludes user settings, so the machine-global hooks do not join the
  experiment uninvited. Without it every run has a third hook in it.
- **`--include-hook-events`** adds `system/hook_response` records echoing each hook's raw stdout.
  Useful for attribution, but it is a *diagnostic* echo; do not mistake a tag appearing there for
  the tag being delivered. `HOOKTEST_NO_HOOK_EVENTS=1` reruns without it; the difference between
  the two is what proved the losing hook's reason is discarded rather than merely reordered.

For the human channel there is no stream event at all. Run with `--session-id`, then read the
persisted transcript under `~/.claude/projects/<cwd-slug>/<id>.jsonl` and look for
`attachment.type == "hook_system_message"`: one record per hook.

## Self-trigger

`SKILL.md:62` warns that a hook scanning Bash commands will scan its own test payload. That is not
theoretical here: assembling `collide.py`'s payloads inside a shell heredoc tripped the live
`validate-bash.py` and blocked the measurement. Every payload in this directory is built in Python
and passed on stdin. Keep it that way, and note `collide.py` splits its own literals (`"." + "env"`)
so that reading *this* file does not arm the guard either.

## Costs

Each `drive.py` scenario is one Haiku session, ~$0.007 and ~6–10 s. The full sweep is well under a
dollar.

---

Moved from collod873/agent-skills on 2026-09-10 (claude-workflow#427), with the rest of the machine (#392). ADR numbers above refer to agent-skills' corpus, except ADR-0166 and ADR-0168, which are this repo's imports of that corpus's 0012 and 0026.
