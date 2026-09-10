# Hook channel behaviour: identity, refusal reach, and the edit-time router

Unprompted: no issue preceded this note

Recorded 2026-08-31. The measurements formerly carried by ADR-0166's and ADR-0015's bodies,
moved here when both were re-admitted: ADR-0166 kept its ruling (hooks self-identify) as a
constraint and shed its evidence; ADR-0015 and ADR-0016 were judged implementation
measurements rather than constraints and are now notes pointing here.

## From ADR-0015: the vendored test fires as an edit-time router


Recorded 2026-07-31. Resolves [#25](https://github.com/collod873/agent-skills/issues/25).

[ADR-0010](0010-vendored-forked-local-only.md) put its test, *is upstream's file still the base you
are editing, or is it now a source you are overriding?*, in `UPSTREAM.md` prose, and named the hole
in the same breath: `/sync-skills` reads the manifest at **sync** time, long after the edit, and
prose must be *sought*, never fired. A rule that is right and never reached is the silent-failure
shape ADR-0010 exists to close.

We decided: **the test fires as a machine-global `PreToolUse`/`Edit|Write` hook that injects a
question on `additionalContext`, reads its roster out of `UPSTREAM.md`, and never blocks.**

## The rung: prose was already tried, and this is the record of it failing

The determinism ladder asks for the least power that **actually fires**. Two of the three candidate
rungs cannot fire at all, which takes them off the ladder rather than placing them low on it.

**A `CLAUDE.md` line, rejected, because it is already there and it already failed.** `CLAUDE.md:8-9`
has said *"Read it before editing anything under a skill that upstream also ships"* since commit
`00a8918` on 2026-07-28. ADR-0010 was recorded on 2026-07-29, **a day later**, and its Consequences
still read *"Nothing routes anyone to this test at the moment they edit a vendored skill."* The rung
was occupied when the hole was filed. Proposing it now is proposing the thing under measurement.

It has a second, harder failure that the first one masks. A project's `CLAUDE.md` loads when that
project is the working directory. `~/.claude/skills/*` is symlinks into this tree, so an edit to
`wayfinder/SKILL.md` routinely arrives while the session is standing in some *other* repo, and this
repo's `CLAUDE.md` is then never loaded at all. The rung is not merely weak on that path; it is
absent.

**A sentence in the skills' own text, rejected, because the timing is inverted.** A skill's `SKILL.md`
is read when the skill is **invoked**. Editing `wayfinder/SKILL.md` does not invoke `/wayfinder`.
The one moment the sentence must reach someone is the one moment nothing reads it.

**Project-scoped registration in `.claude/settings.json`, rejected on the `CLAUDE.md` failure
exactly.** Project settings load with the project. The symlinked-edit-from-elsewhere path is the case
that makes the router worth building, and project scope is silent on it.

**Chosen: a machine-global `PreToolUse`/`Edit|Write` command hook**, in chezmoi's
`~/.claude/settings.json`, from a symlink into this repo's `hooks/`, the install shape
[ADR-0005](0005-the-close-gate-is-a-pretooluse-command-hook.md)'s close gate already uses. Global
registration is what survives the symlink; it costs one interpreter start on every edit in every
project, which [ADR-0166](0012-hooks-sharing-an-event-self-identify.md) measured at **+0.1 ms**
marginal because matching hooks spawn in parallel. Outside a skills repo it exits silently on a path
test.

`PreToolUse` rather than `PostToolUse` for a reason the ticket stated: the question is only useful
*before* the editor knows whether the edit is a delta or an override. Asked afterwards it is a
review, not a route.

## The channel, measured, and it extends ADR-0166's ceiling

ADR-0166 mapped three channels on `PreToolUse` and found `permissionDecisionReason` **raced**: under
contention exactly one hook's reason survives, nondeterministically, while every `systemMessage`
lands intact. It measured the *refusal* channels only. A router does not refuse, so its channel was
unmeasured.

Measured now, on the existing harness (`docs/research/harness/hooks-per-event/`, new `ctx` behaviour
and `Edit|Write` arm), real headless sessions, `--include-hook-events` **off** so a diagnostic echo
cannot be mistaken for delivery:

| Scenario | Edit ran? | What reached Claude |
|---|---|---|
| one hook injects | yes | its `additionalContext`, **verbatim** |
| injector beside a silent hook | yes | its `additionalContext`, verbatim |
| two hooks both inject | yes | **both**, verbatim, in both runs and a third repeat |

The text arrives labelled `PreToolUse:Write hook additional context:` and the model treats it as a
system reminder, in the first run, before the prompt was changed to ask for quotation, Haiku's
thinking read *"there's a system reminder from a PreToolUse:Write hook"* and then weighed obeying it
against the user's instruction. Delivery is not inferred from the model quoting on request; it was
visible in reasoning that had no reason to mention it.

> **`additionalContext` is a per-hook channel, like `systemMessage`, not a raced one, like
> `permissionDecisionReason`.**

That is the finding ADR-0166's ceiling deferred, for the non-refusing half of the event. It is what
makes a router safe to register beside `credential-scan.py`, which already occupies
`PreToolUse`/`Edit|Write`: neither can silence the other.

**No `systemMessage`.** ADR-0166's rule binds a hook that **refuses** on a shared event, and this one
never does. The channel is available and deliberately unused: a `systemMessage` renders to the human
on every fire, and a session editing one skill produces a run of identical terminal warnings. Noise
is how a hook nobody disables becomes a hook everybody ignores. The self-identification the rule is
*for* is kept: the injected text opens with `vendored-router:`, because the harness labels the event
but not which of the event's hooks spoke.

**It never blocks.** ADR-0010's test has **two correct answers**, and which one applies is a judgment
about the edit that the hook cannot make from a file path. A gate that cannot know the right answer
may only ask. This is also why `permissionDecision: "ask"` was not used: it spends a human interrupt
on a question the human is not the one answering.

## What it says

Delivered as the question, per the ticket's requirement that the router carry ADR-0010's *test*
rather than a status:

```
vendored-router: `wayfinder/SKILL.md` is in `wayfinder`, a skill upstream also ships.

Before you write it, apply ADR-0010's test: **is upstream's file still the base you are editing,
or is it now a source you are overriding?**

- **Editing** it -> `wayfinder` stays *vendored*, and a manifest row lands in `UPSTREAM.md` in
  the same commit as this edit: the file, what the delta means, and a marker that must hit
  after every sync. A deletion carries a compensating addition; a positive marker cannot
  prove a clause stayed deleted.
- **Overriding** it -> `wayfinder` becomes *forked*: move it to `UPSTREAM.md`'s forked table
  with the baseline SHA. No marker, never re-applied, still reported.

If upstream has no counterpart for `wayfinder` at all, the manifest is wrong; add it to
`UPSTREAM.md`'s local-only list and this stops.
```

The status (*this file is vendored*) is deliberately **not** the message. A status invites
acknowledgement; the question has a consequence attached to each answer, and each consequence names
the artifact it costs. The last paragraph is the escape hatch that keeps a false fire cheap; see
below.

## What it matches: the manifest reads itself

The hook resolves the edited path to a repo root by walking up to a directory holding `UPSTREAM.md`,
then reads that manifest at hook time. The roster is a **subtraction**: a skill directory fires
unless the manifest lists it as local-only or forked.

Subtraction is forced by the manifest's own shape. There is no explicit vendored roster; a vendored
skill carrying *zero* delta (`ask-matt` today) appears in no table at all, so a positive read of the
rows would miss exactly the skills whose first delta is about to be written.

**Rejected: a hardcoded path prefix or name list in the hook.** This is
[ADR-0006](0006-the-contract-is-a-thin-invocation-layer.md)'s two-copies question, and the second
copy drifts **silently in both directions**: a newly forked skill keeps being asked a question it has
permanently answered, and a newly vendored one is never asked at all. Neither drift has a grep that
catches it, which is the same false-green ADR-0010 was written against.

**Verified against the live manifest today**: 37 skill directories, minus 12 local-only, minus 2
forked, leaves 23, and all 23 have a counterpart in upstream's `skills/` tree, checked against
`mattpocock/skills` HEAD. The subtraction currently has **zero** false positives.

**An undeclared skill directory fires, deliberately.** A directory the manifest names nowhere is
precisely the manifest-honesty gap, and the message's last paragraph converts the fire into the
correct fix: add it to the local-only list, and the router goes quiet for good. The alternative, a
silent default, buys quiet by hiding the one condition worth surfacing.

**Degraded manifest fails open.** If neither the local-only nor the forked heading is found, or the
file cannot be read, the hook exits silently. A reader that does not recognise the document would
otherwise nag all 37 directories at once, and a router whose failure mode is mass noise gets
uninstalled before it is debugged.

## Where it stays silent

The four false-fire cases the ticket named, each resolved to fire or not fire, each with a case in
`hooks/test_vendored_router.py`:

| Case | Verdict | How |
|---|---|---|
| Edit arrives through `~/.claude/skills/<skill>/…` | **fire**, once | `Path.resolve()` before matching; the state key is the real path, so the same file reached by both paths asks once |
| Local-only skill | **silent** | named in the manifest's local-only list |
| Forked skill | **silent** | named in the forked table; the question is permanently answered, and nothing is at risk of being lost |
| Non-skill file under the tree (`docs/`, `hooks/`, `CONTEXT.md`, `UPSTREAM.md` itself) | **silent** | a directory is a skill only if it holds `SKILL.md`; a root-level file has no skill component |
| Path outside any skills repo | **silent** | no ancestor holds `UPSTREAM.md` |

**Once per skill per session.** The test is a question you answer once about an edit, not a property
of each keystroke; a session writing eight edits into `wayfinder/SKILL.md` has answered it after the
first. State is a stamp file under the temp directory keyed on `session_id` plus the resolved skill
path. A session with no `session_id` fires every time, and with nowhere to record an answer, asking
twice beats going quiet.

## Ceiling

- ✅ `additionalContext` reaches Claude verbatim on `PreToolUse` and survives contention per-hook.
  three scenarios, repeated runs, diagnostic echo disabled.
- ✅ The full FIRE/SILENT matrix, malformed input, degraded manifest, and the live manifest are a
  45-case regression harness beside the hook.
- ✅ Verified end to end through the real chezmoi registration: a headless session writing into a
  fixture skill tree received the question verbatim.
- ⚠️ **The router asks; it cannot check the answer.** Nothing verifies that a manifest row actually
  landed in the commit. The gap ADR-0010 named is now *fired* rather than *sought*, which is a
  strictly smaller gap, not a closed one.
- ⚠️ The roster is honest only while the manifest is. A skill wrongly listed as local-only is silent
  forever, and no measurement catches it.
- ⚠️ The local-only roster is read as *every backticked token in that section*. Today that pulls in
  four prose artifacts (`~/.claude/skills`, `hooks/`, …) which cannot collide because no directory
  name contains `/` or `~`, but a future sentence there naming a **vendored** skill in backticks
  would silence it, quietly. The hazard is format-shaped, not eliminated.
- ❌ The model may weigh the injected question against a competing user instruction and drop it;
  first harness run is a recorded instance of exactly that. Injection guarantees delivery, never
  compliance.

## Consequences

**ADR-0010's open consequence is discharged**, and ADR-0166's ceiling is half-lifted: the
non-refusing channel on `PreToolUse` is now measured. The refusal channels on **Post** events remain
untested; [#26](https://github.com/collod873/agent-skills/issues/26) still owns that.

**`PreToolUse`/`Edit|Write` is now a shared event with a live second occupant.** `credential-scan.py`
refuses there with a bare `exit 2` and no `systemMessage`, so it violates ADR-0166's rule the moment
this hook ships, the same defect ADR-0166 found in `validate-bash.py`, on a different event, and it
is not fixed here.

**The harness gained an `Edit|Write` arm and a non-blocking `ctx` behaviour**, so the next
"what does the harness do when a hook injects…" question is minutes of work.

## From ADR-0016: post events' refusal channels are per-hook, not raced


Recorded 2026-07-31. Resolves [#26](https://github.com/collod873/agent-skills/issues/26).

[ADR-0166](0012-hooks-sharing-an-event-self-identify.md) mapped three channels: the aggregated
decision, a raced `permissionDecisionReason`, and a per-hook `systemMessage`, but measured only
`PreToolUse`, where refusal rides `permissionDecision`. Its Ceiling flagged the gap explicitly:
*"Measured on `PreToolUse` only. Post events refuse through `decision: "block"` + `reason` and have
no `permissionDecision`; whether their channels behave the same is untested."*
[ADR-0015](0015-the-vendored-test-fires-as-an-edit-time-router.md) later measured the non-refusing
`additionalContext` channel on `PreToolUse` and named the same gap again on its way out: *"The
refusal channels on **Post** events remain untested; #26 still owns that."* This settles it, on the
same harness, against the standing inventory the ticket named: `post-edit-validate.py` and
`credential-scan.py` on `PostToolUse`/`PreToolUse Edit|Write`, `circuit-breaker.py` on every
`PostToolUse`, and `log-stop-failure.py` on `StopFailure`.

## Method

`docs/research/harness/hooks-per-event/` gained a `PostToolUse` arm rather than a new harness:
`stub_hook.py`'s new `block` behaviour emits Post's refusal shape: top-level `decision: "block"` +
`reason` (`REFERENCE.md:78`), not `hookSpecificOutput.permissionDecision`, plus the same
`systemMessage` every other behaviour carries, so one run answers whether the self-identification
rule's *channel* still needs defending. `drive.py`'s `POST_ARM` registers the stub on
`PostToolUse`/`Bash` instead of `PreToolUse`/`Bash`; the command has already run by the time the hook
fires, so the prompt cannot ask Claude to obey an injected instruction the way `EDIT_ARM` does.
there is nothing left to obey. It asks Claude to quote every hook message back verbatim instead.

That quoting requirement turned out to be load-bearing, not cosmetic. Post's message has no discrete
stream event of its own, unlike `PreToolUse`'s `tool_result`, which the raced reason rides, so
whether it was delivered can only be read off whether the model *mentions* it. The first sweep used
the unprompted `PROMPT` (reply `DONE`, nothing else) and got inconsistent results: a byte-identical
`P3-two-blocks` config surfaced both tags on one run, neither on the next, both again on a third.
not because delivery changed, but because nothing asked the model to report it and Haiku's thinking
did or didn't narrate the reminder unprompted. Switching to a prompt that requires quoting (mirroring
`EDIT_ARM`'s fix for the identical problem in ADR-0015) made every subsequent run consistent: 3/3 for
`P3-two-blocks`, 3/3 for `P4b-exit2-races-block`, across both hook orderings. `HOOKTEST_NO_HOOK_EVENTS=1`
ran throughout, so the diagnostic `hook_response` echo (ADR-0166's caveat) cannot be mistaken for
delivery. For the human channel, two scenarios were also run with `--session-id` and
`--setting-sources ""` but *without* `--no-session-persistence`, reading the persisted transcript at
`~/.claude/projects/<cwd-slug>/<id>.jsonl` the way ADR-0166's original measurement did.

## Finding 1: Post's "block" cannot gate; "refuses" means something narrower there

`REFERENCE.md:7-12` already states the shape (`Blocks? ✗ side-effects only`); this is the
confirmation. **`command actually executed: True` in every one of the seven scenarios run**.
single `block`, two `block`, `block` racing `exit2` in both orders, two `exit2`, and `block` beside a
silent hook. A `decision: "block"` on `PostToolUse` cannot undo a tool call that has already
completed, so ADR-0166's question, *"what does the harness do when two hooks both refuse?"*, does
not have a gating answer to give on this event. What it has instead is a **feedback** answer: does
the reason reach Claude, and does it reach the human. Those are Findings 2 and 3.

One consequence worth naming: in `P6-block-beside-silent`'s first (unprompted) run, Haiku's final
reply read *"the hook blocked the command... preventing execution"*, a plainly wrong read of what
`block` did, produced by a refusal-shaped message on an event that cannot refuse. The label the CLI
attaches (`hook blocking error`, see below) invites exactly that misreading.

## Finding 2: the reason/stderr channel does not race

ADR-0166's central hazard was that `permissionDecisionReason` is a **single slot**: under
contention, exactly one hook's reason reaches the `tool_result`, nondeterministically. `PostToolUse`
has no `tool_result` to race over; the persisted transcript shows why. Both `decision: "block"`'s
`reason` and bare `exit2`'s stderr land as their own `hook_blocking_error` **attachment**, one per
hook, distinct from the `hook_system_message` attachment:

```json
{"attachment": {"type": "hook_blocking_error", "hookName": "PostToolUse:Bash",
  "blockingError": {"blockingError": "REASON_A: block from A", "command": "..."}}}
{"attachment": {"type": "hook_blocking_error", "hookName": "PostToolUse:Bash",
  "blockingError": {"blockingError": "REASON_B: block from B", "command": "..."}}}
```

Every scenario's final reply quoted every hook's message, both orderings, repeated:

| Scenario | Hooks | Claude quoted |
|---|---|---|
| `P2-single-block` | `block` | its `reason` |
| `P3-two-blocks` | `block` + `block` | **both** reasons, 3/3 runs |
| `P4-block-races-exit2` | `block` + `exit2` | both, `reason` and stderr |
| `P4b-exit2-races-block` | `exit2` + `block` | both, 3/3 runs, either order |
| `P5-two-exit2` | `exit2` + `exit2` | both stderr messages |
| `P6-block-beside-silent` | `block` + `pass` | only the speaking hook's `reason`; the silent hook contributed nothing, on any channel |

**Nothing is discarded, and nothing is nondeterministic.** `reason` and stderr behave like
`systemMessage`: a per-hook channel, not like `permissionDecisionReason`. There is no
"most-restrictive-wins" aggregation either, because there is no decision left to aggregate: each
`hook_blocking_error` is additive, not a contest with a winner.

## Finding 3: `systemMessage` is still per-hook, as on `PreToolUse`

The persisted transcript carries one `hook_system_message` attachment per hook that emitted one,
same shape ADR-0166 found on `PreToolUse`:

```json
{"attachment": {"type": "hook_system_message", "content": "SYSMSG_A", "hookName": "PostToolUse:Bash"}}
{"attachment": {"type": "hook_system_message", "content": "SYSMSG_B", "hookName": "PostToolUse:Bash"}}
```

Confirmed on two configurations (`P3`-shape, `P4b`-shape). Consistent with `exit2`'s and JSON
output's mutual exclusivity (`REFERENCE.md:82`): the `exit2` hook in `P4b`'s transcript produced a
`hook_blocking_error` but no `hook_system_message`; an `exit2`-only hook is silent to the human on
Post exactly as it is on Pre, for the same structural reason.

## Does the rule transfer?

**The practice is harmless to keep; the hazard it defends against does not exist on this event.**
ADR-0166's rule, *state refusal on `systemMessage`, don't rely on the raced reason alone*, exists
because `permissionDecisionReason` races on `PreToolUse`. Finding 2 shows Post's analogous channel,
`reason`/stderr via `hook_blocking_error`, **does not race**: every hook's message reaches Claude,
unconditionally, independent of `systemMessage`. A Post hook that skips `systemMessage` still gets
its `reason` to the model reliably, the failure mode the rule was written to prevent cannot occur
there.

What does **not** change is the human channel: `systemMessage` is still the only channel proven to
reach the human (`hook_blocking_error` is a Claude-facing attachment; nothing here established a
user-visible rendering of it), and an `exit2`-only hook is still silent to the human on Post exactly
as it was on Pre. So the rule's *literal text*, "must state its refusal in a `systemMessage`",
remains good practice for the audience it was written for, but its *justification* is
event-specific: on `PreToolUse` it prevents a raced reason from reaching neither Claude nor the
human; on `PostToolUse` there is no race to prevent, only the same silent-to-the-human gap `exit2`
always had.

## Per-pair redundancy across the standing inventory

Redundancy, two hooks doing overlapping work or contending for the same channel, is only a live
question for a pair that shares an **event**; two hooks on different events run sequentially across
different calls and cannot contend for anything. Judged pair by pair across the four hooks the
ticket named:

| Pair | Shares an event? | Verdict |
|---|---|---|
| `post-edit-validate.py` (`PostToolUse`/`Edit\|Write`) × `circuit-breaker.py` (`PostToolUse`/`""`, matches all tools) | **Yes**: both fire on every Edit/Write | **Not redundant, and not colliding.** `circuit-breaker.py`'s `PostToolUse` branch resets a counter and returns with **no `print` at all** on success, so it occupies zero channels. `post-edit-validate.py` is the only one of the pair that ever speaks (`additionalContext`, a syntax error). This is the shape `P6-block-beside-silent` measured directly: a silent hook contributes nothing to any channel, so there is nothing for the speaking hook to contend with. The issue's "shared without incident" observation is not luck; it follows from one side never emitting output. |
| `credential-scan.py` (`PreToolUse`/`Edit\|Write`) × any of the other three | No, the other three are all on `Post*`/`Stop*` events | **Not applicable.** `credential-scan.py` runs and resolves before the tool executes; the others run after (or on a different lifecycle entirely). Sequential phases of the same call, never concurrent, so this ADR's and ADR-0166's contention question doesn't reach them. (`credential-scan.py`'s own live collision is with `vendored-router.py` on `PreToolUse`/`Edit\|Write`, already judged in ADR-0015, outside this ticket's Post scope.) |
| `post-edit-validate.py` × `credential-scan.py` | No (`Post` vs `Pre`) | **Not applicable**, same reasoning, and not redundant in purpose either: one blocks a secret from landing, the other catches a syntax error after a (secret-free) write lands. Complementary, not overlapping. |
| `post-edit-validate.py` × `log-stop-failure.py` | No (`PostToolUse` vs `StopFailure`) | **Not applicable.** Unrelated purposes (syntax check vs. API-error logging) on top of not sharing an event. |
| `circuit-breaker.py` × `log-stop-failure.py` | No (`PostToolUse`/`PostToolUseFailure`/`SessionStart` vs `StopFailure`) | **Not applicable.** Distinct lifecycle points; a `StopFailure` is not a tool failure. |
| `credential-scan.py` × `log-stop-failure.py` | No | **Not applicable.** |

Of six pairs, five are cleared by construction: different events, never concurrent, nothing to
contend for. The one live pair was cleared by reading `circuit-breaker.py`'s source: its
`PostToolUse` branch is a silent state reset, confirmed against the harness's own model of what a
silent co-hook does to a speaking one.

## Ceiling

- ✅ `command actually executed: True` on every Post scenario, so `decision: "block"` cannot gate an
  already-completed tool call, matching `REFERENCE.md`'s catalog and making concrete what "refuses"
  means on this event.
- ✅ The reason/stderr channel (`hook_blocking_error`) is per-hook, not raced: seven scenarios, both
  hook orderings, repeated runs, both the stream (quoting prompt) and the persisted transcript agree.
- ✅ `systemMessage` (`hook_system_message`) is per-hook on Post, same as ADR-0166 found on Pre.
  confirmed in the persisted transcript on two configurations.
- ✅ The one live same-event pair in the standing inventory (`post-edit-validate.py` ×
  `circuit-breaker.py`) is cleared: one side never emits on the shared path.
- ⚠️ **Only `Bash` was driven on the Post side.** `POST_ARM` reuses `BASH_ARM`'s matcher; an
  `Edit|Write`-triggered `PostToolUse` pair (the inventory's actual live case) was judged from
  `circuit-breaker.py`'s source, not driven through the harness on that specific tool. The source
  reading is unambiguous (no `print` on that path), but it is code-reading, not a harness run, for
  that one cell.
- ⚠️ The unprompted-vs-quoting-prompt gap (README) means any *future* Post scenario built on
  `PROMPT` instead of `POST_PROMPT` will undercount delivery the same way this investigation's first
  sweep did. The harness now defaults new Post scenarios to `POST_ARM`, which carries the fix, but
  nothing enforces using it.
- ❌ Whether `hook_blocking_error` ever renders to the **human** (not just to Claude) was not
  measured; only `hook_system_message`'s transcript presence was checked against a human-facing
  channel in ADR-0166's original work. A hook relying on `reason` alone to inform *the user* is
  unverified, not cleared.

## Consequences

**ADR-0166's deferred Ceiling item is discharged, and ADR-0015's pointer to #26 is resolved.** The
self-identification rule's *practice* survives unchanged; its *justification* is now known to be
`PreToolUse`-specific, because Post's reason channel was never the raced one.

**The standing inventory's one live same-event Post pair is cleared, in writing, rather than resting
on "shared without incident."** `post-edit-validate.py` and `circuit-breaker.py` can safely continue
sharing `PostToolUse` because `circuit-breaker.py`'s success path is silent, a fact now checked
against the harness's own silent-hook model (`P6`), not merely observed as an absence of complaints.

**The harness gained a `PostToolUse` arm, a `block` behaviour, and a lesson about prompting for
delivery on events with no discrete message-carrying stream event**, reusable the next time a
"what does the harness do on \<event\>" question needs answering.

---

Moved from collod873/agent-skills on 2026-09-10 (claude-workflow#427), with the rest of the machine (#392). ADR numbers above refer to agent-skills' corpus, except ADR-0166 and ADR-0168, which are this repo's imports of that corpus's 0012 and 0026.
