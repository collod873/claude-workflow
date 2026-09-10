---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the tickets the user names. A ticket is done when every item under its
`## Acceptance criteria` is observably true in the diff; `close-ticket` will verify exactly
those, from the issue body, against your commits.

1. **Read the work.** `gh issue view <ticket> --comments` for each ticket; the criteria are the
   spec. Handed a spec with no sub-issues, stop and point at `/to-tickets`; there is no ticket
   for a commit to reference or `close-ticket` to close. Read `.claude/contract.json` for the
   check commands; each slot's `why` says who runs it.
2. **Pin `base`.** `git update-ref refs/implement/base HEAD` before your first commit, once for
   the session however many tickets it works. A ref already present means you are resuming,
   keep it. If it is missing and commits have already landed: on a branch, merge-base against the
   default branch; on `main`, stop and ask for the range.
3. **Build, per ticket.** `/tdd` at the seams the ticket names; if it names none, `/tdd`'s
   confirm-first rule applies. Iterate with `test_one` and `typecheck`. Commit to the current
   branch with `Part of #<ticket>` in every body: the ticket, never its spec.

   **Repair what your change turned red.** Tightening a rule makes an older fixture illegal;
   widening a type makes an older assertion incomplete. When your change is what reddened a test,
   bringing that test to the new behaviour is part of this change, not a follow-up ticket, and
   you do it even though the file sits outside the ticket's `## Files claimed`. Claimed files bound
   what you **decide**, never what you **repair**. Name every such file in the commit body, so the
   widening reads as a decision on the record rather than a file you appear to have wandered into.

   Two limits, and neither bends:
   - **Fix the fixture, never the assertion.** If making a test pass would mean changing what it
     claims to be true, that is your change being wrong rather than the test. Stop and say so.
   - **Leave the checks themselves alone.** Anything whose only effect is to stop a check from
     running (a suite's config, the CI workflow, a test written to hold this ticket) silences a
     gate without anyone reading a diff that says so. Where one of those genuinely is what needs to
     change, it is its own ticket, with that change as the visible point of it.
4. **Gate once.** Before your final commit, run the `all` slot bare so its own exit status is
   what you read. It is wider than typecheck and tests, and it names each check that reddens, so
   read the name rather than assuming which one it was. Duplication against a clone baseline, code
   nothing in the repo reaches, a malformed ADR trailer: each is a finding about work that passed
   every test you thought to run, each is cheap while the files are still open, and each is
   expensive once the ticket is closed. Green, then commit.

   Then, before step 5: walk the ticket's acceptance criteria one at a time and name, for each, the
   file that satisfies it. Every criterion has a file, or you are not done. `close-ticket` is about
   to run exactly those criteria, and catching the gap here costs one commit instead of a
   `needs-human` label.
5. **Close.** For each ticket, run `~/.agents/skills/bin/close-ticket <ticket> $(git rev-parse
   refs/implement/base)..HEAD <this checkout>` bare, passing this checkout's own path; it is
   already at `head` with dependencies present, so there is no separate tree to cut. It fetches
   the ticket's own criteria from the issue body, runs each one's `check:` marker here, posts the
   `## Closing record`, and closes the ticket itself: one command, no verdict for you to
   arbitrate.
   - Exit 0: the ticket is closed.
   - Nonzero: nothing was posted and the ticket is still open, and the failing criterion and its
     check command's combined output are on stderr. Fix the work, commit, gate, and re-run the
     same invocation against the same `base`. Still nonzero a second time: `gh issue edit
     <ticket> --add-label needs-human` and leave it open; your commits stand, the ticket
     carries the debt.
   - When every ticket is closed or labelled, `git update-ref -d refs/implement/base`.
