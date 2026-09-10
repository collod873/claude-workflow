# Skill & Hook Design Principles

_Studied 2026-07-28. Synthesis of five skills and their disclosed reference files._

> **Status: unmaintained snapshot.** Filed 2026-07-28 by
> [#3](https://github.com/collod873/agent-skills/issues/3). This is a study of the source skills as
> they read on the date above, not a specification over them; nothing diffs it against them again.
> Where it and a source skill disagree, **the skill wins**. The one synthesis here that is not in
> any source, the determinism ladder, is being decided as vocabulary by
> [#10](https://github.com/collod873/agent-skills/issues/10); until then it is a proposal, not a
> decision.

**Sources**
- `writing-great-skills`: `SKILL.md`, `GLOSSARY.md`
- `writing-great-hooks`: `SKILL.md`, `REFERENCE.md`
- `codebase-design`: `SKILL.md`, `DEEPENING.md`, `DESIGN-IT-TWICE.md`
- `improve-codebase-architecture`: `SKILL.md`, `HTML-REPORT.md`
- `code-review`: `SKILL.md`

Physical locations: `~/.agents/skills/` (symlinked into `~/.claude/skills/`), except `writing-great-hooks` which lives directly in `~/.claude/skills/`.

---

## 0. The root idea

**A skill exists to wrangle determinism out of a stochastic system.**

The root virtue is **predictability**: the agent taking the same *process* every run, not producing the same *output*. A brainstorming skill should predictably diverge; its tokens vary, its behaviour doesn't.

This distinction is the whole foundation. Every technique in all five skills is a lever on process-predictability. Token cost and maintainability are *symptoms* of it, not rival goals you trade against it.

### The determinism ladder

Implied across the set; pick the lowest rung that gives a real guarantee:

| Rung | Mechanism | Guarantee |
|---|---|---|
| Permission `deny` rule | Harness refuses the call | Hard lock |
| Hook | Harness *runs* code, same event every session | Guarantee, but only tightens, and can't loosen past permission rules |
| Skill | Instructions loaded into context on invocation | Strong steer |
| CLAUDE.md line | Instruction the model may ignore | Request |

`writing-great-hooks` states the jump explicitly: "A CLAUDE.md line is a request the model may ignore. A **hook** is code the harness *runs*. That is the whole reason hooks exist: they convert prompt-and-hope into a **guarantee**."

Corollary from the hooks skill: a safety hook standing alone is **defense-in-depth, not a lock**. For true enforcement, back it with a permission `deny` rule.

---

## Part 1: Cross-cutting principles

### 1. Vocabulary is the primary lever

Three of the five skills are, structurally, glossaries. This is not incidental.

**The mechanism: leading words.** A **leading word** (Leitwort) is a compact concept already living in the model's pretraining that the agent thinks *with* while running the skill. Examples: *lesson*, *fog of war*, *tracer bullets*, *seam*, *red*.

It encodes a behavioural principle in the fewest possible tokens by recruiting priors the model already holds. Repeated as a **token, never as a sentence**, it accumulates a distributed definition across the skill and anchors a whole region of behaviour.

**It pays twice:**
- In the body it anchors **execution**: the agent reaches for the same behaviour every time the word appears.
- In the description it anchors **invocation**: when the same word lives in your prompts, your docs, and your codebase, the agent links that shared language to the skill and fires it more reliably.

So: *word a description with the leading words you actually use when you want the skill.*

**Coining your own works only if you define it clearly**: but a made-up word recruits no priors, so you pay in definition tokens what a pretrained word gives free. Reach for an existing word first.

**Enforcement via `_Avoid_` lists.** Every glossary term ships with banned near-synonyms:

- Say **seam**, not *boundary* (overloaded with DDD's bounded context)
- Say **module**, not *unit / component / service*
- Say **interface**, not *API / signature* (too narrow: they mean only the type-level surface)
- Say **predictability**, not *consistency / reliability / robustness*

`improve-codebase-architecture` enforces this downstream: "Use these terms exactly in every suggestion; don't drift into 'component,' 'service,' 'API,' or 'boundary.'"

**Refactoring target.** `writing-great-skills` instructs you to actively hunt for passages that collapse into a leading word:
- "fast, deterministic, low-overhead" → ***tight*** (a *tight* loop)
- "a loop you believe in" → ***red*** (converts a fuzzy gate into a binary observable state)

"Assume every skill is carrying restatements that leading words retire; go find them."

### 2. Name every failure mode, and pair it with its cure

Both `writing-great-skills` and `writing-great-hooks` end in a symptom→diagnosis catalog. In `GLOSSARY.md`, each failure mode is deliberately filed *beside the lever that cures it*, tagged `_failure mode_`.

Why: naming a failure is what makes it recognizable mid-run. An unnamed failure is invisible; a named one is a checkable condition.

### 3. Route first, disclose the rest

`writing-great-hooks` opens with three branches (Author / Test / Audit) before any content. `codebase-design` pushes `DEEPENING.md` and `DESIGN-IT-TWICE.md` behind pointers. `improve-codebase-architecture` pushes the entire HTML scaffold out.

**The disclosure test is branching:** inline what *every* branch needs; push behind a pointer what only *some* branches reach.

**The pointer's wording, not its target, decides when and how reliably the agent reaches the material.** A must-have target behind a weakly worded pointer is a variance bug. Fix the wording first; pull the material back inline only if sharpening fails.

**Progressive disclosure is not primarily a token optimisation**: it is how the information hierarchy is protected. When a skill has steps, in-file reference that should be disclosed *buries* them and turns attending to them into a coin flip.

### 4. Completion criteria carry two independent axes

The **completion criterion** is the condition that tells the agent a unit of work is done. Two properties make it a lever rather than a nicety:

| Axis | Question | Resists | Needs steps? |
|---|---|---|---|
| **Clarity** | Can the agent tell done from not-done? | Premature completion | Yes, it's a between-steps failure |
| **Demand** | How much does it require? | Thin legwork | No, it binds flat reference too |

- Clarity example: "understanding reached" (vague, gives way) vs "all four case types run and pass" (checkable, holds).
- Demand example: "every modified model accounted for" forces thorough work where "produce a change list" does not.

Demand is *not* step-bound, which is how a skill with no steps still carries an exhaustiveness bar ("every rule applied"). That's what drives a flat-reference skill like `code-review` to cover all twelve smells.

**The strongest criteria are both checkable and exhaustive.**

`writing-great-hooks` uses literal `Completion criterion:` lines inside steps:
- Authoring step 2: "for every path the hook can take, name the exit code *and* which channel carries the message. No path left implicit."
- Testing step 4: "all four case types run and pass, and the degraded-env case confirms fail-open vs fail-closed matches intent."

### 5. Isolate contexts to prevent contamination

`code-review` runs Standards and Spec as **parallel sub-agents** "so they don't pollute each other's context," then explicitly forbids merging:

> Do **not** merge or rerank findings; the two axes are deliberately separate. Don't pick a single winner across axes; that's the reranking the separation exists to prevent.

The reason is stated as a truth table:
- Follows every standard, implements the wrong thing → Standards pass, Spec fail.
- Does exactly what the issue asked, breaks conventions → Spec pass, Standards fail.

One axis passing must not mask the other failing.

`DESIGN-IT-TWICE.md` uses the same move for generation instead of evaluation: 3+ parallel sub-agents, each given a **deliberately opposed** constraint (minimize the interface / maximise flexibility / optimise for the common caller / ports-and-adapters), each required to produce a *radically different* interface.

**Separation is the product, not an implementation detail.**

Note the hiding caveat from `GLOSSARY.md`: hiding only works across a **real context boundary** (a user-invoked hand-off or a subagent dispatch). An inline model-invoked call leaves everything in context and clears nothing.

### 6. Judge against intent, not observed behaviour

The hook test rubric is written **from source, before running anything**:

> The rubric encodes **intent, not current behavior**: each case is what the hook *should* do, decided from its source before you run anything. When a run shows a FAIL, that FAIL *is* the product: a real bug captured as a test. Never flip an expected value to match what the hook does; that turns the rubric into a **characterization test** and erases the finding.

This is the single most transferable rule in the set. The pressure to make the suite green by editing expectations is exactly the pressure that destroys the suite's value.

`code-review`'s Spec axis is the same principle applied to code: judge the diff against what was *asked for*, not against what shipped.

### 7. Don't build the seam until something varies across it

> **One adapter means a hypothetical seam. Two adapters means a real one.**

A single-adapter seam is just indirection. Don't introduce a port unless at least two adapters are justified (typically production + test).

The same anti-speculation rule recurs across all five skills under different names:

| Skill | Form |
|---|---|
| `codebase-design` | One adapter = hypothetical seam |
| `code-review` | *Speculative Generality*: abstraction added for needs the spec doesn't have → delete it, inline back until a real need shows |
| `improve-codebase-architecture` | "Scope before you scan: YAGNI" |
| `writing-great-skills` | "Each cut spends one of the two loads, so split only when the cut earns it" |
| `writing-great-hooks` | "Pick the **least power** that works" |

### 8. Least power

Gate at `PreToolUse` only if you must stop something; otherwise react at `PostToolUse`. Scope the matcher tight; an unscoped hook runs on *everything*.

**Choosing a Post event to block is named as the #1 place hooks go wrong.** A Post event only *reacts*: the action already happened; it can log, format, or inject context, never undo.

### 9. Prompt the positive

**Negation** is a named failure mode:

> Steering by prohibition backfires: *don't think of an elephant* names the elephant and makes it *more* available, not less. The negation is a weak modifier the strongly-activated concept overruns, so the ban half-reads as an instruction to do the thing.

"Never write verbose comments" → verbosity is the pattern the agent has just read. Cure: state the target behaviour ("write one-line comments") so the banned one is never spoken.

A prohibition earns its place only as a hard guardrail on a behaviour you cannot phrase positively, and even then pair it with the positive target so attention lands on what to do.

### 10. Scope to what's live

- `improve-codebase-architecture` walks `git log --oneline` to find hot spots and lets those paths pull attention first. Rationale: "Deepening a module pays off by making future changes to it easier", so weight recently-changed code. If changes are scattered with no clear hot spot, widen the net.
- `code-review` reviews only `git diff <fixed-point>...HEAD` (three-dot, against the merge-base).
- `writing-great-skills`' **relevance** check asks of every line: does it still bear on what the skill does?

### 11. Record rejections so they don't recur

- `codebase-design` has a literal **"Rejected framings"** section, recording that depth-as-lines-ratio (Ousterhout) was considered and dumped, and why (it rewards padding the implementation).
- `improve-codebase-architecture` offers an ADR when a candidate is rejected, but only conditionally: *"Only offer when the reason would actually be needed by a future explorer to avoid re-suggesting the same thing; skip ephemeral reasons ('not worth it right now') and self-evident ones."*
- It also treats existing ADRs as decisions "this command should not re-litigate," and requires a candidate that contradicts one to be flagged with justification for reopening.

**Not every "no" is worth persisting.** Persist the load-bearing ones.

### 12. End opinionated

- `DESIGN-IT-TWICE.md`: "give your own recommendation: which design you think is strongest and why… Be opinionated: the user wants a strong read, not a menu."
- `improve-codebase-architecture`: report ends with a **Top recommendation** section.
- `code-review`: one-line summary naming the worst issue *within each axis*.

A survey that refuses to rank is work handed back to the user.

### 13. Fail deliberately, in the direction that matches the stakes

From hooks, but general:

- **Convenience** work (formatter, logger, notifier) → **fail open**. Append `|| true`, guard missing tools. A broken convenience hook must never wedge the session.
- **Safety** work (block a destructive command, protect a file) → **fail closed**. Bad input must not slip through.

"This is a deliberate choice, not a default." And it's *testable*: the degraded-env test case exists specifically to prove the failure mode is the one you intended.

### 14. Make silent things observable

> For anything that gates or can fail, add a run-log so a silent misfire is diagnosable.

`jq -c '{t: now|todate, in: .tool_input}' >> ~/.claude/<hook>.log`, cheap, exits 0, never blocks. Skip it for a trivial stable formatter; keep it while developing any real gate.

Generalized: **any mechanism that can fail quietly needs a trace, or you're debugging by guess.**

---

## Part 2: The vocabulary

### 2a. Skill vocabulary (`writing-great-skills`)

Grouped by axis, as in `GLOSSARY.md`.

#### Invocation: how a skill is reached

**Model-Invoked**: keeps its `description`, so the agent can fire it autonomously *and* other skills can reach it. The human can still type its name; model-invocation always *includes* user reach. There is no model-only state. Pays permanent **context load**.

**User-Invoked**: `disable-model-invocation: true`. Description stripped from the agent's reach; only the human typing its name can invoke it, and **no other skill can reach it**. Zero context load. The `description` field becomes human-facing: a one-line summary, trigger lists stripped.

**Description**: the machine-readable trigger, and the one context pointer a model-invoked skill is *forced* to keep loaded at all times. Its mere presence *is* the invocation axis.

**Context Pointer**: a reference held in context that names out-of-context material and encodes the condition for reaching it. The description is the top-level pointer (context window → skill); pointers to disclosed files are the same object one level down.

**Context Load**: the cost a model-invoked skill imposes on the *context window*. Always-loaded description, spending both tokens and attention. The brake on splitting into more model-invoked skills.

**Cognitive Load**: the cost a user-invoked skill imposes on the *human*: remembering which skills exist and when to reach for each. **Not a cost to minimise**: it is the price of human agency. Spend it where human judgement matters; remove it where it does not.

**Router Skill**: a user-invoked skill that names your other user-invoked skills and when to reach for each, so the human has one to remember instead of many. It can only *hint*, never fire them (they have no description). The cure for cognitive load when user-invoked skills multiply.

**Granularity**: how finely you divide skills. Two cuts:
- **By invocation**: split off a model-invoked skill when you have a distinct leading word that should trigger it, or another skill must reach it. Costs context load.
- **By sequence**: split a run of steps when post-completion steps tempt the agent to rush the step in front of it. Costs cognitive load.
- **Beware the reverse:** merging sequences exposes each step's post-completion steps to what follows, inviting premature completion.

**The decision rule:** pick model-invocation *only* when the agent must reach the skill on its own, or another skill must. If it only ever fires by hand, make it user-invoked and pay no context load.

**Description-writing rules** (a description earns even harder pruning than the body):
- Front-load the skill's **leading word**; the description is where it does its invocation work.
- **One trigger per branch.** Synonyms that rename a single branch are duplication ("build features using TDD … asks for test-first development" is one branch written twice).
- **Cut identity that's already in the body.** Keep it to triggers, plus any "when another skill needs…" reach clause.

#### Information Hierarchy: how content is arranged

The ladder, ranked by how immediately the agent needs the material:

1. **In-skill step**: an ordered action in `SKILL.md`. Primary tier.
2. **In-skill reference**: a definition, rule, or fact in `SKILL.md`, consulted on demand.
3. **External reference**: pushed out of `SKILL.md` into a separate file behind a context pointer. Spans *disclosed* reference (a sibling file like `GLOSSARY.md`, still part of the skill) through fully **external reference** (lives outside the skill system, any skill can point at it).

**Steps and reference mix freely**: a skill can be all steps (`tdd`), all reference (`code-review`, `codebase-design`, `writing-great-skills` itself), or both. Independent of invocation.

**A flat peer-set is not a smell.** Every rule of a review on one rung is a fine arrangement.

**External Reference** is the only shared home two *user-invoked* skills can use, since neither has a description, so neither can fire the other. A model-invoked all-reference skill is the other shared home (`codebase-design` is exactly this: "when another skill needs the deep-module vocabulary").

**Progressive Disclosure**: the move down the ladder. Licensed by **branching**.

**Co-location**: where the hierarchy ranks *how far down* a piece sits, co-location decides *what sits beside it* once there. Keep a concept's definition, rules, and caveats under one heading so reading one part brings its neighbours with it. Distinct from duplication: duplication repeats one meaning in two places; scattering fragments one meaning across many.

> There is no formula for the right format of a body of reference; the test is that a skill should read like **documentation written for the agent**.

**The core tension:** push too little down and the top bloats; push too much and you hide material the agent actually needs.

#### Steering: shaping runtime behaviour

**Branch**: a distinct way a skill can be invoked, so different runs take different paths through it.

**Leading Word**: see Principle 1.

**Completion Criterion**: see Principle 4.

**Legwork**: the work an agent does behind the scenes *within a single step*: reading files, exploring the codebase, digging up what it needs rather than offloading to the user. It lives *below* the step structure: never written as its own step, latent in the wording, controlled by the agent. Raised by a strong leading word (*comprehensive*, *relentless*) or a demanding completion criterion. Goes thin when that demand is missing, or when premature completion cuts the step short.

**Post-Completion Steps**: the steps that follow the current one. Visible, they pull the agent forward into premature completion; the more it sees, the stronger the tug.

#### Pruning: keeping it lean

**Single Source of Truth**: each meaning in exactly one authoritative place, so changing behaviour is a one-place edit.

**Relevance**: does the line still bear on what the skill does? A line loses relevance by never bearing on the task (mere exposition, or a branch that should be disclosed), or by going stale.

**The pruning procedure:** hunt no-ops **sentence by sentence, not line by line**. Run the no-op test on each sentence in isolation; when one fails, **delete the whole sentence rather than trim words from it.** Be aggressive: most prose that fails should go, not be rewritten.

### 2b. Design vocabulary (`codebase-design`)

**Module**: anything with an interface and an implementation. Deliberately **scale-agnostic**: a function, class, package, or tier-spanning slice.

**Interface**: *everything a caller must know to use the module correctly*: type signature, but also invariants, ordering constraints, error modes, required configuration, and performance characteristics. Much broader than "API" or "signature."

**Implementation**: what's inside. Distinct from adapter: a thing can be a small adapter with a large implementation (a Postgres repo) or a large adapter with a small implementation (an in-memory fake). Say "adapter" when the seam is the topic; "implementation" otherwise.

**Depth**: **leverage at the interface**: the amount of behaviour a caller (or test) can exercise per unit of interface they have to learn.
- **Deep** = large behaviour behind a small interface.
- **Shallow** = interface nearly as complex as the implementation.

**Seam** *(Michael Feathers)*: a place where you can alter behaviour without editing in that place; the *location* at which a module's interface lives. **Where to put the seam is its own design decision, distinct from what goes behind it.**

**Adapter**: a concrete thing satisfying an interface at a seam. Describes *role* (what slot it fills), not substance (what's inside).

**Leverage**: what callers get from depth: more capability per unit of interface learned. One implementation pays back across N call sites and M tests.

**Locality**: what maintainers get from depth: change, bugs, knowledge, and verification concentrate in one place rather than spreading across callers. Fix once, fixed everywhere.

#### Relationships

- A **Module** has exactly one **Interface**.
- **Depth** is a property of a **Module**, measured against its **Interface**.
- A **Seam** is where a **Module**'s **Interface** lives.
- An **Adapter** sits at a **Seam** and satisfies the **Interface**.
- **Depth** produces **Leverage** for callers and **Locality** for maintainers.

#### The four design principles

1. **Depth is a property of the interface, not the implementation.** A deep module can be internally composed of small, mockable, swappable parts; they just aren't part of the interface. Modules can have **internal seams** (private, used by their own tests) as well as the **external seam** at the interface. Don't expose internal seams through the interface just because tests use them.
2. **The deletion test.** Imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.
3. **The interface is the test surface.** Callers and tests cross the same seam. If you want to test *past* the interface, the module is probably the wrong shape.
4. **One adapter = hypothetical seam. Two adapters = real one.**

#### Rejected framings (recorded so they aren't re-litigated)

- **Depth as ratio of implementation-lines to interface-lines** (Ousterhout) rewards padding the implementation. Use depth-as-leverage instead.
- **"Interface" as the TypeScript `interface` keyword or a class's public methods**: too narrow.
- **"Boundary"**: overloaded with DDD's bounded context. Say **seam** or **interface**.

#### Dependency categories (`DEEPENING.md`)

The category determines how the deepened module is tested across its seam.

| # | Category | Examples | Strategy |
|---|---|---|---|
| 1 | **In-process** | Pure computation, in-memory state | Always deepenable. Merge and test through the new interface. No adapter. |
| 2 | **Local-substitutable** | PGLite for Postgres, in-memory FS | Deepenable if the stand-in exists. Seam is **internal**, with no port at the external interface. |
| 3 | **Remote but owned** | Your microservices, internal APIs | Ports & adapters. Deep module owns the logic; transport injected. In-memory adapter for tests, HTTP/gRPC for prod. |
| 4 | **True external** | Stripe, Twilio | Injected port; tests provide a mock adapter. |

#### Testing strategy: replace, don't layer

- Old unit tests on shallow modules become **waste** once tests at the deepened interface exist, so **delete them.**
- Write new tests at the deepened module's interface.
- Assert on observable outcomes through the interface, not internal state.
- Tests should survive internal refactors. **If a test has to change when the implementation changes, it's testing past the interface.**

#### Designing for testability

1. **Accept dependencies, don't create them**: `processOrder(order, paymentGateway)`, not `new StripeGateway()` inside.
2. **Return results, don't produce side effects**: `calculateDiscount(cart): Discount`, not `applyDiscount(cart): void`.
3. **Small surface area**: fewer methods = fewer tests; fewer params = simpler setup.

### 2c. The hook model (`writing-great-hooks`)

**Pin all four (five) before writing a line:**

| | What it fixes |
|---|---|
| **Event** | The lifecycle moment, and therefore the *power*. **Pre** (`PreToolUse`, `UserPromptSubmit`, `PreCompact`) can **gate**: block or rewrite. **Post** (`PostToolUse`, `Stop`, `SessionStart`) only *reacts*. |
| **Matcher** | Which occurrences fire it. Case-sensitive; non-plain patterns are **unanchored regex**. Scope to the narrowest match that does the job. |
| **Contract** | stdin JSON in, two channels out. **Exit code** is primary (`0` success, `2` block). **stdout JSON** is the rich channel, *only when the hook exits 0*. |
| **Failure mode** | Fail open vs fail closed. A deliberate choice. |
| **Type** | `command` (default), `prompt` (cheap single Claude call), `agent` (subagent that checks real repo state), `http`, `mcp_tool`. |

**The hard rules:**
- **JSON needs exit 0.** Emitting JSON *and* `exit 2` throws the JSON away.
- On `exit 2` the harness reads **stderr**, not stdout.
- **Know who reads each channel:** on `exit 2`, `PreToolUse` stderr goes to Claude; most other events' stderr goes to the user.
- When using `hookSpecificOutput`, set `hookEventName` to the event or **the whole block is silently dropped.**

**Reach for `prompt`/`agent` when the decision needs judgment rather than a regex**: a Stop hook asking a model "is the task truly done?" beats a brittle grep. Both return `{"ok": bool, "reason": str}`; the harness maps `ok` to the event's decision.

**Environment reality:** a command hook runs in a **non-interactive shell that does not inherit your login PATH/aliases/direnv.** A command that works in your terminal can hit "command not found." Use absolute paths or `${CLAUDE_PROJECT_DIR}`. Never let a shell profile echo into stdout; it corrupts your JSON.

**Testability:** a hook is a pure function of stdin → (exit code, stdout). That makes it **deterministically testable**. Feed it JSON, assert the output. Do not eyeball the script.

Drive it from **Python, never from your shell**: a hook that scans Bash commands will scan its own test payload and self-trigger:

```python
subprocess.run(["python3", "/path/to/hook"], input=payload_bytes,
               capture_output=True, timeout=10)
```

**Minimum four test cases:** happy path · the trigger · malformed (empty, missing field, bad shape) · degraded env (dependency missing, which proves the failure mode is the one you intended).

**Severity tagging:** **FN** = a missed block (security hole). **FP** = an over-block (friction).

**Save the harness** beside the hook (`~/.claude/hooks/test_<basename>.py`) so cases become a regression net, not a one-off.

---

## Part 3: Failure-mode catalogs

### 3a. Skill failure modes

| Mode | What it is | Cure |
|---|---|---|
| **Premature completion** | Ending a step before it's genuinely done; attention slips to *being done*. A between-steps failure, so it needs steps to occur. | **In order:** sharpen the completion criterion first (cheap, local). Only if it's irreducibly fuzzy *and* you observe the rush, hide post-completion steps by splitting, and only across a real context boundary. |
| **Duplication** | The same meaning in more than one place. | Single source of truth. Costs maintenance and tokens, and *inflates a meaning's prominence past its real rank*. The accidental inverse of a leading word (which repeats a token, never a meaning). |
| **Sediment** | Stale layers that settle because adding feels safe and removing feels risky. | A pruning discipline. It is the default fate of any skill without one. |
| **Sprawl** | Simply too long, even when every line is live and unique. | The ladder: disclose reference behind pointers; split by branch or sequence. Distinct from sediment (stale) and duplication (repeated). |
| **No-op** | A line the model already obeys by default, so you pay load to say nothing. | Delete, or strengthen. See below. |
| **Negation** | Steering by prohibition, which makes the banned behaviour *more* available. | Prompt the positive. |

**The no-op test is the sharpest single test in the set:** *does this line change behaviour versus the default?*

- A line can be perfectly **relevant** and still be a no-op. Relevance asks whether a line bears on the task; no-op asks whether it changes behaviour.
- The same priors that make a leading word free make a no-op worthless.
- A leading word too weak to beat the default *is* a no-op: *"be thorough"* when the agent is already thorough-ish. **The fix is a stronger word (*relentless*), not a different technique.** So the no-op test is also how you grade whether a leading word is earning its repetitions.
- **It is model-relative, not reader-relative.** Two people disagreeing over whether a line is a no-op are disagreeing about the *default*, and settle it by **running the skill, not by debate.**

### 3b. Hook failure modes (diagnose by symptom)

| Symptom | Cause |
|---|---|
| Fires but nothing happens | JSON emitted with `exit 2` (JSON needs exit 0); or `hookEventName` missing/mismatched (block silently dropped); or wrote to stdout on `exit 2`. |
| Blocks everything / wedges the session | A convenience hook that should fail open is failing closed: missing dependency or bug returns nonzero. Add `\|\| true`, guard the dep. |
| Never fires | Run `/hooks` first to confirm registration. If registered, it is a matcher miss: wrong case, unanchored regex over/under-matching, matcher on an event that ignores matchers, or wrong settings file. |
| "command not found" though it works in your terminal | Non-interactive shell doesn't inherit PATH/aliases. Use absolute path or `${CLAUDE_PROJECT_DIR}`. |
| Can't stop the action | Bound to a Post event, which only reacts. Move to the Pre event. |
| Corrupted / "JSON validation failed" | A shell profile echoes into stdout. Guard profile output to interactive shells. |
| Slows every turn | Heavy synchronous work on a hot event. Make it `async` or trim it. |
| Stop hook loops | Re-blocks without checking `stop_hook_active`. Harness force-releases after 8 blocks, but fix the check. |

**Live-debugging tools, before guessing:** `/hooks` (is it registered?) · `Ctrl+O` (per-hook line each turn) · `claude --debug-file /tmp/claude.log` or `/debug` mid-session (which hooks matched, exit codes, full stdout/stderr).

### 3c. The code smell baseline (`code-review`)

A fixed set of Fowler smells (*Refactoring*, ch.3) that applies **even when a repo documents nothing**. Two rules bind it:

- **The repo overrides.** A documented repo standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation. And skip anything tooling already enforces.

Each reads *what it is* → *how to fix*:

| Smell | Fix |
|---|---|
| **Mysterious Name**: name doesn't reveal what it does/holds | Rename; if no honest name comes, the design's murky |
| **Duplicated Code**: same logic shape in >1 hunk/file | Extract the shared shape, call from both |
| **Feature Envy**: method reaches into another object's data more than its own | Move the method onto the data it envies |
| **Data Clumps**: same few fields/params keep travelling together | Bundle into one type (a type wanting to be born) |
| **Primitive Obsession**: primitive/string standing in for a domain concept | Give the concept its own small type |
| **Repeated Switches**: same switch/if-cascade on same type recurs | Polymorphism, or one map both sites share |
| **Shotgun Surgery**: one logical change forces scattered edits | Gather what changes together into one module |
| **Divergent Change**: one module edited for several unrelated reasons | Split so each module changes for one reason |
| **Speculative Generality**: abstraction for needs the spec doesn't have | Delete; inline back until a real need shows |
| **Message Chains**: long `a.b().c().d()` navigation | Hide the walk behind one method on the first object |
| **Middle Man**: mostly just delegates onward | Cut it, call the real target direct |
| **Refused Bequest**: subclass ignores/overrides most of what it inherits | Drop inheritance, use composition |

Note the pairing with the design vocabulary: **Shotgun Surgery** is a locality failure; **Divergent Change** is a seam-placement failure; **Middle Man** is a shallow module failing the deletion test.

---

## Part 4: Each skill's distinct spine

### `writing-great-skills`
Two costs you are always spending, and you choose which:
- **Context load**: a model-invoked description sits in the window every turn.
- **Cognitive load**: a user-invoked skill means *you* are the index.

Neither is minimized. Cognitive load is explicitly "not a cost to minimise: it is the price of human agency." Spend it where human judgement matters.

Structurally: **all reference, user-invoked** (`disable-model-invocation: true`), with its full definitions disclosed to `GLOSSARY.md`. It practises what it documents.

### `writing-great-hooks`
Three branches, routed up front. Pin the four (event / matcher / contract / failure mode), then **test before you trust**: "a hook you have not driven is a guess."

Model-invoked, with a reach clause: *"Also use when another skill needs the hook-quality vocabulary."*

Notable: the audit section is a **flat checklist**: "every item is a distinct failure the hook can carry; check them all." That's the *demand* axis of a completion criterion binding flat reference with no steps.

### `codebase-design`
**Depth = leverage per unit of interface learned.** Explicitly rejects the lines-ratio definition because it rewards padding.

Model-invoked all-reference: the shared-vocabulary home two other skills point at. It's the canonical example of "a model-invoked skill whose content is all reference is one home for shared reference."

### `improve-codebase-architecture`
Scan → **visual HTML report** → grilling loop. User-invoked.

Two structural choices worth stealing:
1. **Refuses to propose interfaces before the user picks a candidate.** "Do NOT propose interfaces yet. After the file is written, ask the user: 'Which of these would you like to explore?'", a deliberate hand-off boundary that prevents the agent from running past the decision point.
2. **Side effects happen inline as decisions crystallize**: `CONTEXT.md` terms added, ADRs offered, domain model kept current *during* the conversation, not batched at the end.

It composes three other skills (`/codebase-design` for vocabulary, `/grilling` for the decision tree, `/domain-modeling` for upkeep) rather than restating them: single source of truth across skill boundaries.

Report guidance worth noting: mix Mermaid (graph-shaped: call graphs, dependencies, sequences) with hand-built divs/SVG (editorial: mass diagrams, cross-sections): "don't lean on Mermaid for everything, it'll start to look generic."

### `code-review`
Two axes, parallel sub-agents, **never merged**. Carries the smell baseline so it works on a repo that documents nothing, but the repo always overrides.

Step 1 has a guard worth generalizing: *"Before going further, confirm the fixed point resolves and the diff is non-empty. A bad ref or empty diff should fail here, not inside two parallel sub-agents."* **Validate before you fan out.**

Sub-agent prompts include a hard word budget ("Under 400 words") and paste in the baseline *in full* because "the sub-agent has no other access to it." **A sub-agent's context is not your context.**

---

## Part 5: Working checklists

### Writing or editing a skill

1. **Invocation**: does the agent (or another skill) need to reach this on its own? If not, `disable-model-invocation: true` and pay zero context load.
2. **Description** (if model-invoked): front-load the leading word; one trigger per branch; cut identity that's in the body.
3. **Shape**: steps, reference, or both? A flat peer-set is fine.
4. **Ladder**: inline what every branch needs; disclose what only some reach. Check every pointer's *wording*.
5. **Completion criteria**: checkable *and* exhaustive. Name what "done" looks like for each step.
6. **Leading words**: hunt for restatements that collapse into one pretrained token.
7. **Prune**: single source of truth; relevance pass; then the no-op test *sentence by sentence*, deleting whole sentences.
8. **Negation sweep**: rewrite every prohibition as a positive target.
9. **Verify by running it.** Disagreements about no-ops are settled by execution, not debate.

### Writing a hook

1. Pin event / matcher / contract / failure mode / type.
2. Least power: Post unless you must gate. Narrow matcher.
3. Name the exit code *and* channel for every path.
4. Choose fail-open vs fail-closed on purpose; back safety hooks with a permission `deny` rule.
5. Keep it tight; assume a bare non-interactive environment; absolute paths.
6. Add a run-log if it gates or can fail.
7. Build the four-case harness from **intent**, drive it from Python, save it beside the hook.
8. Register it in the right settings file with a `timeout`.

### Reviewing anything

1. Pin the fixed point; validate it resolves **before** fanning out.
2. Split into axes that can independently pass/fail; run them isolated.
3. Give each sub-agent everything it needs; its context is not yours.
4. Report axes separately; do not rerank across them.
5. End with the worst issue per axis and a recommendation.

---

## The five sentences worth memorizing

1. **Predictability is same process, not same output.**
2. **A leading word repeated as a token beats a paragraph explaining the concept.**
3. **Does this line change behaviour versus the default?**: and that's settled by running it, not by arguing.
4. **One adapter is a hypothetical seam; two is a real one.**
5. **Never flip an expected value to match what the code does**: that FAIL *is* the product.

---

Moved from collod873/agent-skills on 2026-09-10 (claude-workflow#427), with the rest of the machine (#392). ADR numbers above refer to agent-skills' corpus, except ADR-0166 and ADR-0168, which are this repo's imports of that corpus's 0012 and 0026.
