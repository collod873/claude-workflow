# Research: what `prompt` and `agent` hook types can actually do

Researches: collod873/agent-skills#4

_Resolves [#4](https://github.com/collod873/agent-skills/issues/4). Researched 2026-07-28._

**Scope note.** This ticket originally asked for a full survey of every hook type, event, and field
table. It was narrowed to the one question that blocks
[#10 (What enforces the close gate)](https://github.com/collod873/agent-skills/issues/10):
**can a hook make a judgment call, and does an `agent` hook get a fresh context?** The field tables
for `command`/`http`/`mcp_tool` are reference material #10 can look up when it needs them, and are
already summarised accurately in `writing-great-hooks/REFERENCE.md`.

**Sources.** Official Claude Code documentation, fetched 2026-07-28:
- Reference: <https://code.claude.com/docs/en/hooks> (redirected from `docs.claude.com`)
- Guide: <https://code.claude.com/docs/en/hooks-guide>
- Local secondary: `/home/collin/.agents/skills/writing-great-hooks/REFERENCE.md`

---

## The load-bearing answer

**Yes. A hook can make a judgment call, and an `agent` hook runs in a subagent with tool access.**
Both types are documented, first-class, and configured declaratively, with no shelling out to a model.

The guide states the purpose outright:

> "For decisions that require judgment rather than deterministic rules, you can also use
> prompt-based hooks or agent-based hooks that use a Claude model to evaluate conditions."

### `type: "prompt"`: single-turn judgment, no tools

> "Instead of running a shell command, Claude Code sends your prompt and the hook's input data to a
> Claude model, Haiku by default, to make the decision. You can specify a different model with the
> `model` field if you need more capability."

- Return shape is `{"ok": true}` or `{"ok": false, "reason": "…"}`, **not** the
  `decision`/`permissionDecision` fields a command hook uses. The harness maps `ok` onto the
  event's decision.
- **Isolated context, no tool access.** It sees the hook's stdin JSON and nothing else.
- Default timeout **30s**.

### `type: "agent"`: subagent with tools

> "When verification requires inspecting files or running commands, use `type: "agent"` hooks.
> Unlike prompt hooks, which make a single LLM call, agent hooks spawn a subagent that can read
> files, search code, and use other tools to verify conditions before returning a decision."

- Same `{"ok", "reason"}` shape as prompt hooks.
- Default timeout **60s**, up to **50 tool-use turns**.
- `$ARGUMENTS` in the prompt is replaced with the hook's JSON input.
- **Experimental**, with an explicit steer away from production:

  > "Agent hooks are experimental. Behavior and configuration may change in future releases. For
  > production workflows, prefer command hooks."

The docs' own dividing line: *"Use prompt hooks when the hook input data alone is enough to make a
decision. Use agent hooks when you need to verify something against the actual state of the
codebase."*

### The documented example is almost exactly our close gate

The guide's agent-hook example is a `Stop` hook that verifies tests pass before letting Claude stop:

```json
{ "hooks": { "Stop": [ { "hooks": [ {
  "type": "agent",
  "prompt": "Verify that all unit tests pass. Run the test suite and check the results. $ARGUMENTS",
  "timeout": 120
} ] } ] } }
```

And the prompt-hook example is a `Stop` hook asking whether the work is actually finished: the
"is the task truly done?" shape. Both are supported patterns, not clever misuse.

---

## What this changes for #10

1. **The fresh-context requirement can be structural rather than remembered.** The close-gate rule
   says a fresh context must check the diff, with no marking your own homework. An `agent` hook is a
   subagent, so freshness comes from the mechanism instead of a rule a skill has to honour. See
   the caveat below before relying on this.
2. **`agent` is experimental and the docs steer production work to `command`.** For a gate meant to
   be the guarantee behind the whole reframe, that is a real risk to weigh, not a footnote.
3. **`Stop` genuinely blocks**: the reference lists `Stop` as block-capable ("Prevents Claude from
   stopping, continues the conversation"). Blocking events include `PreToolUse`,
   `PermissionRequest`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `PreCompact`, `TaskCompleted`
   and others; `PostToolUse`, `SessionEnd`, and `FileChanged` only react.
4. **But `Stop` still gives up.** The guide: *"Claude Code overrides a Stop hook after it blocks
   eight times in a row without progress."* Independently, the research on Lumaria's live gate
   ([#5](https://github.com/collod873/agent-skills/issues/5)) found it hands back after **one**
   block by its own design. Either way the gate is a **strong nudge with a documented give-up**,
   not a lock. If #10 wants a lock, it needs a permission `deny` rule behind the hook.
5. **`stop_hook_active` is real and must be checked.** The guide's own remedy is to parse it from
   stdin and exit early, or the hook loops.
6. **Timeout is a live design input.** Defaults are 30s (`prompt`) and 60s (`agent`), against
   600s for `command`. PWPP's ~350-test suite will not finish inside an agent hook's default, so
   #10 must set `timeout` explicitly, which agrees with the same conclusion reached from #5.

---

## Agreement with `writing-great-hooks/REFERENCE.md`

**No disagreements found on any point checked.** The local reference is accurate against the
official docs on: the `{"ok", "reason"}` shape and that it is *not* the
`decision`/`permissionDecision` fields (`REFERENCE.md:95`); Haiku-by-default with a `model`
override (`:95`); agent hooks getting tools, 60s, 50 tool turns, and being experimental (`:96`);
the full type list (`:113`); the default-timeout table (`:86`); and `stop_hook_active` (`:49`).

One apparent conflict was chased down and dismissed: a summary of the *reference* page reported no
mention of `stop_hook_active`, but the *guide* page documents it explicitly with a code sample. The
field is real; the gap was in one page's coverage, not in the docs.

---

## Unresolved

- **Whether an `agent` hook's subagent can see the parent conversation.** The docs say `$ARGUMENTS`
  is replaced with the hook's JSON input, and every event's payload carries `transcript_path`. So
  the subagent starts fresh but is handed a **path to the parent transcript** and has `Read`. Its
  isolation is therefore a default, not an enforced boundary, which weakens "fresh context by
  construction" as a guarantee for the close gate. Settled by testing an agent hook and inspecting
  what it actually receives, or by docs that state the subagent's tool allowlist precisely.
- **The agent hook's exact tool allowlist.** The reference summary named Read, Grep, Glob; the
  guide says "read files, search code, and use other tools" and the example instructs it to *run
  the test suite*, which implies Bash. Whether Bash is available decides whether the gate can run
  `pytest` itself or must be handed results. Settled by the reference page's
  `prompt-and-agent-hook-fields` section or an empirical test.
- **Whether `continueOnBlock` applies to `Stop`.** It is documented for `PreToolUse` and
  `PostToolUse`; `Stop`'s described behaviour (feed `reason` back so Claude keeps working) already
  resembles it. Matters for what the agent sees on a failed gate.
- **Cost and latency of an agent hook on the hot path.** Not documented. A gate firing on every
  turn-end spawns a subagent each time. Settled by measurement, not docs.

---

Moved from collod873/agent-skills on 2026-09-10 (claude-workflow#427), with the rest of the machine (#392). ADR numbers above refer to agent-skills' corpus, except ADR-0166 and ADR-0168, which are this repo's imports of that corpus's 0012 and 0026.
