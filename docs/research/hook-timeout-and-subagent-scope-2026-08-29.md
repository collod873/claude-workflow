# Hook timeout and subagent scope, measured 2026-08-29

Unprompted: no issue preceded this note

Two claims `writing-great-hooks` was about to state from memory, measured instead on
[`harness/hooks-per-event/`](harness/hooks-per-event/README.md) (the ADR-0166/0016 harness, four
new scenarios: `T1-deny-timeout`, `T2-exit2-timeout`, `S1-sub-pretooluse`, `S2-sub-stop`). One
Haiku session each, `--setting-sources ""`, so only the stub was live.

## 1. A timed-out hook fails open, silently, whatever it was going to say

Stub sleeps 5 s under `"timeout": 2`, then refuses. Both refusal shapes:

| Scenario | Refusal | Command ran? | `hook_response` | Model told | Human told |
|---|---|---|---|---|---|
| T1 | `permissionDecision: deny` | **yes** | `outcome: "cancelled"`, `exit_code: 1`, stdout/stderr empty | nothing: `tool_result` clean, `is_error: false` | nothing |
| T2 | `exit 2` + stderr | **yes** | same | nothing | nothing |

The harness treats a timeout as a non-blocking error (`exit 1`) and discards both channels. So a
hook's `timeout` is a ceiling on fail-closed that nothing inside the script can raise: past it the
action proceeds and nobody is told. Two consequences for a safety hook: it must exit well inside its
`timeout` on every path (a gate with a network call, like `close-gate.py`'s 20 s, is fail-open on a slow
network), and the permission `deny` rule remains the only lock; the hook is defense-in-depth.

## 2. Tool events fire for a subagent's work, and say whose; `Stop` never does

Main agent launches one `general-purpose` subagent that runs the echo; a passing stub logs
`hook_event_name` and `agent_type` per fire.

| Scenario | Registered on | Fires observed (`event`, `agent_type`) |
|---|---|---|
| S1 | `PreToolUse`/`Bash` | 1 × `PreToolUse`, `"general-purpose"`, the subagent's echo |
| S2 | `Stop` + `SubagentStop` | `Stop`, `""` at +0.0 s · `SubagentStop`, `"general-purpose"` at +1.2 s · `Stop`, `""` at +2.9 s |

- A `PreToolUse` hook sees a subagent's tool call as a normal fire, with `agent_type` naming the
  subagent; a main-agent fire carries `agent_type: ""`. A hook that wants to exclude or scope
  delegated work has the field to do it.
- `Stop` fired only for the main agent. The subagent's end is `SubagentStop`, with `agent_type` set.
  A `Stop` gate sees none of a subagent's work.
- The first `Stop` landed **before** `SubagentStop`: the Agent call returned as "async agent
  launched", the main agent replied and its turn ended, the subagent finished 1.2 s later, and the
  main agent's wake-up ended in a second `Stop`. A `Stop` gate can pass while delegated work is still
  running. (In S1 the same prompt returned the subagent's result inline; whether the Agent tool
  returns inline or async varied between the two runs, and the early-`Stop` ordering was observed in
  the async case.)

## Ceiling

- One run per scenario, Haiku. The timeout result is structural (the `hook_response` record is the
  harness's own accounting), so a rerun would only re-read it; the inline-vs-async Agent behaviour is
  the one thing here that varied across runs.
- Only `PreToolUse` was driven on the timeout arm. A timed-out `Stop` or `PostToolUse` hook was not
  measured; there is no reason to expect a different `outcome`, but it is unmeasured.
- `Stop`'s early fire was observed with a subagent launched by the harness's own Agent tool; a
  `fork` or a teammate was not driven.

---

Moved from collod873/agent-skills on 2026-09-10 (claude-workflow#427), with the rest of the machine (#392). ADR numbers above refer to agent-skills' corpus, except ADR-0166 and ADR-0168, which are this repo's imports of that corpus's 0012 and 0026.
