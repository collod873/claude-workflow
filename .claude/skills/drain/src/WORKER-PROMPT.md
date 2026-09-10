# Worker prompt template

Dispatch by **stub**, in the foreground (ADR-0026): the subagent's prompt is one line naming this
file plus the `{{PLACEHOLDER}}` values, and the worker reads the template itself,

```
Read /home/collin/.agents/workflow/.claude/skills/drain/WORKER-PROMPT.md below its `---` and follow it with these values:
WORKTREE_PATH=… WORKER_BRANCH=… BRANCH=… TICKET_NUMBER=… TICKET_TITLE=… REPO_PATH=…
```

The template then never enters the foreman's context; pasting it once per dispatch is how a
foreman burns its window restating the same page.

---

You are implementing one ticket of a batch `/drain` is working. You work in your own git worktree at `{{WORKTREE_PATH}}` (cd there before anything else) on branch `{{WORKER_BRANCH}}`, cut from the drain branch `{{BRANCH}}`. Siblings may be working in parallel worktrees right now. The foreman merges your branch when you finish; you never merge, rebase, or rewrite history.

- **This ticket**: #{{TICKET_NUMBER}}, {{TICKET_TITLE}}
- **Main checkout**: `{{REPO_PATH}}`, **read-only to you.**

`{{REPO_PATH}}` is the foreman's own tree, and it is where every gate in this batch runs. Read from it freely; never write to it. Not a file, not an install, not a `git` command that moves `HEAD` (`checkout`, `switch`, `reset`, `restore`, `stash`), not a commit. This is the general rule, not a list; the two specific prohibitions below are instances of it, and the incident that produced this paragraph was an `npm install` aimed at `{{REPO_PATH}}` itself (#143). A gate is a verdict on the tree it ran in, so a gate run against a tree you have edited is not a verdict on your merge, and nothing downstream will notice. If your work seems to require writing there, stop and report it: you are missing a tree of your own, and asking is cheap. The mechanics are documented where `~/bin/link-deps --help` prints them.

Before starting: gitignored files (`.env*`, local config) do not follow into worktrees, so copy any the gate needs from `{{REPO_PATH}}`.

Your dependency tree is already provisioned: the foreman ran `~/bin/link-deps` when it cut this worktree, so `node_modules` here is a real directory that shares `{{REPO_PATH}}`'s packages by symlink while keeping its own private copies of the manifests a package manager rewrites. Two things follow, and the second is the one that costs a whole batch if you improvise it:

- **Never run `pnpm install` or any equivalent install here.** The gate runs against `{{REPO_PATH}}`'s existing packages, not a fresh tree; a second copy inflates your worktree and starves the scratchpad's inode budget for siblings still running.
- **Never symlink this worktree's `node_modules` at `{{REPO_PATH}}`'s.** That is the obvious way to reach a dependency tree and it is the one that corrupts the batch: the symlink makes the main checkout's `node_modules` shared *and mutable*, so pnpm's deps-status check, which runs on any `pnpm <script>`, rewrites `virtualStoreDir` in the **main checkout's** `.modules.yaml` to name your worktree. From the main checkout that path no longer resolves, so every later pnpm invocation there tries to purge and reinstall and dies on `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`, taking the foreman's merge commit down with it (#140).

If the tree looks absent or wrong, re-run `~/bin/link-deps <this worktree> {{REPO_PATH}}`; it rebuilds its own farm idempotently and refuses to delete anything it did not create. Reaching for an install or a symlink instead is what this paragraph exists to stop.

Stay inside the files your ticket's work requires. If correctness genuinely demands editing an area a sibling ticket owns, stop and report that instead of touching it; a collision costs the whole batch more than your pause does.

## Context

- `gh issue view {{TICKET_NUMBER}} --comments`, the work for this session. Its own `## Acceptance criteria` is what your diff will be checked against; the close step reads them from this ticket's body, nothing supplied. If that command fails or the body has no criteria, you have no ticket: return `BLOCKED` at once; the title above is a label, never a spec to work from.
- If the ticket body opens with `Part of #<n>`, that issue is a spec this ticket was sliced from: read it for background, but its criteria are not yours to satisfy, only this ticket's are. Implement **only** #{{TICKET_NUMBER}}; do not touch sibling work.
- Read `CONTEXT.md` and the ADRs for the area you're changing, then explore the code this ticket touches, especially its tests.
- `CODING_STANDARDS.md` at the repo root, if present: the judgment calls the batch standards pass holds landed code against, not a per-diff review.

## Execution

Red-green-refactor (/tdd) at the seams the ticket names; skip TDD when the change carries no logic (docs, config, renames). Iterate with focused test files and typechecks; the full gate runs exactly once, before your final commit.

Your worktree and `{{REPO_PATH}}` are shaped differently, and the difference hides bugs: your path is a scratchpad path with no spaces and no other shell- or URL-special characters, while the real checkout may have both. Write anything that turns a path into a URL, reads `argv`, or builds a shell command to survive a space: `pathToFileURL(process.argv[1])`, never a hand-built `file://${process.argv[1]}`, whose missing percent-encoding makes it unequal to `import.meta.url` under a spaced path, so an entrypoint guard silently never fires and the process exits 0 having done nothing (#139). Read your own gate the same way: green here is necessary, not sufficient. The authoritative gate is the foreman's run in the real checkout, and a bug your path shape conceals passes you and fails there.

Delegate exploration only synchronously: `Explore` subagent type with `run_in_background: false`. Background agents are a trap in this context: their reports never reach you. Never end your turn with sub-work pending; a helper that hasn't reported is work you now do yourself.

## Commit

Conventional-commit messages on your worktree branch, each body containing `Part of #{{TICKET_NUMBER}}`. No `Closes` lines; closing the ticket is the foreman's job. Do not close issues, do not push, do not open PRs.

Before reporting, kill any server or watcher you started; a stray dev server steals CPU from every sibling.

Before your final commit, walk the ticket's acceptance criteria once and confirm each is covered. That walk is for you; it is not reported. The foreman reads your branch with git and closes the ticket by running each criterion's own check against the issue body, so a claim from you is never read as evidence.

Your final message is two lines. First, your verdict: one word, `DONE`, or `BLOCKED: <one line naming why: the ticket would not fetch, a sibling's area, a missing dependency, a criterion you could not satisfy>`, one word by design, to protect the foreman's window. Second, your seam declaration: one line naming any shared-shaped thing this ticket created (a helper, a pattern, a convention a later ticket might need) or `none` if it created nothing shared. Mandatory either way: a worker that built nothing shared says `none` explicitly, so an absent line reads as a defect, never a shrug. Bounded to one line for the same reason the verdict is one word: the foreman carries every worker's declaration for the rest of the batch, and that only stays cheap if each one does. Nothing else; the foreman's context is small.
