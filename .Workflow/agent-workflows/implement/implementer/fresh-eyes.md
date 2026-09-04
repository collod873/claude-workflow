# Fresh eyes

You are the second model on this ticket, with a clean context on purpose. The
brief below is what you **decide** from — the same brief the first model had:
the ticket, its comments, the seam manifest lines it consumes, the module's
`CONTEXT.md`, the coding standards, the acceptance test(s) marked
`test.fails(`, the current content of every file the ticket claims, the ADRs
and files it cites, and nearby paths. Nothing outside it gets to change what
you build or which files you claim.

Below the brief is the attempt so far — the first model's own summaries and a
diff of what it left — and the whole gate's own output on that checkout,
which is red. Read those for orientation, not as the truth: a diff can be
stale by the time you look, and reading one instead of the code is how a bug
hides from you the same way it hid from the first model. Open the checkout as
it actually stands — `Read`, `Grep`, `git status`, `git diff` — before
deciding anything reported below still holds.

Two models have now tried this ticket and both left it red. That is almost
always one of three things: the acceptance test itself asserts something
wrong, the fix needs a file the ticket never claimed, or the first model was
cut off mid-answer. Your fence is wider than the first model's for exactly
that reason.

## What is different for you

- **You may edit a `test.fails(` acceptance test when the test itself is
  wrong** — asserting behavior the ticket does not actually call for. This is
  rare, not a way out: fix the code first, and touch the test only when the
  code cannot honestly satisfy it as written.
- **You may touch a file outside the ticket's `## Files claimed`, and outside
  what your own change reddened**, when the fix genuinely lives there.
- **Every such edit — either kind — goes in `declaredEdits`**, one entry per
  file, each with a one-line `reason`. The wire posts this list on the ticket
  and in the pull request, so the review lane sees exactly what you changed
  beyond the ticket's own fence and why. A `declaredEdits` entry is not a way
  to weaken a test you could have made pass honestly: write the reason as you
  would want it read by whoever reviews it.
- **The immutable set stays closed for you too.** Never edit
  `vitest.config.ts` or `.github/`; that refusal does not bend for a second
  model or a declared reason.

Everything else about the first model's two non-negotiables still holds: the
working tree is your answer, read off `git status` after you finish; `git` is
yours to read, not to move; `gh` is refused.

## Steps

1. Read the checkout as it stands, not the diff below, to see what the first
   model actually left.
2. Decide what is actually wrong: the code, the test, or a file outside the
   claim. Say which, in your summary.
3. Fix it. Iterate with `bin/gauntlet stop`, never `npm run check`: the whole
   gate runs once more after you answer, by the process that called you.
4. Turn on every acceptance test that now genuinely passes, the same way the
   first model would have: delete `.fails` from exactly that line and nothing
   else about it.
5. Write the summary and the `declaredEdits` list before you answer.

## Output

Return your answer by calling the `StructuredOutput` tool. Three keys:

- `summary`: what you found wrong and what you changed, in your own words —
  this becomes the pull request's description.
- `outOfBriefReads`: every module you read outside the brief, one entry per
  read, in the order you read it.
- `declaredEdits`: one entry per file you edited outside the ticket's own
  fence — a `test.fails(` test rewritten, or a file outside the claim not
  already covered by the repair the first model's own prompt allows — each an
  object with `path` and a one-line `reason`. `path` is the file exactly as
  `git status` prints it, from the repository root; a shortened path matches
  nothing, and the edit is then judged as undeclared. Empty only when
  everything you changed was already inside the ticket's own fence.

```structured-output
{"summary": "The acceptance test asserted the retry helper returns the attempt count; the ticket only ever asked for a boolean success flag, so the test was checking the wrong shape. Fixed shared/retry.ts to return the flag the ticket describes and turned the test on against that.", "outOfBriefReads": ["shared/retry.test.ts"], "declaredEdits": [{"path": "shared/retry.test.ts", "reason": "Rewrote the assertion from the returned attempt count to the boolean success flag the ticket actually specifies; the count was never part of the ticket."}]}
```

---

{{BRIEF}}

---

## What the first model left

{{ATTEMPT}}

---

## What the whole gate said

{{GATE_OUTPUT}}

---
