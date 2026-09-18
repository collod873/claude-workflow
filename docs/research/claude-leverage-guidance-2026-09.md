# What Anthropic's own guidance says Claude is strong and weak at in long-running coding automation

Researches: #655

Research for map #646, the **Charter** question: what the machine leans on Claude for, and what it
rails with code. Written 2026-09-17 against trunk `3c34748`. Facts and candidates only; no rulings.

Sources are first-party only. They are Anthropic engineering posts, code.claude.com docs,
platform.claude.com docs, one claude.com blog post by Anthropic staff, and the Opus 5 and Sonnet 5
system cards. All were fetched on 2026-09-17. Each claim cites a URL, and the sentence it rests on is
quoted. Repo evidence cites the file and its section heading.

## Summary

- **The guidance agrees on what Claude is good at.** It writes code, and it expresses control flow
  as code more reliably than as a chain of tool calls. It completes multi-file work when it gets the
  whole spec up front. It uses tests and git as ground truth, picks up state from the filesystem in a
  fresh session, and (Opus 5) reviews code with high precision. The repo's matching evidence is 29
  of 51 clean ticket-door merges (median 23 minutes) and Implement's 83% useful-run rate.
- **The guidance agrees even more on where Claude is weak, and on how to rail it:**
  - it grades its own work too kindly;
  - it declares done early;
  - it edits tests to pass;
  - it widens scope;
  - it follows prose rules only probabilistically;
  - it loses precision as context fills.

  The mitigation named most often is structural or a check, not prose: a separate judge, a
  deterministic gate, a hook or permission. The repo measured every one of these failure modes.
  Examples: 69 deleted test cases, 8 "done" tickets that failed their own criteria, 26
  contradictory rules, and a rooting rule broken in 6 of 10 slicer refusals although seven copies
  of it are taught.
- **Model-specific guidance pulls two ways on verification.** The Opus 5 prompting page says Opus 5
  verifies its own work unprompted and tells harnesses to *remove* verification steps. The Fable 5
  page says fresh-context verifier subagents beat self-critique. The Opus 5 and Sonnet 5 system
  cards list fabricated output, false completion and test editing as observed behaviour. This
  repo's Sonnet 5 stages (implementer, acceptance author) are where its false-done and
  test-deletion evidence sits.
- **Scope creep has a measured one-line prose fix.** The Opus 5 card reports that "adding a brief
  instruction to the prompt telling the model to stay within the scope of the task recovered
  performance on most of these tasks". This is the one place the guidance measures prose alone
  working against a coding weakness.
- **On simplicity the guidance is blunt, and it gives a test:**
  - add complexity "only when it demonstrably improves outcomes";
  - treat every harness component as an assumption about what the model can't do;
  - remove the components one at a time to see which carry weight, and re-examine them when a new
    model lands.

  The repo's census shows the other side: 24 lanes (10 spend a model), 57% of runs were no-ops,
  8 lanes did no useful work, and there are three independent retry counters.

## Sources and how to read this

**Engineering posts** (https://www.anthropic.com/engineering/…, date published):

| Post | Date | Short name |
|---|---|---|
| building-effective-agents | 2024-12-19 | BEA |
| multi-agent-research-system | 2025-06-13 | MARS |
| writing-tools-for-agents | 2025-09-11 | WTA |
| effective-context-engineering-for-ai-agents | 2025-09-29 | ECE |
| equipping-agents-for-the-real-world-with-agent-skills | 2025-10-16 | SKILLS-POST |
| code-execution-with-mcp | 2025-11-04 | CEM |
| advanced-tool-use | 2025-11-24 | ATU |
| effective-harnesses-for-long-running-agents | 2025-11-26 | EHLR |
| demystifying-evals-for-ai-agents | 2026-01-09 | EVALS |
| building-c-compiler | 2026-02-05 | CCOMP |
| eval-awareness-browsecomp | 2026-03-06 | EVAL-AWARE |
| harness-design-long-running-apps | 2026-03-24 | HDLR |
| claude-code-auto-mode | 2026-03-25 | AUTO |
| managed-agents | 2026-04-08 | MA |
| april-23-postmortem | 2026-04-23 | PM |
| how-we-contain-claude | 2026-05-25 | CONTAIN |

`/engineering/claude-code-best-practices` now redirects to the Claude Code doc below.

**Claude Code docs** (https://code.claude.com/docs/en/…): best-practices, sub-agents, hooks-guide,
memory, headless, workflows, routines, agents, agent-teams, features-overview,
how-claude-code-works, goal, costs, skills, large-codebases, model-config, context-window.

**Platform docs** (https://platform.claude.com/docs/en/…):
- `build-with-claude/prompt-engineering/claude-prompting-best-practices` (PBP)
- `prompting-claude-opus-5` (OP5P), `prompting-claude-sonnet-5` (S5P),
  `prompting-claude-fable-5` (F5P) and `prompting-claude-fable-5-1` (F51P), all under
  `build-with-claude/prompt-engineering/`
- `models/opus-5/whats-new-opus-5`
- `agents-and-tools/agent-skills/best-practices` (SKBP)
- `build-with-claude/context-windows`, `agents-and-tools/tool-use/memory-tool`

**Blog:** https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more
(2026-06-18, Anthropic staff) (STEER).

**System cards:** https://www.anthropic.com/claude-opus-5-system-card (O5C; 2026-07-24, changelog
2026-08-19) and https://www.anthropic.com/claude-sonnet-5-system-card (S5C; 2026-06-30). Sections
are cited by number.

**Which models this repo runs** (so model-specific guidance can be matched to a stage):
- `claude-sonnet-5`: the implementer (`implement/implement.ts:48`), the fixer (`fixer/fixer.ts:30`),
  the acceptance author (`acceptance/acceptance.ts:41`) and the review refuter
  (`review/refuter.ts:8`).
- `claude-opus-5`: the fresh-eyes rung (`implement/implement.ts:50`), the mechanic, and the
  correctness reviewer (`review/review.ts:27`).
- The Ratify stage passes the `opus` alias.

Guidance written for Opus 4.5/4.6, Sonnet 4.5 or Fable 5 is marked as such. It is not direct
evidence about the models this repo runs.

**Verdict words** against the repo evidence:
- **agrees**: the repo measured what the guidance says.
- **contradicts**: the repo measured the opposite.
- **goes beyond**: the repo measured something the guidance doesn't cover, or measured it more
  sharply.
- **not measured**: no repo note measured it.

Repo notes: `docs/research/run-outcomes-2026-09.md` (RO), `lane-census-2026-09.md` (LC),
`agent-context-2026-09.md` (AC), `rule-census-2026-09.md` (RC), `merge-quality-2026-09.md` (MQ),
`github-native-overlap-2026-09.md` (GNO).

## Strengths to lean on

### S1. Writing code, including the control flow around tools

- ATU, Programmatic Tool Calling: "Claude excels at writing code and by letting it express
  orchestration logic in Python rather than through natural language tool invocations, you get more
  reliable, precise control flow." And: "By writing explicit orchestration logic, Claude makes fewer
  errors than when juggling multiple tool results in natural language."
  (https://www.anthropic.com/engineering/advanced-tool-use)
- CEM: "LLMs are adept at writing code and developers should take advantage of this strength"
  (https://www.anthropic.com/engineering/code-execution-with-mcp)
- SKILLS-POST: "many applications require the deterministic reliability that only code can provide"
  (https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- **Recommended use:** put loops, conditionals and data handling in code, whether Claude writes it
  or it is fixed, rather than in turn-by-turn tool calls.
- **Repo:** **agrees** in shape. Every lane's orchestration is TypeScript, and the model is spent
  only inside a stage (LC § Lanes: 24 lanes, 10 spend a model). No note measured a model doing the
  orchestration, so there is no comparison.

### S2. Whole multi-file features, from a complete spec given up front

- OP5P, Capability improvements: "Claude Opus 5 is strongest on difficult coding tasks: multi-file
  features, larger refactors, and end-to-end feature work. It completes full tasks rather than
  leaving stubs or placeholders, and it performs best when given the complete task specification up
  front and left to run."
  (https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5#capability-improvements)
- S5P, Interactive coding products: "When limiting the number of required user interactions, it's
  important to specify the task, intent, and relevant constraints upfront in the first human turn."
  (https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5)
- best-practices, Let Claude interview you: "The most useful specs are self-contained: they name the
  files and interfaces involved, state what is out of scope, and end with an end-to-end verification
  step that proves the feature works."
  (https://code.claude.com/docs/en/best-practices#let-claude-interview-you)
- **Benchmarks, for scale.** O5C §8.2 gives SWE-bench Pro "Claude Opus 5 achieved 79.2%". S5C §8.2
  gives "Sonnet 5 achieved 63.2%". So the implementer model trails the fresh-eyes and reviewer model
  on the harder coding set.
- **Recommended use:** one self-contained brief, with the finish line stated, then leave it to run.
- **Repo:** **agrees.**
  - RO § What the smooth runs shared: 29 of 51 lane-merged ticket-door runs were clean, median 23
    minutes (range 4–51). 21 of 31 spec children were clean, median 36 minutes.
  - LC § Summary: Implement did useful work in 83% of runs.
  - The implement brief is the one stage with a byte budget (AC § Summary), and it hands the
    acceptance tests over as the spec (`implement/implementer/prompt.md`, "The two non-negotiables").
  - MQ § Fast merges against slow: fast merges did not cost more afterwards (3 of 22 under 30
    minutes had a follow-on cost).

### S3. Tests and the environment as ground truth

- BEA, Agents: "During execution, it's crucial for the agents to gain “ground truth” from the
  environment at each step (such as tool call results or code execution) to assess its progress."
  Appendix 1: "Code solutions are verifiable through automated tests;" and "Agents can iterate on
  solutions using test results as feedback;"
  (https://www.anthropic.com/engineering/building-effective-agents)
- best-practices, Give Claude a way to verify its work: "Claude stops when the work looks done.
  Without a check it can run, "looks done" is the only signal available, and you become the
  verification loop"
  (https://code.claude.com/docs/en/best-practices#give-claude-a-way-to-verify-its-work)
- CCOMP, Write extremely high-quality tests: "So it’s important that the task verifier is nearly
  perfect, otherwise Claude will solve the wrong problem."
  (https://www.anthropic.com/engineering/building-c-compiler)
- **Recommended use:** give every run a check it can execute with a pass/fail answer.
- **Repo:** **agrees, and goes beyond on verifier quality.**
  - Acceptance-first tests, the gauntlet and `close-ticket`'s `check:` markers are this pattern
    (GNO § What only the lanes do).
  - The CCOMP warning measured here: RO § Stops and dead runs by cause, class 3. 7 of the 15
    post-merge close refusals were a check marker that could not run or could never match (pytest,
    a `$HOME` path, a grep that could never match, no marker at all).
  - #496's tests "already pass" (class 8).

### S4. Picking up state from files and git in a fresh session

- PBP, Workflows across multiple context windows: "Claude's latest models are extremely effective at
  discovering state from the local filesystem. In some cases, you may want to take advantage of this
  over compaction." State management: "Claude's latest models perform especially well in using git
  to track state across multiple sessions."
  (https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- EHLR, Incremental progress: "the best way to elicit this behavior was to ask the model to commit
  its progress to git with descriptive commit messages and to write summaries of its progress in a
  progress file."
  (https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- **Recommended use:** fresh sessions that read their state from git and files, not one long
  compacted session.
- **Repo:** **agrees.**
  - Every lane stage is a fresh session over a checkout (AC § Lane stages).
  - RO class 5: for the 12 green runs thrown away at rebase, "Acceptance tests survived on
    `accept/issue-N`, so a fresh implement run on new trunk was all it took."

### S5. Finding its own context

- how-claude-code-works, Delegate, don't dictate: "You don't need to specify which files to read or
  what commands to run. Claude figures that out."
  (https://code.claude.com/docs/en/how-claude-code-works#delegate-dont-dictate)
- ECE: "CLAUDE.md files are naively dropped into context up front, while primitives like glob and
  grep allow it to navigate its environment and retrieve files just-in-time"
  (https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- CEM, Progressive disclosure: "Models are great at navigating filesystems."
- **Recommended use:** load a small index up front and let the agent retrieve the rest just in time.
- **Repo:** **goes beyond.** The strength is real, but here it is where the money goes.
  - AC § Summary: "most of the cost is exploration, not the brief". #628 took 138 turns, 26.8M
    cache-read tokens and $7.91.
  - AC § Where agents got lost: the implementer re-read files already inlined in its brief (case
    5). Tracker-port files were read out of brief 16–19 times each on #588 (case 1).
  - AC § Against first-party guidance already notes that the lanes pre-load large reference (a
    50–60 KB brief, a third of it `CONTEXT.md`) and leave the facts the agent needs for it to
    find, the opposite of ECE's hybrid.

### S6. Code review (Opus 5)

- OP5P, Capability improvements: "Claude Opus 5 reviews code with high precision and recall: it
  finds real bugs at a high rate per pass, and its additional findings are mostly real issues rather
  than false positives." Same bullet: "If your review prompt says "only report high-severity issues"
  or "be conservative," the model may follow that instruction literally and report less; ask it to
  report everything and filter in a separate pass instead."
- PM, A caching optimization: "When provided the code repositories necessary to gather complete
  context, Opus 4.7 found the bug, while Opus 4.6 didn't."
  (https://www.anthropic.com/engineering/april-23-postmortem)
- **Recommended use:** Opus as the reviewer, asked for coverage, with filtering as a separate step.
- **Repo:** **agrees where measured. The model produced findings, and the harness discarded them.**
  - MQ § Dropped review findings: 15 of 23 retained runs returned 26 findings, which are 20 distinct
    problems. 10 findings (8 problems) claim a production defect. The one premise checked holds.
  - Every one was dropped by the `path:line`-in-raw-diff filter (`review/structural-refusal.ts:9-16`).
    LC § Corrections, 2026-09-17 corrects the earlier "zero findings" reading.
  - Precision was not measured. The reviewer prompt tells the model what does not count and to
    "Write nothing when you find nothing" (`review/correctness-reviewer/prompt.md`). Whether that
    wording lowers recall, as OP5P warns, is **not measured**.

### S7. Self-verification and self-correction by default (claimed for Opus 5 and Sonnet 5)

- OP5P, Task scope and over-verification: "Claude Opus 5 verifies its own work without being told
  to." Same section: "instructions like these cause over-verification on Claude Opus 5, and removing
  them reduces wasted tokens with no loss in quality. The same applies to legacy harness scaffolding
  that adds separate verification steps." Self-correction: "Claude Opus 5 catches and fixes its own
  mistakes well without prompting."
- S5P, Tool use triggering: "Claude Sonnet 5 is more agentic than Claude Sonnet 4.6 by default and
  will reach for tools and run self-verification loops more readily."
- **Recommended use (for these models):** remove prompt lines and harness steps that only tell the
  model to re-check.
- **Repo:** **contradicts for the Sonnet 5 stages.** Opus 5 is not measured.
  - RO class 3: 8 tickets merged by lane 08 later failed their own acceptance check (#382, #463,
    #521, #533, #557, #617, #619, #629). `test.fails` was left in on #382 and #557.
  - MQ § Lane pushes: the acceptance author's commits for #533, #555, #556 and #559 deleted the 69
    cases `f4378e7` restored. Its guard at the time was "the author's own judge" (MQ § Follow-on
    costs per route).
  - The fresh-eyes rung (Opus 5) was dispatched 6 times (LC § Upkeep), and its outcome rate was not
    measured.
  - W1 and W2 carry the matching weakness guidance.

### S8. Staying coherent over long runs and long context

- whats-new-opus-5, Capability improvements: "Agentic coding and long-horizon tasks, staying on task
  across extended tool-use loops and completing multi-file features, larger refactors, and
  end-to-end feature work without leaving stubs or placeholders."
  (https://platform.claude.com/docs/en/models/opus-5/whats-new-opus-5#capability-improvements)
- OP5P: "its instruction following, tool calling, and reasoning stay consistent throughout the
  window."
- O5C §8.9.1 Programbench: "Claude Opus 5 scored 83% after the first episode, increasing to 93% by
  the fifth episode." O5C §6.1.2: "We found significantly less self-serving bias and character drift
  over long interactions."
- HDLR, Results from the updated harness (Opus 4.6): "the builder, which ran coherently for over two
  hours without the sprint decomposition that Opus 4.5 had needed."
  (https://www.anthropic.com/engineering/harness-design-long-running-apps)
- **Tension:** the general platform page still describes context rot (W4).
- **Repo:** **not measured.** No note measured drift inside one lane run. Lane stages are bounded
  by minute budgets (`shared/lane-budget.ts`, AC § Summary), not by context length.

### S9. Delegating independent work to subagents

- OP5P, Capability improvements: "Claude Opus 5 coordinates teams of subagents well, with effective
  writer-verifier patterns and few cases of agents overwriting each other's work."
- ECE: "Each subagent might explore extensively, using tens of thousands of tokens or more, but
  returns only a condensed, distilled summary of its work (often 1,000-2,000 tokens)."
- best-practices, Use subagents for investigation: "Since context is your fundamental constraint,
  use subagents to keep research out of it."
  (https://code.claude.com/docs/en/best-practices#use-subagents-for-investigation)
- O5C §8.11.1: "Every multi-agent variant matches or exceeds the best single-agent variant". That was
  measured on search, not on coding.
- **Limits:** MARS says coding fits multi-agent poorly (see K3), and OP5P says Opus 5 over-delegates
  (see K3).
- **Repo:** **not measured as a strength.**
  - AC § Against first-party guidance: "No lane stage hands such a summary to the next stage"
  - AC case 7: the To-Tickets slicer spent 2 subagents, one of them checking a stale checkpoint,
    and died.

### S10. Improving prompts and tools from transcripts

- WTA, Collaborating with agents: "Claude is an expert at analyzing transcripts and refactoring lots
  of tools all at once" (https://www.anthropic.com/engineering/writing-tools-for-agents)
- MARS: "When given a prompt and a failure mode, they are able to diagnose why the agent is failing
  and suggest improvements." The resulting tool-description rewrite "resulted in a 40% decrease in
  task completion time for future agents using the new description"
  (https://www.anthropic.com/engineering/multi-agent-research-system)
- **Recommended use:** feed real run transcripts to Claude to find and fix prompt and tool defects.
- **Repo:** **agrees.** The six `*-2026-09.md` notes for map #646 were built from run streams and
  transcripts (AC § Method and sources; RO § How this was traced).

## Weaknesses to rail

Each entry gives the guidance, the recommended mitigation and its kind, and the repo evidence. The
kinds are **prose** (an instruction), **tool** (a hook, permission, sandbox or purpose-built tool),
**check** (a deterministic gate or test) and **structure** (how the pipeline is shaped: separate
agents, fresh sessions, claims).

### W1. Grading its own work

- **Guidance:**
  - HDLR, Why naive implementations fall short: "When asked to evaluate work they've produced,
    agents tend to respond by confidently praising the work - even when, to a human observer, the
    quality is obviously mediocre." And: "tuning a standalone evaluator to be skeptical turns out
    to be far more tractable than making a generator critical of its own work".
  - HDLR, Running the harness: "Out of the box, Claude is a poor QA agent. In early runs, I watched
    it identify legitimate issues, then talk itself into deciding they weren't a big deal and approve
    the work anyway."
  - best-practices, Give Claude a way to verify its work: a verifier "has a fresh model try to refute
    the result, so the agent doing the work isn't the one grading it." Add an adversarial review
    step: "The longer Claude works unattended, the more an independent check matters before you
    count the work as done."
    (https://code.claude.com/docs/en/best-practices#add-an-adversarial-review-step)
  - F5P, Recommended scaffolding changes (Fable 5): "Separate, fresh-context verifier subagents tend
    to outperform self-critique."
    (https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5)
  - EVALS, Step 5: "We recommend choosing deterministic graders where possible, LLM graders where
    necessary or for additional flexibility, and using human graders judiciously for additional
    validation." (https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
  - AUTO, Why we strip assistant text: "We strip assistant text so the agent can't talk the
    classifier into making a bad call." (https://www.anthropic.com/engineering/claude-code-auto-mode)
- **Counter-guidance (Opus 5):** OP5P tells harnesses to remove verification steps (S7). Its sample
  delegation text says "do not use subagents to verify or double-check your own work."
- **Mitigation and kind:**
  - **structure:** a separate judge with fresh context, calibrated from its logs (HDLR).
  - **check:** deterministic graders first (EVALS).
  - **structure:** the judge sees what the agent did, not what it said (AUTO).
- **Repo:** **agrees, and goes beyond.**
  - **Separation built in.** The acceptance tests are written "from the ticket alone, by someone who
    will never see your code" (`implement/implementer/prompt.md`). `close-ticket` runs the ticket's
    own `check:` markers.
  - **Self-judging failed where it remained.** The acceptance author as "the author's own judge"
    deleted 69 cases (MQ § Follow-on costs per route; § Lane pushes). A check, `9279b93`, now refuses
    such commits.
  - **The separate LLM judge (Review) was neutralised by its own deterministic pre-filter** (S6), so
    its value on this pipeline is **not measured**.
  - **Timing.** Every finding-bearing review started between 6 minutes before and 11 seconds after
    its PR merged (MQ § Summary), so as wired it could not hold a merge. The guidance's "before you
    count the work as done" was not met.

### W2. Declaring done too early, or reporting progress that didn't happen

- **Guidance:**
  - EHLR, The long-running agent problem: "After some features had already been built, a later agent
    instance would look around, see that progress had been made, and declare the job done." Testing:
    "One final major failure mode that we observed was Claude’s tendency to mark a feature as
    complete without proper testing."
  - CCOMP, Looking forward: "For autonomous systems, it is easy to see tests pass and assume the job
    is done, when this is rarely the case."
  - HDLR, Results: "The generator was still liable to miss details or stub features when left to its
    own devices, and the QA still added value in catching those last mile issues for the generator
    to fix."
  - O5C §6.3 Training data review lists "Fabricating execution output, file contents, or citations
    for work it had not actually done;", "Attributing a visible defect to the environment and
    declaring the task done anyway;" and "Submitting a solution without compiling or running it,
    relying on a mental check instead."
  - O5C §6.4.3 Misleading users scores "False completion claims: Claiming a task is complete,
    successful, or verified when it is not."
  - F5P, Ground progress claims during long runs (Fable 5): "instruct Claude Fable 5 to audit progress
    against actual tool results. In Anthropic's testing, this nearly eliminated fabricated status
    reports even on tasks designed to elicit them"
  - agent-teams, Agents stopping early: "The lead can stop early too, deciding the team is finished
    before all tasks are actually complete."
    (https://code.claude.com/docs/en/agent-teams#agents-stopping-early)
- **Mitigation and kind:**
  - **structure + check:** a feature list where everything starts failing, plus an end-to-end test
    tool (EHLR).
  - **check:** gate the stop with a Stop hook or `/goal`: "The `/goal` and Stop hook versions are
    what let an unattended run finish correctly without you."
    (https://code.claude.com/docs/en/best-practices#give-claude-a-way-to-verify-its-work)
  - **check:** a fresh-model completion judge, "so completion is decided by a fresh model rather
    than the one doing the work." (https://code.claude.com/docs/en/goal)
  - **prose:** ground claims in tool output (F5P), or "Have Claude show evidence rather than
    asserting success" (best-practices).
- **Repo:** **agrees, and goes beyond on timing.**
  - The implementer is told "Green on every one of them, turned on, or you are not done", and the
    landing re-runs the gate (`implement/implementer/prompt.md` steps 2 and 4).
  - Yet 8 tickets were merged and then refused by `close-ticket` as incomplete by their own check
    (RO class 3). MQ § Candidates calls this "the lane route's largest follow-on cost".
  - The check exists, but it runs **after** merge, not before the stop. The guidance places it at
    the stop.
  - RO class 13: #570's implementer answered nothing 4 times in 3 minutes. `e16f162` holds such
    tickets now.

### W3. Editing or deleting tests to get to green

- **Guidance:**
  - O5C §6.3: "Editing or deleting tests and checks in order to pass;" and "Attempting to satisfy the
    inferred grading criteria, rather than the requested task".
  - PBP, Avoid focusing on passing tests and hardcoding: "Claude can sometimes focus too heavily on
    making tests pass at the expense of more general solutions". Suggested prose: "Tests are there to
    verify correctness, not to define the solution." And: "If the task is unreasonable or infeasible,
    or if any of the tests are incorrect, please inform me rather than working around them."
  - EHLR, Feature list: "we use strongly-worded instructions like “It is unacceptable to remove or
    edit tests because this could lead to missing or buggy functionality.”" And: "we landed on using
    JSON for this, as the model is less likely to inappropriately change or overwrite JSON files
    compared to Markdown files."
  - goal, Write an effective condition: "**Constraints that matter**: anything that must not change
    on the way there, such as "no other test file is modified""
    (https://code.claude.com/docs/en/goal#write-an-effective-condition)
  - EVALS, Step 5: "Make your graders resistant to bypasses or hacks."
- **Mitigation and kind:** **prose** (the EHLR and PBP wording) plus **structure** (a narrow edit
  surface: only flip `passes`) plus **check** (a completion condition naming what must not change).
- **Repo:** **agrees, and goes beyond: prose plus a narrow edit surface was not enough.**
  - The implementer already gets the narrow surface: it may drop `.fails` "and nothing else", and
    "the landing after your answer reads the diff for exactly that and refuses the whole run"
    (`implement/implementer/prompt.md` step 2). #490 was refused that way (RO class 15).
  - The acceptance author had no such check. It returned whole test files "rebuilt from memory",
    deleting 69 cases (MQ § Lane pushes). RO class 4 records truncated returns (2 of 3 cases; 1 of
    75 cases). That is test loss by file regeneration, not only by intent.
  - RC § Contradictions C20: the mechanic prompt says "deleting a red test is caught", but the code
    matches only skip, todo and xit.
  - MQ § Summary: no `.skip` or `.todo` was added on any route.

### W4. Losing precision as context fills, and losing detail in compaction

- **Guidance:**
  - ECE, Why context engineering is important: "as the number of tokens in the context window
    increases, the model’s ability to accurately recall information from that context decreases."
    And: "Context, therefore, must be treated as a finite resource with diminishing marginal returns."
  - context-windows: "As token count grows, accuracy and recall degrade, a phenomenon known as
    *context rot*." (https://platform.claude.com/docs/en/build-with-claude/context-windows)
  - best-practices: "Claude's context window fills up fast, and performance degrades as it fills."
    Course-correct: "A clean session with a better prompt almost always outperforms a long session
    with accumulated corrections."
    (https://code.claude.com/docs/en/best-practices#course-correct-early-and-often)
  - HDLR: "models tend to lose coherence on lengthy tasks as the context window fills". Earlier
    models also showed "context anxiety", which HDLR reports Opus 4.5 "largely removed".
  - PM: with thinking history dropped, "Claude would continue executing, but increasingly without
    memory of why it had chosen to do what it was doing."
  - MA: "irreversible decisions to selectively retain or discard context can lead to failures. It is
    difficult to know which tokens the future turns will need."
    (https://www.anthropic.com/engineering/managed-agents)
  - F5P, Rare cases of context-budget concern: "This is most often triggered when the harness shows a
    remaining-token countdown to the model. Avoid surfacing explicit context-budget counts where
    possible."
- **Counter-guidance (Opus 5):** "stay consistent throughout the window" (S8).
- **Mitigation and kind:**
  - **structure:** fresh sessions with a structured handoff, notes files, subagents that return
    summaries (ECE, HDLR, EHLR).
  - **tool:** re-inject context after compaction with a `SessionStart` hook on the `compact`
    matcher (https://code.claude.com/docs/en/hooks-guide#re-inject-context-after-compaction).
  - **tool:** tool-result clearing (ECE).
  - **prose:** keep always-loaded files small (W5).
- **Repo:** **agrees on structure; context size is measured, drift is not.**
  - Every stage is a fresh session, and the fresh-eyes rung is a "clean session with a better
    prompt" (`implement/implement.ts:275`).
  - AC § Summary: about 24k tokens per lane stage before the prompt, most of it tools and skill
    metadata the stage never uses. Only the implement brief has a byte budget. The review diff and the fresh-eyes attempt are
    uncapped: PR #634's diff was 224 KB (no review ran on it), and a fresh-eyes input is estimated at
    about 250–260 KB.
  - RO § What the smooth runs shared: #539 inlined 92 KiB into the acceptance author, whose first
    pass took 17.3 of a 24-minute budget.
  - Drift inside a run was **not measured**.

### W5. Prose rules followed only probabilistically: bloat, conflicts and rationalising around a constraint

- **Guidance:**
  - best-practices, Write an effective CLAUDE.md: "If Claude keeps doing something you don't want
    despite having a rule against it, the file is probably too long and the rule is getting lost."
    And: "If you emphasize many lines, none of them stands out."
  - memory, Write effective instructions: "if two rules contradict each other, Claude may pick one
    arbitrarily." (https://code.claude.com/docs/en/memory#write-effective-instructions)
  - features-overview: "An instruction like "never edit `.env`" in CLAUDE.md or a skill is a request,
    not a guarantee." And: "If a rule must hold every time, make it a hook rather than a prompt
    instruction." (https://code.claude.com/docs/en/features-overview)
  - STEER, When to use each method: "Claude will follow the instruction most of the time, but when
    under pressure, in a long session or an ambiguous situation, or due to a prompt injection in a
    file accessed as part of the task, the model can fail to follow a prompted rule. A real guardrail
    needs to be deterministic, and the enforcement methods are hooks and permissions."
  - CONTAIN, Three components of defense: "Because models are probabilistic, these shape only what
    the agent tends to do, not what it is theoretically capable of doing."
    (https://www.anthropic.com/engineering/how-we-contain-claude)
  - O5C §6.3: "Rationalizing around an explicit constraint on narrow semantic grounds;"
  - O5C §6.2.2: "a near-final instance of Claude Opus 5 used curl to access a website that couldn't be
    accessed via WebFetch, despite clear instructions not to use bash commands to fetch URLs."
  - S5C §6.3 lists the same rationalising for Sonnet 5, with an example where "arbitrary python -c
    usage" was read as leeway.
  - ECE, The anatomy of effective context: teams "stuff a laundry list of edge cases into a prompt
    in an attempt to articulate every possible rule the LLM should follow for a particular task. We
    do not recommend this."
- **Mitigation and kind:**
  - **tool/check:** a hook or permission for anything that must always hold.
  - **prose:** short, non-contradictory, concrete ("write instructions that are concrete enough to
    verify", memory).
  - Pruning: "If Claude already does something correctly without the instruction, delete it or
    convert it to a hook." (https://code.claude.com/docs/en/best-practices#avoid-common-failure-patterns)
- **Repo:** **agrees, and goes beyond: a rule stated in full in the agent's own prompt still failed.**
  - RC § Summary and § Duplicates: 240 census rows. "Most rules the implementer and slicer prompts
    teach also have a machine twin. The prompts usually restate that twin rather than read it."
    D1: the rooting rule has seven copies.
  - RO class 6: 6 of 10 slicer refusals were "path not rooted". AC case 7e: the rooting rule was
    stated in full in the slicer's own prompt.
  - RC § Contradictions: 26 items. In C20 the acceptance author is told it has no tools and also
    told to run tests; it ran 12 Bash, 5 Read and 5 Edit calls (AC case 8). That is the memory doc's
    "pick one arbitrarily" measured.
  - RC § Summary item 5: `gh issue close` is ungated in this checkout, and 11 closes were let through.
  - RC § Misplacements M15–M20: "Taught where a gate could refuse".

### W6. Literal reading of instructions (Sonnet 5), and filters written as prose

- **Guidance:**
  - S5P, More literal instruction following: "Claude Sonnet 5 interprets prompts literally and
    explicitly, particularly at lower effort levels. It does not silently generalize an instruction
    from one item to another, and it does not infer requests you didn't make."
  - S5P, Code review harnesses: "If your harness has a separate verification, deduplication, or
    ranking stage, tell the model explicitly that its job at the finding stage is coverage rather
    than filtering." OP5P says the same for Opus 5 (S6).
  - best-practices, Add an adversarial review step, pulls the other way for a reviewer: "Chasing
    every finding leads to over-engineering: extra abstraction layers, defensive code, and tests for
    cases that can't happen." Its advice: "Tell the reviewer to flag only gaps that affect
    correctness or the stated requirements, and treat the rest as optional."
- **Mitigation and kind:** **prose** (state scope explicitly; ask for coverage) plus
  **structure** (filtering as a separate stage).
- **Repo:** **not measured for recall.** The correctness reviewer prompt narrows at the finding stage
  (defects only, "Write nothing when you find nothing"), and a separate refuter stage exists. The
  deterministic filter after it dropped everything (S6). The reviewer is Opus 5, so the S5P text
  applies to the Sonnet 5 refuter, not the reviewer.

### W7. Widening scope and overbuilding

- **Guidance:**
  - O5C §6.3: "Claude frequently suffered from scope creep, especially on coding tasks. Claude would
    often add extra fixes, refactors, tests, and new files that the user did not request."
  - O5C §8.4 FrontierCode: "This reflects a tendency for Opus 5 at these effort levels to make more
    changes than the task requires" … "We found that adding a brief instruction to the prompt telling
    the model to stay within the scope of the task recovered performance on most of these tasks,
    showing this is not primarily a model limitation."
  - OP5P, Task scope and over-verification: "Claude Opus 5 can also expand the scope of a task, adding
    steps that weren't requested or applying its own judgment about what the task should be."
  - S5C §6.3: "Suffering from scope creep by completing tasks and adding features that the user did
    not request."
  - F51P, Keep changes and tests to what the task asks for (Fable 5.1): after the suggested
    instruction, "unrequested additions and committed test code drop substantially with no
    measurable change in task success"
    (https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1)
  - PBP, Overeagerness (Opus 4.5/4.6): "The right amount of complexity is the minimum needed for the
    current task."
  - EHLR: "the agent tended to try to do too much at once - essentially to attempt to one-shot the
    app." And: "This incremental approach turned out to be critical to addressing the agent’s
    tendency to do too much at once."
  - CCOMP, Multiple agent roles: "LLM-written code frequently re-implements existing functionality,
    so I tasked one agent with coalescing any duplicate code it found."
- **Mitigation and kind:**
  - **prose**, measured to work (O5C §8.4, F51P);
  - **structure:** one feature at a time (EHLR);
  - **structure:** a dedicated de-duplication role (CCOMP).
- **Repo:** **agrees, and goes beyond: the prompt itself sanctions the widening that caused the most
  loss.**
  - Claims bound the work (`## Files claimed`). jscpd (`npm run clones`) and knip are deterministic
    checks against duplication and unreachable code (`.claude/contract.json`), where CCOMP used an
    agent.
  - RO § What the smooth runs shared, item 1: the rebase losses came from edits outside the claim,
    not concurrency. #624 claimed 2 files, and its PR also edited 3 tracker files. AC case 6: #629's
    implementer edited 5 unclaimed files.
  - The implementer prompt tells it "Claimed files bound what you *decide*, never what you *repair*"
    (step 3), and RC § Contradictions C4 records the ADR conflict behind it.
  - MQ § Summary: a later repair named a defect in 6.9% of lane merges against 3.7% of direct
    pushes. Whether scope creep contributed was **not measured**.

### W8. Exploration cost, misjudged effort and time blindness

- **Guidance:**
  - best-practices, Avoid common failure patterns: "Claude reads hundreds of files, filling the
    context." Fix: "Scope investigations narrowly or use subagents so the exploration doesn't consume
    your main context."
  - ECE: "Without proper guidance, an agent can waste context by misusing tools, chasing dead-ends, or
    failing to identify key information."
  - MARS, Prompt engineering and evaluations: "Agents struggle to judge appropriate effort for
    different tasks, so we embedded scaling rules in the prompts." And: "multi-agent systems use
    about 15× more tokens than chats."
  - CCOMP, Put yourself in Claude's shoes: "each agent is dropped into a fresh container with no
    context and will spend significant time orienting itself, especially on large projects." And:
    "Time blindness: Claude can't tell time and, left alone, will happily spend hours running tests
    instead of making progress."
  - costs, Offload processing to hooks and skills: "a hook can grep for `ERROR` and return only
    matching lines, reducing context from tens of thousands of tokens to hundreds."
    (https://code.claude.com/docs/en/costs#offload-processing-to-hooks-and-skills)
  - S5P, Calibrating effort and thinking depth: "If you observe shallow reasoning on complex problems,
    raise effort to `high` or `xhigh` rather than prompting around it."
  - O5C §6.2.1 Informal reports: "Self-correction loops where the model continually attempted to
    reconsider its answer, especially at higher effort levels."
- **Mitigation and kind:**
  - **structure:** scoped prompts and subagents;
  - **tool:** output filtering, a `--fast` sampled test mode (CCOMP), current READMEs and progress
    files;
  - **prose:** effort-scaling rules;
  - **config:** effort level.
- **Repo:** **agrees, and goes beyond.**
  - AC § Summary: #628 took 138 turns, 105 Bash calls and $7.91. #629 took 132 turns and $5.31.
  - AC case 4: stages rediscover each other's reads (#628).
  - AC case 7: the slicer made 63 Bash calls and spent $3.37 over 21.7 minutes, then failed.
  - LC § Summary: about $199 of $627 logged spend bought unused output.
  - The CCOMP orientation cost is visible even with a 50–60 KB pre-loaded brief, which the guidance
    doesn't address.
  - `LANE_BUDGETS` caps minutes, not tokens (AC § Summary).

### W9. Parallel agents colliding

- **Guidance:**
  - agent-teams, Avoid file conflicts: "Two teammates editing the same file leads to overwrites."
    (https://code.claude.com/docs/en/agent-teams#avoid-file-conflicts)
  - CCOMP: "Every agent would hit the same bug, fix that bug, and then overwrite each other's changes.
    Having 16 agents running didn't help because each was stuck solving the same task." And: "Merge
    conflicts are frequent, but Claude is smart enough to figure that out."
- **Mitigation and kind:**
  - **structure:** worktrees and file ownership;
  - **tool:** a known-good oracle to split the work (CCOMP);
  - **check:** CI "so that new commits can’t break existing code" (CCOMP).
- **Repo:** **agrees; the cause was scope, not concurrency.**
  - RO class 5: 12 green runs were thrown away at the pre-push rebase ($50.31, LC § Build tail).
  - RO § What the smooth runs shared: eight #491 siblings ran clean together.
  - The landing aborts on conflict and pushes nothing (LC § Copied logic C1). CCOMP's agents
    resolved conflicts themselves.

### W10. Overeager or destructive actions, and routing around limits

- **Guidance:**
  - AUTO: "Each of these was the result of the model being overeager, taking initiative in a way the
    user didn't intend." Threat model: "A deploy command failed a pre-check; the agent retried with a
    skip-verification flag." Results: "The 17% false-negative rate on real overeager actions is the
    honest number."
  - CONTAIN, Three types of risk: "More capable models make fewer mistakes, but they’re also better at
    finding unexpected paths to a goal, often by routing around restrictions nobody thought to write
    down."
  - S5C §6.4.4: "Sonnet 5's tendency to shortcut human approval, e.g., by creating subagents to approve
    its work, deleting information even when confirmation is requested, and using flags/privileges
    that were clearly out of scope without further discussion with the user."
  - S5C §6.3: "Sonnet 5 force-pushed over a collaborator's committed code fix with Git, destroying it
    without confirmation".
  - O5C §6.4.2: "Claude sometimes reasons its way past an explicit approval requirement."
  - PBP, Balancing autonomy and safety, prose: "When encountering obstacles, do not use destructive
    actions as a shortcut. For example, don't bypass safety checks (e.g. --no-verify) or discard
    unfamiliar files that may be in-progress work."
  - CONTAIN: "The deterministic boundary is what gets hit when everything probabilistic misses."
- **Mitigation and kind:**
  - **tool:** sandbox, permissions and a deterministic boundary first;
  - **check:** a classifier with deny-and-continue, stopping "If a session accumulates 3
    consecutive denials or 20 total" (AUTO);
  - **prose** as a supplement.
- **Repo:** **agrees in design; incidents not measured.**
  - The implementer's version-control writes are refused, and it is told "a refusal is not a hint to
    try another spelling" (`implement/implementer/prompt.md`).
  - The immutable set is enforced at landing.
  - No note counted destructive or out-of-bounds actions by lane models.
  - The landing itself pushes `--no-verify` (LC § Copied logic C1). That is harness code, not the
    model.

### W11. Stating things confidently without checking, including relaying subagent claims

- **Guidance:**
  - O5C §6.1.2: "found a surprising number of cases where it confidently stated an answer it was
    unsure about, or chose a different answer than what it had decided on internally."
  - O5C §6.1.3: "internal reports and preliminary measurements suggested the model can relay claims
    from subagents to users without verifying them".
  - S5C §6.5.3: "the primary failure mode we see in this evaluation is Claude noticing that the logic
    is questionable, but reporting the resulting numbers anyway."
  - CONTAIN, Looking ahead: "if a sub-agent's output is treated as higher-trust than raw tool results,
    because such output came from “us,” a new vector for prompt injection is introduced".
  - PBP, Minimizing hallucinations in agentic coding: "Never speculate about code you have not
    opened."
  - WTA, Analyzing results: "what agents omit in their feedback and responses can often be more
    important than what they include"
- **Mitigation and kind:** **check** (ground claims in tool output), **structure** (treat a
  subagent's output as untrusted data), **prose** (don't speculate about unopened code).
- **Repo:** **partly measured.**
  - AC case 7: the slicer used a subagent to check a stale checkpoint.
  - The implementer's `outOfBriefReads` and `declaredEdits` are self-reports the pipeline consumes.
    Their accuracy was **not measured**.

### W12. Stalling, stopping for input and looping in unattended runs

- **Guidance:**
  - CCOMP, Enabling long-running Claudes: "the model may solve part of it, but eventually it will stop
    and wait for continued input - a question, a status update, or a request for clarification."
  - F5P, Rare cases of early stopping (Fable 5): "Claude Fable 5 can occasionally end a turn with a
    text-only statement of intent ("I'll now run X") without issuing the corresponding tool call".
  - BEA: "it’s also common to include stopping conditions (such as a maximum number of iterations) to
    maintain control."
  - workflows, Keep fixing until a check passes: "keep fixing the reported errors until the type check
    passes or two rounds in a row make no progress"
    (https://code.claude.com/docs/en/workflows#keep-fixing-until-a-check-passes)
  - hooks-guide: "Claude Code overrides a Stop hook after it blocks eight times in a row without
    progress." (https://code.claude.com/docs/en/hooks-guide#stop-hook-hits-the-block-cap)
- **Mitigation and kind:** **structure** (an outer loop re-launches the session) plus **check**
  (iteration caps and no-progress stops).
- **Repo:** **agrees, and goes beyond: the caps multiplied.**
  - RO class 13 (#570) was fixed by `e16f162`.
  - LC § Copied logic C9 and C14: three independent retry counters (the strike ladder, the
    fixer's attempts and acceptance's repair rounds), with different reset rules. Implement and
    mechanic "do not reset on an owner decision" (LC C8).

### W13. Harness changes that quietly degrade quality

- **Guidance:**
  - PM, A system prompt change to reduce verbosity: "one addition to the system prompt caused an
    outsized effect on intelligence in Claude Code". And: "One of these evaluations showed a 3% drop
    for both Opus 4.6 and 4.7." Also: "The changes it introduced made it past multiple human and
    automated code reviews, as well as unit tests, end-to-end tests, automated verification, and
    dogfooding."
  - PM, Going forward: "We will run a broad suite of per-model evals for every system prompt change to
    Claude Code, continuing ablations to understand the impact of each line"
  - EVALS, Step 7: "As a rule, we do not take eval scores at face value until someone digs into the
    details of the eval and reads some transcripts."
- **Mitigation and kind:** **check** (per-model evals on every prompt change) plus reading
  transcripts.
- **Repo:** **goes beyond.**
  - AC § Lane stages: 27 prompt and reference files, 12,792 words, and nothing meters them.
  - Pin tests exist (`acceptance/author-prompt-pin.test.ts`, `shared/prompt-skeleton.test.ts`), but
    they check wording, not outcomes.
  - No outcome eval runs on a prompt change.

## Keeping it simple

### K1. Start with the least machinery, and add only on evidence

- BEA, When (and when not) to use agents: "we recommend finding the simplest solution possible, and
  only increasing complexity when needed. This might mean not building agentic systems at all."
  Combining and customizing: "To repeat: you should consider adding complexity only when it
  demonstrably improves outcomes."
- ECE: "\"do the simplest thing that works\" will likely remain our best advice for teams building
  agents on top of Claude."
- features-overview, Build your setup over time: "You don't need to configure everything up front.
  Each feature has a recognizable trigger". The table's first trigger is "Claude gets a convention or
  command wrong twice".
  (https://code.claude.com/docs/en/features-overview#build-your-setup-over-time)
- SKBP, Build evaluations first: "Create evaluations BEFORE writing extensive documentation. This
  ensures your Skill solves real problems rather than documenting imagined ones."
  (https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- EVALS, Step 0: "20-50 simple tasks drawn from real failures is a great start"

### K2. Every component is an assumption, so test it by removal, and again on each new model

- HDLR, Iterating on the harness: "every component in a harness encodes an assumption about what the
  model can't do on its own, and those assumptions are worth stress testing, both because they may be
  incorrect, and because they can quickly go stale as models improve." Method: "removing one
  component at a time and reviewing what impact it had on the final result."
- HDLR, What comes next: "when a new model lands, it is generally good practice to re-examine a
  harness, stripping away pieces that are no longer load-bearing to performance"
- MA: "harnesses encode assumptions about what Claude can’t do on its own. However, those assumptions
  need to be frequently questioned because they can go stale as models improve." And, on context
  resets: "The resets had become dead weight."
- F5P, Recommended scaffolding changes: "Skills developed for prior models are often too prescriptive
  for Claude Fable 5 and can degrade output quality."
- OP5P and S5P give concrete removals: verification instructions (Opus 5) and forced interim
  status messages ("try removing it", Sonnet 5).

### K3. When to add an agent, and when not to

- **Add:**
  - HDLR, Removing the sprint construct: "the evaluator is not a fixed yes-or-no decision. It is worth
    the cost when the task sits beyond what the current model does reliably solo." And: "for tasks
    within that boundary, the evaluator became unnecessary overhead."
  - sub-agents: "Use one when a side task would flood your main conversation with search results,
    logs, or file contents you won't reference again" (https://code.claude.com/docs/en/sub-agents)
  - OP5P, Controlling subagent spawning: "Delegation pays off on genuinely independent, sizeable
    tracks of work, but it multiplies cost and time when applied to small tasks."
- **Don't add:**
  - sub-agents, Choose between subagents and main conversation: when "The task needs frequent
    back-and-forth or iterative refinement" or "Multiple phases share significant context, such as
    planning, implementation, and testing".
  - PBP, Subagent orchestration: "For simple tasks, sequential operations, single-file edits, or tasks
    where you need to maintain context across steps, work directly rather than delegating."
  - MARS: "most coding tasks involve fewer truly parallelizable tasks than research, and LLM agents are
    not yet great at coordinating and delegating to other agents in real time."
  - EHLR, Future work: "it’s still unclear whether a single, general-purpose coding agent performs
    best across contexts, or if better performance can be achieved through a multi-agent
    architecture."
  - agent-teams: "Agent teams add coordination overhead and use significantly more tokens than a
    single session." (https://code.claude.com/docs/en/agent-teams)
  - EVAL-AWARE, Multi-agent amplification: "The rate of unintended solutions was 0.24% in the
    single-agent configuration compared to 0.87% for multi-agent, a 3.7x difference."
    (https://www.anthropic.com/engineering/eval-awareness-browsecomp)
- **Caps:** OP5P: "give explicit guidance on which scenarios warrant delegation, or set deterministic
  caps on how many agents can be launched." It names `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`,
  `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` and the SDK's `max_budget_usd`.
- **One judge, not a panel:** MARS, Effective evaluation of agents, "found that a single LLM call with
  a single prompt outputting scores from 0.0-1.0 and a pass-fail grade was the most consistent and
  aligned with human judgements."

### K4. When to add a tool or hook, and when not to

- WTA, Choosing the right tools: "More tools don’t always lead to better outcomes." And: "We recommend
  building a few thoughtful tools targeting specific high-impact workflows".
- ECE: "If a human engineer can’t definitively say which tool should be used in a given situation, an
  AI agent can’t be expected to do better."
- BEA, Appendix 2: "Poka-yoke your tools. Change the arguments so that it is harder to make mistakes."
  And: "we actually spent more time optimizing our tools than the overall prompt."
- ATU, Layer features strategically: "This focused approach lets you address the specific constraint
  limiting your agent's performance, rather than adding complexity upfront."
- features-overview: "**Use a hook** when the action must happen the same way every time and doesn't
  need Claude to think."
- hooks-guide, Agent-based hooks: "Agent hooks are experimental. Behavior and configuration may change
  in future releases. For production workflows, prefer [command hooks]"
- CONTAIN, Summary: "Be wary of custom components." And: "the weakest layer is the one you built
  yourself".

### K5. When to add a step

- PBP, Chain complex prompts: "Explicit prompt chaining (breaking a task into sequential API calls) is
  still useful when you need to inspect intermediate outputs or enforce a specific pipeline
  structure."
- BEA, Prompt chaining: "You can add programmatic checks (see "gate” in the diagram below) on any
  intermediate steps to ensure that the process is still on track."
- best-practices, Explore first, then plan, then code: "Plan mode is useful, but also adds overhead."
  And: "If you could describe the diff in one sentence, skip the plan."
- HDLR, Removing the sprint construct: "Without the planner, the generator under-scoped". A planning
  step earned its place there. But HDLR also warns that a planner which "tried to specify granular
  technical details upfront and got something wrong" cascades its errors downstream.
- workflows: "A workflow moves the plan into code." Cost: "a single run can use meaningfully more
  tokens than working through the same task in conversation."
  (https://code.claude.com/docs/en/workflows#cost)

### K6. Prose: fewer, calmer, explained instructions

- ECE: "good context engineering means finding the smallest possible set of high-signal tokens that
  maximize the likelihood of some desired outcome." And: "It’s best to start by testing a minimal
  prompt with the best model available".
- ECE, Conclusion: "We're already seeing that smarter models require less prescriptive engineering,
  allowing agents to operate with more autonomy."
- PBP, Tool usage: "The fix is to dial back any aggressive language." It gives
  "CRITICAL: You MUST use this tool when..." as the example to soften.
- PBP, Add context to improve performance: "Providing context or motivation behind your instructions,
  such as explaining to Claude why such behavior is important, can help Claude better understand your
  goals and deliver more targeted responses."
- MARS: "Our prompting strategy focuses on instilling good heuristics rather than rigid rules."
- SKBP, Concise is key: "Only add context Claude doesn't already have." Set appropriate degrees of
  freedom: "Match the level of specificity to the task's fragility and variability."
- SKBP, Runtime environment: "Prefer scripts for deterministic operations".

### Repo evidence against K1–K6

- **Machinery count.** LC § Summary: 24 lanes and 4,309 runs in 14 days. 57% of executed runs were
  no-ops, and 8 lanes did no useful work (Shape, Shape-accept, Lost-dispatch counter, Run watchdog,
  Decline on revert, Bypass counter, Mechanic, Record ratifications).
- **Overlaps.** LC § Overlapping jobs: Implement and Mechanic are "one job with two prompts", the
  ratification loop is five lanes, and there are three "try again on red" loops. LC § Copied logic:
  rebase-and-abort exists four times with four conflict outcomes.
- **Unmeasured additions.** The fresh-eyes rung ran 6 times with no outcome rate (LC § Upkeep). The
  Review lane was added and never tested by removal; as wired it could not hold a merge (MQ). This is
  the HDLR "which pieces … were actually load-bearing" question left unasked.
- **Built-ins.** LC § Built-in overlap: Review ≈ Claude Code's Code Review / `/code-review`; Fixer
  partly ≈ auto-fix. GNO § Summary: auto-merge and required checks are available but not set up.
- **Model changes.** The harness runs Sonnet 5 and Opus 5, and OP5P and S5P list scaffolding to
  remove on those models (K2). No note checked the prompts against those removals.

**Verdict:** the guidance's warnings **agree** with what the repo measured. No note measured a lane's
contribution by removal, so whether any component is load-bearing is **not measured**.

## Against the owner's craft skills

| Skill principle (file § section) | First-party guidance | Relation |
|---|---|---|
| **writing-for-agents** § Pruning: a sentence the model already obeys is a no-op, judged by running the doc | best-practices: "If Claude already does something correctly without the instruction, delete it or convert it to a hook." OP5P: remove verification instructions Opus 5 already follows | Supports |
| writing-for-agents § Pruning: one source of truth; the environment is a source of truth | memory: "Claude skips anything it can derive from the codebase"; SKBP: "Only add context Claude doesn't already have." | Supports |
| writing-for-agents § Information hierarchy: progressive disclosure, inline what every branch needs | SKILLS-POST: "Progressive disclosure is the core design principle that makes Agent Skills flexible and scalable."; SKBP: "Keep references one level deep from SKILL.md." | Supports |
| writing-for-agents § Steps and completion criteria: vague bounds invite premature completion | goal: "**One measurable end state**"; best-practices: "Claude stops when the work looks done." | Supports |
| writing-for-agents § Leading words: negation is a failure mode; keep a prohibition only as a guardrail paired with the positive | PBP § Control the format of responses: "Tell Claude what to do instead of what not to do" (stated for formatting); STEER: a "Never do this" belongs in a hook or permission, not an instruction | Supports; the guidance moves hard guardrails out of prose entirely |
| writing-for-agents § The two loads: context load | ECE "finite resource"; features-overview: too much setup "can also add noise that makes Claude less effective" | Supports |
| **writing-great-hooks** opening: "A CLAUDE.md line is a request the model may ignore" | features-overview: "is a request, not a guarantee"; STEER: "A real guardrail needs to be deterministic" | Supports, nearly verbatim |
| writing-great-hooks § Auditing: a hook that guarantees a rule retires the CLAUDE.md line | best-practices: "delete it or convert it to a hook" | Supports |
| writing-great-hooks `REFERENCE.md`: `agent` hook type is experimental; Stop hooks force-released after 8 blocks | hooks-guide: "Agent hooks are experimental … prefer [command hooks]"; "after it blocks eight times in a row without progress" | Supports |
| writing-great-hooks § Authoring: safety hooks fail closed, backed by a permission deny rule | CONTAIN: "The deterministic boundary is what gets hit when everything probabilistic misses." | Supports |
| **audit-doc** § Process step 2: read the field record; "An audit that skips it grades the intent and calls it the behaviour." | EVALS Step 7: "we do not take eval scores at face value until someone … reads some transcripts"; HDLR: "read the evaluator's logs, find examples where its judgment diverged from mine" | Supports |
| **codebase-design** § Principles: depth at the interface; small surface | WTA: "a few thoughtful tools"; BEA: "Poka-yoke your tools" | Supports (tools as interfaces) |
| codebase-design `DESIGN-IT-TWICE.md`: 3+ parallel subagents under different constraints | OP5P: delegation "multiplies cost and time when applied to small tasks"; agent-teams: parallel work fits when "teammates can operate independently"; MARS: multi-agent ≈15× chat tokens | Consistent for genuinely independent design options; the guidance adds a cost caution the skill doesn't state |
| writing-for-agents § When to split / `SKILL-MECHANICS.md`: model-invoked means permanent description load | skills: "every line is a recurring token cost"; STEER table: skill name and description load at session start | Supports |

No principle in the four skills was found to be contradicted outright. The one soft tension is
SKBP's own iteration example, where Claude suggests "stronger language such as "MUST filter"". That
sits against PBP's "dial back any aggressive language", and the skills side with PBP.

## Candidates

Facts-derived options for the Charter. None is a ruling.

1. **Move the "done" check to the stop, not after merge.** W2: the guidance gates completion with a
   Stop hook, `/goal` or a fresh-model judge. The repo runs `close-ticket`'s criteria after lane 08
   merged, and 8 tickets failed there (RO class 3).
2. **Give the acceptance author the implementer's narrow edit surface.** W3: a diff check on what
   may change, like the implementer's `.fails` rule. `9279b93` is a start; its coverage was not
   re-checked here.
3. **Add the measured one-line scope instruction to the Opus 5 and Sonnet 5 build prompts, and
   measure out-of-claim edits before and after.** W7: O5C §8.4 and F51P measured a gain. The repo's
   biggest rebase loss was out-of-claim edits.
4. **Apply the model-specific removals, then measure.** K2: OP5P says drop verification
   instructions and verifier steps for Opus 5, and S5P says drop forced status scaffolding. The
   fresh-eyes rung and Review are candidates to ablate, not to assume.
5. **Review asks for coverage and filters in a separate stage, before merge.** S6 and W6: the model
   produced 26 findings, and the harness dropped them all after the merge.
6. **Replace taught rules that have a machine twin with the twin's refusal text.** W5: seven copies
   of the rooting rule did not stop 6 refusals. STEER and features-overview put "must hold" rules in
   hooks and permissions.
7. **Meter prompt changes by outcome, not wording.** W13: PM runs per-model evals on every
   system-prompt change. The repo pins prompt wording.
8. **Remove components one at a time.** K2 and K3 against LC's 8 idle lanes, the three retry
   counters and the five-lane ratification loop.
9. **Cap bytes, not only minutes, per stage.** W4 and W8: uncapped inputs of an estimated 224–440 KB, and
   `LANE_BUDGETS` counts minutes.

## Not verified

- **Opus 5 self-verification in this repo.** The Opus 5 claim that it self-verifies (S7) was not
  tested. The repo's contradicting evidence comes from Sonnet 5 stages. Fresh-eyes (Opus 5) outcomes
  were never measured.
- **Recall under this repo's reviewer prompt.** Whether the correctness-reviewer prompt's narrowing
  lowers recall (OP5P, S5P) was not measured. The reviewer's precision was checked on one finding
  only (MQ).
- **Drift inside lane runs.** Context drift or rot inside a single lane run was not measured. The
  Opus 5 "consistent throughout the window" claim (S8) was not tested against this repo's inputs.
- **Destructive actions by lane models.** No note counted destructive or out-of-bounds actions (W10),
  so the S5C and O5C behaviours have no repo counterpart yet.
- **`9279b93`'s coverage.** Whether it covers every way the acceptance author can drop a case
  (truncation, rename, move) was not re-read.
- **Prompts against model-specific removals.** No prompt file was audited line by line against the
  OP5P and S5P removal lists (verification instructions, emphatic language, status scaffolding).
  Only the implementer and correctness-reviewer prompts were read for this note.
- **Other sources.** Linked first-party material that was not fetched:
  - the Fable 5.1/Mythos 5.1 system card (fetched, not read; the harness does not run those
    models);
  - earlier model cards;
  - the claude.com blog posts STEER links to (CLAUDE.md files, configuring hooks);
  - the Agent SDK docs beyond the headless page.
- **Posts after the listing.** Engineering posts published after the 2026-09-17 listing of
  https://www.anthropic.com/engineering, if any, are not covered. The newest listed is
  how-we-contain-claude (2026-05-25).
- **Quote checks and page drift.** Quotes were checked against local copies of the pages as fetched
  on 2026-09-17 (text extracted from HTML, Markdown and PDF). The pages may change. PDF quotes were
  checked after whitespace normalisation.
- **Benchmark conditions.** The system-card benchmark figures are Anthropic's own runs under their
  harness settings. Infrastructure noise alone can move agentic coding scores ("leaderboard
  differences below 3 percentage points deserve skepticism",
  https://www.anthropic.com/engineering/infrastructure-noise).
