---
name: research
description: Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to a background agent.
---

Spin up a **background agent** to do the research, so you keep working while it reads. When you launch it, print the AFK line: "Research runs in the background; silence is normal. The findings file lands in the repo."

Its job:

1. Investigate the question against **primary sources** (official docs, source code, specs, first-party APIs), not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings to a single Markdown file, citing each claim's source.
3. Save it where the repo already keeps such notes; match the existing convention, and if there is none, put it somewhere sensible and say where.

## Acceptance criteria and closing

A research ticket carries `## Acceptance criteria` like any other ticket in the pipeline. The
findings file this step writes is a commit, a diff, so a research ticket never closes on
`No diff.`; that exemption covers only a ticket that truly produces no commit. Close it the way
any diff-carrying ticket closes: commit the findings file, then run
`~/bin/close-ticket <ticket> <base>..<head> <checkout>` bare; `<checkout>` is
wherever the commit landed, that ticket's own worktree when one was cut for it. It fetches the
ticket's own criteria, runs each one's `check:` marker there, posts the `## Closing record`, and
closes the ticket itself. Exit 0: closed. Nonzero: nothing was posted, so fix what stderr names and
re-run the same command.
