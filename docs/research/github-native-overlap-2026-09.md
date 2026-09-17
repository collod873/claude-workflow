# Which GitHub-native features could take over landing, checking and scheduling

Researches: collod873/claude-workflow#653

Under map [#646](https://github.com/collod873/claude-workflow/issues/646), feeding its **Lanes**
question. Recorded 2026-09-17 against trunk `606e2c5`. Every availability claim was read that day
from docs.github.com (article bodies and each page's "Who can use this feature?" box). Repository
settings were read through the API and nothing was changed. Facts and candidates only, no rulings.
The lane census ([`lane-census-2026-09.md`](lane-census-2026-09.md)) checked only Claude Code
features; this note covers GitHub's own.

## Summary

- **Merge queue is not available to this repository.** GitHub offers it "in any public repository
  owned by an organization". `collod873` is a user account on the Free plan, so the queue that
  would take over Integrate's serial rebase-check-merge cannot be switched on. It becomes available
  only if the repository moves to an organization, and a free organization qualifies because the
  repository is public.
- **Auto-merge and required checks are available, and none is set up.** `allow_auto_merge` is
  `false`, there are no rulesets and `main` is unprotected. Auto-merge merges "after all required
  reviews and status checks pass", so it has nothing to wait on until a required check exists.
  Verify cannot be that check as wired: it runs on `repository_dispatch`, whose `GITHUB_SHA` is "Last
  commit on default branch", so its checks land on trunk and not on the PR head. The census
  Correction found the same thing from the other side.
- **GitHub can update a PR branch on the server, rebase included, but it does not resolve
  conflicts.** REST `update-branch` only merges. GraphQL `updatePullRequestBranch` takes
  `updateMethod: REBASE`. The docs allow an update "when there are no merge conflicts". A merge
  queue also just removes a PR that conflicts. Either way the PR and its branch stay open, where
  the implement lane's local rebase threw away 12 green runs.
- **Actions concurrency can now keep queued runs.** `queue: max` lets up to 100 runs wait in a
  group instead of the default one. Every lane group here uses the default, which is how Integrate
  lost 5 dispatches (PRs #509–#513) and reconcile had 702 runs superseded.
- **The token matters as much as the feature.** Every lane uses `GITHUB_TOKEN`, and events it
  causes "will not create a new workflow run", with two exceptions: `workflow_dispatch` and
  `repository_dispatch`. PR `opened`/`synchronize` events it causes create runs that need approval.
  That is why the lanes ring each other by dispatch and Integrate dispatches `ci.yml` after a merge
  (`integrate/integrate.ts:246-256`). A GitHub-native landing path would start from a PAT or a
  GitHub App token.

## This repository's settings

Read on 2026-09-17 with `gh api`. No setting was changed.

| Setting | Value | Source |
|---|---|---|
| Owner type / plan | `User`, plan `free` | `gh api repos/collod873/claude-workflow` (`owner.type`), `gh api users/collod873` |
| Visibility | `public` | same |
| `allow_auto_merge` | `false` | same |
| `allow_update_branch` | `false` (only controls whether the PR page always offers **Update branch**; the API endpoints are separate) | same |
| Merge methods allowed | merge, squash, rebase all `true` | same |
| Rulesets | none (`[]`) | `gh api repos/collod873/claude-workflow/rulesets`; `rules/branches/main` also `[]` |
| Branch protection on `main` | none ("Branch not protected", 404) | `gh api repos/collod873/claude-workflow/branches/main/protection` |
| Default `GITHUB_TOKEN` permissions | `read`; `can_approve_pull_request_reviews: true` | `gh api repos/collod873/claude-workflow/actions/permissions/workflow` |
| Fork PR approval policy | `first_time_contributors` | `.../actions/permissions/fork-pr-contributor-approval` |
| Lane concurrency | every group `cancel-in-progress: false`, no `queue` key (`shared/lane-wiring.ts:1273-1275`); Integrate's group is the single string `integrate` (`:756`), reconcile's `dispatch-reconcile` (`:934`) | `.github/workflows/integrate.yml:24-26`, `dispatch-reconcile.yml:24-26` |
| Lane token | `GH_TOKEN: ${{ github.token }}` for every lane but Enrol and Walk home (`ENROL_PAT`) | `shared/lane-wiring.ts:63-65`, `:1214`, `:1228` |

## Features

One row per feature. **Available here** is judged against a public, user-owned repository on
GitHub Free. **Would replace** names lanes from the census table and copied logic (C#) or
overlaps (O#) from its lists. A bare `:NNN` is a line of
`.Workflow/agent-workflows/shared/lane-wiring.ts`.

| Feature | What it does (docs) | Available here | Would replace | Gap: what the lane does that it does not | Docs |
|---|---|---|---|---|---|
| **Merge queue** | PRs join a FIFO queue. Each gets a temporary `gh-readonly-queue/{base}` branch holding "the latest version of the `base_branch` as well as changes from pull requests ahead of it", and merges once required checks pass on it. On "failed required status checks or conflicts with the base branch, the pull request will be removed from the queue", and the timeline shows why. Build concurrency is 1–100, group size 1–100, with a check timeout | **No.** "available in any public repository owned by an organization, or in private repositories owned by organizations using GitHub Enterprise Cloud". The repository would first have to move to an organization, and a free one qualifies for a public repository | 08 Integrate's serialisation (`integrate` group, `:756`), its rebase-onto-trunk and re-run gauntlet (`integrate/integrate.ts:193-206`, `:336`), `drainNextPr` (`:376-401`), C1's Integrate copy, O7's polling | Needs a required check that runs on the `merge_group` event ("You **must** use the `merge_group` event"); Verify has no such trigger. Removes a conflicting PR without resolving it or escalating to a named owner. No ticket close, no criteria run, no `graph-changed` / `ratifier-merged` rings, no immutable-set judgement unless that is a required check | [managing-a-merge-queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue), [merging-with-a-merge-queue](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-a-pull-request-with-a-merge-queue), [`merge_group` event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#merge_group) |
| **Auto-merge** | "merges a pull request automatically after all required reviews and status checks pass". It is enabled per PR by someone with write access (GraphQL `enablePullRequestAutoMerge`, `gh pr merge --auto`), and "disabled if someone without write permissions pushes new changes". The UI offers it "only on pull requests that cannot be merged immediately" | **Yes, but off.** "available in public repositories with GitHub Free". `allow_auto_merge` is `false` today | 08 Integrate's merge step (`mergePr`, `integrate.ts:232-244`) and its 40 × 15 s poll of Verify's log (`:120-157`, O7, C15) | Waits on required checks, and none exist. Does not rebase or update a behind branch, does not run the gauntlet on the rebased result, and does not close the ticket through `bin/close-ticket` or ring other lanes | [automatically-merging-a-pull-request](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request), [managing-auto-merge](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-auto-merge-for-pull-requests-in-your-repository), [GraphQL pulls reference](https://docs.github.com/en/graphql/reference/pulls) |
| **Required status checks** (ruleset rule or branch protection) | A check or commit status must be `success`, `skipped` or `neutral` before merge. **Strict** requires the branch to be up to date with base; **loose** does not. Checks "must pass on the latest commit SHA", and a check from a workflow skipped by path filter "remain[s] in a 'Pending' state" and blocks. A rule can pin the check to one app as its source | **Yes.** Rulesets are "available in public repositories with GitHub Free"; protected branches likewise. None is configured | Integrate's "absent verdict is a refusal" gate (`noteAcceptanceRefusal`); Verify's `Immutability` and `Verify` jobs could be the required checks | Verify runs on `repository_dispatch`, which judges trunk's SHA, so its check never attaches to the PR head. It would need a `pull_request` trigger (runs from `GITHUB_TOKEN`-opened PRs need approval), a PAT/App token, or a commit status posted on the head SHA. A required-PR or required-check rule on `main` also stops direct pushes: the owner's 265 pushes and the lanes' `push-to-trunk` (Shape-accept, Back-stamp) would need bypass entries. Repository admins and GitHub Apps are eligible | [about-protected-branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging), [available-rules-for-rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-status-checks-to-pass-before-merging), [troubleshooting-required-status-checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks), [creating-rulesets (bypass)](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository#granting-bypass-permissions-for-your-branch-or-tag-ruleset) |
| **Update a PR branch** (REST `PUT /pulls/{n}/update-branch`; GraphQL `updatePullRequestBranch`) | REST: "merging HEAD from the base branch into the pull request branch", with optional `expected_head_sha`, returning 202, or 422 "Validation failed". GraphQL: `updateMethod` `MERGE` or `REBASE`. On the PR page, update works "when there are no merge conflicts", and "If changes to the base branch cause merge conflicts ... resolve the conflicts before updating the branch" | **Yes.** It needs write access to the head repository. `allow_update_branch: false` only hides the always-on button | The rebase in C1's Integrate and Fixer copies, done on the server and leaving the branch in place; `--force-with-lease` push (C6) | Does not resolve conflicts, and the conflict response detail is not documented beyond 422. Implement and Acceptance rebase **before** their first push (`shared/implementation-landing.ts:74-103`), so no PR branch exists yet for the server to update. A `GITHUB_TOKEN` update creates no `push` runs and approval-gated `pull_request` runs | [REST pulls: update a pull request branch](https://docs.github.com/en/rest/pulls/pulls#update-a-pull-request-branch), [GraphQL pulls reference](https://docs.github.com/en/graphql/reference/pulls), [keeping-your-pull-request-in-sync](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/keeping-your-pull-request-in-sync-with-the-base-branch), [managing-suggestions-to-update-pull-request-branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-suggestions-to-update-pull-request-branches) |
| **Merge a PR asynchronously** (REST `PUT /pulls/{n}/merge-async`) | Merges "in the background", so some errors can be retried. `merge_action` is `default`, `merge_queue` or `direct_merge`. "Branch protection rules and repository rules are not run at this stage" | **Yes** (write access). Without a merge queue, `merge_queue` has nothing to enqueue into | Nothing new: Integrate's `gh pr merge --merge` | Same as auto-merge: no checks of its own | [REST pulls: merge asynchronously](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request-asynchronously) |
| **Actions concurrency `queue: max`** | Default `queue: single`: "At most one ... can be `pending` ... any existing `pending` ... is canceled and replaced." `max`: "Up to 100 jobs or workflow runs can be `pending`", run in the order they started waiting. It cannot be combined with `cancel-in-progress: true` | **Yes.** It is on the github.com workflow syntax page with no plan limit or preview note | The cancellations: 5 Integrate dispatches whose PRs #509–#513 sat unmerged, 9 Integrate runs cancelled in the window, 702 reconcile runs and 18 Lost-dispatch counter runs superseded (census O12). Also `drainNextPr`'s re-send, which exists to recover dropped dispatches | Only order and survival change; runs are still one at a time. For reconcile, queueing all would have run the 702 superseded recomputes, most of which wrote nothing (census O12). At most 100 waiting, then cancels | [control-workflow-concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency), [workflow-syntax `concurrency`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency) |
| **`workflow_run` event** | Starts a workflow when another workflow is `requested`, `in_progress` or `completed`. `GITHUB_SHA` is the default branch. "You can't use `workflow_run` to chain together more than three levels" | **Yes** (Bypass counter already uses it, `:1115`) | O7: Integrate polling Verify's log instead of being rung | The payload names a run, not a PR, so "which PR did Verify judge" (C15) remains. Reconcile's `workflow_run` door was removed after 1,054 wakes (census) | [events: `workflow_run`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run) |
| **Commit statuses API** (`POST /statuses/{sha}`) | "Users with push access ... can create commit statuses for a given SHA." Statuses can be required checks, and a rule can pin one to an app source | **Yes** | C15's three ways of reading which PR Verify judged: Verify could put its verdict on the PR head SHA itself | Anyone with write access can set any status unless a source app is pinned. A status set with `GITHUB_TOKEN` starts no `status`-event workflow | [REST commit statuses](https://docs.github.com/en/rest/commits/statuses#create-a-commit-status), [status-checks](https://docs.github.com/en/pull-requests/reference/status-checks) |
| **`schedule` event** | Cron in UTC or a named timezone; "The shortest interval ... is once every 5 minutes". It "can be delayed during periods of high loads ... some queued jobs may be dropped". "In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days" | **Yes** | The `session-captured` sweeps silent since 2026-09-09: Run watchdog, Walk home, Audit's door (O3, O4). Bypass counter's per-Verify wake (O10). A periodic reconcile pass in place of its five event doors (O12) | Audit reads a session's commit range (`client_payload.head`, `:961`), which a schedule does not carry. A dropped or delayed run leaves a ready ticket idle until the next tick | [events: `schedule`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) |
| **Closing keywords / linked PRs** | "When you merge a linked pull request into the **default branch** ... its linked issue is automatically closed", via `Closes #N` and similar in the PR body or a commit message | **Yes** | The close step of `bin/close-ticket` as Integrate calls it (`integrate.ts:273-283`). Lane PR bodies use `Ticket: #N` (`:62-73`), not a closing keyword | Closes with no `check:` markers run and no `## Closing record`. `bin/close-ticket` refused 15 merged tickets (run-outcomes) that a keyword would have closed unchecked | [linking-a-pull-request-to-an-issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue) |
| **Issue dependencies** (blocked by / blocking) | Marks issues blocked by others and shows a "Blocked" icon. `gh issue create --blocked-by`, `gh issue view --json blockedBy,blocking`, plus REST endpoints | **Yes.** "available for users on GitHub Free". Reconcile already reads `blocked_by` (census: the 09-14 crash in `wireClaimCollisions`) | Already in use as reconcile's ordering input | Display only: nothing is dispatched when a blocker closes, and it knows nothing of file claims | [creating-issue-dependencies](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies) |
| **Push rulesets: restrict file paths** | "Prevent commits that include changes in specified file paths from being pushed", with `fnmatch` and exceptions | **No.** "Push rulesets are available for the GitHub Team plan in internal and private repositories", and this repository is public on Free | Verify's `Immutability` job and the immutable set (`shared/immutable-set.ts`) | It would block every push, the owner's included, unless bypassed; the lane refuses a PR rather than a push | [about-rulesets: push rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets#push-rulesets), [available-rules: restrict file paths](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#restrict-file-paths) |
| **Copilot cloud agent, third-party coding agents** (Anthropic Claude, OpenAI Codex) | Assign an issue and the agent works on a branch and opens one PR. Among its listed jobs: "Resolve merge conflicts". Each session is capped at 59 minutes. Third-party agents are "in public preview" | **Unverified.** It needs "all paid Copilot plans"; whether `collod873` has one was not checked. **Copilot automations** (schedule and event triggers) are "not available in public repositories" | 05 Implement / Mechanic; the hand rebuild of conflicted runs (the nine #538 runs rebuilt 2026-09-16) | No ticket brief, file claims, strike ladder, acceptance-first tests or landing. A human assigns the issue (automations cannot run here). Spend is Copilot's, not the `CLAUDE_CODE_OAUTH_TOKEN` subscription | [about-cloud-agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent), [about-automations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-automations), [about-third-party-coding-agents](https://docs.github.com/en/copilot/concepts/agents/about-third-party-coding-agents) |

### The token rule under every row

From [trigger-a-workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow):
"events triggered by the `GITHUB_TOKEN` will not create a new workflow run", except that
"`workflow_dispatch` and `repository_dispatch` events always create workflow runs". When a
`GITHUB_TOKEN` workflow opens or updates a PR, the `pull_request` runs start in an
"**approval-required** state" that a user with write access must approve. A GitHub App token or a
PAT avoids both limits. This bears on the rows above:

- A `pull_request`-triggered Verify would wait for a human approval on every PR Implement opens
  with `GITHUB_TOKEN`.
- A merge done with `GITHUB_TOKEN` starts no `push` run on `main`. Integrate therefore dispatches
  `ci.yml` itself (`integrate.ts:246-256`), and the 178 push-to-main Verify runs came from owner
  pushes rather than lane merges.
- Whether an enqueue or auto-merge set up with `GITHUB_TOKEN` fires `merge_group` runs and a
  post-merge `push` was not found in the docs (see [Not verified](#not-verified)).

## Against the evidence in #653

| Evidence | Nearest GitHub feature | What the docs say it would do |
|---|---|---|
| 12 green Implement runs discarded at the pre-push rebase ($50.31; run-outcomes class 5) | Server-side update-branch, merge queue | Neither resolves a conflict. Both leave the PR and branch open (update refuses on conflict; the queue removes the PR and records why), where the local rebase aborts before anything is pushed. Keeping the work depends on pushing before rebasing, which is a lane change, not a GitHub setting |
| Verify's PR check judged trunk, not the PR head (census Correction) | Required status checks | `repository_dispatch` sets `GITHUB_SHA` to "Last commit on default branch", so a required check fed by it cannot pass on a PR head. This is the same mechanism the Correction found in `verify.yml`'s checkout |
| Integrate polls Verify's log (O7) | Auto-merge + required checks; `workflow_run`; commit statuses | Auto-merge removes the poll once a required check sits on the head SHA; `workflow_run` removes it without naming the PR |
| Integrate cancelled 5 dispatches, stranding PRs #509–#513 | `queue: max` | Up to 100 pending runs would have waited instead of being replaced |
| Reconcile: 1,787 runs, 702 cancelled | `queue: max` or `schedule` | `queue: max` keeps them all, `schedule` replaces event wakes with a tick of at least 5 minutes; neither decides which wakes are worth running |
| Four copies of rebase-and-abort (C1) | Update-branch API (merge or rebase) | One server-side operation with one documented outcome for conflicts (refusal), in place of four local ones |

## What only the lanes do

No GitHub feature read here does these. Each is where a lane still has a job even if the
GitHub-native features above were switched on.

- **Acceptance tests authored before the implementation.** Lane 04 writes the ticket's tests to
  `accept/issue-N` before an implementer runs, and Implement starts from that branch
  (`shared/implementation-landing.ts:105-118`). Required checks only run the tests that are
  already in the PR.
- **The immutable set, judged per PR.** `integrate/immutability.ts` refuses a PR whose changed
  files touch `shared/immutable-set.json`'s list. The nearest GitHub rule, push rulesets' restricted
  paths, is not available here and would block pushes rather than refuse one PR.
- **Claim-based scheduling.** Reconcile reads each ticket's `## Files claimed`, holds back a ticket
  whose claim collides with a live one (`dispatch/reconcile.ts:593-620`), and applies the claim limit
  and by-hand paths. Issue dependencies order by blocker only, and the merge queue orders by arrival.
- **Closing on checked criteria.** `bin/close-ticket` runs each criterion's `check:` marker,
  posts a `## Closing record`, and refuses to close on a failure or on all-unverified criteria.
  Closing keywords close on merge, unconditionally.
- **The retry ladder.** Strikes, fresh eyes, mechanic and the owner decision (`shared/strikes.ts`,
  `climbLadder` at `dispatch/reconcile.ts:843`), plus the Fixer's attempt counter and Acceptance's repair rounds.
  Auto-merge and the merge queue stop at a red check.
- **Escalating a stop to a named owner with the reason.** `needs-human` with conflicting paths
  (`integrate.ts:208-230`). The merge queue writes the removal reason to the PR timeline and
  assigns no one.
- **Rings between lanes.** `graph-changed`, `ratifier-merged`, `review-wanted`, `fixer-needed`,
  `run-ended` are repository dispatches carrying lane meaning. `workflow_run` carries a run, not a
  ticket or PR.
- **Running the whole gauntlet on the rebased result before merge.** This is what a merge queue
  does, and the one landing job GitHub has a native answer for. That answer is unavailable to a
  user-owned repository.
- **Model work.** Spec critique, slicing into tickets, implementing, reviewing, ratifying. Copilot's
  cloud agent overlaps with implementing only, needs a paid Copilot plan, and cannot be triggered by
  automation in a public repository.

## Not verified

- **Merge queue on a user-owned repository through the API.** The docs' availability box
  excludes it, and the REST rules schema lists a `merge_queue` rule type. Creating one was not
  tried, because this research changes no settings.
- **Organization transfer.** The docs make merge queue available to a public repository owned by
  any organization. What a transfer would break was not researched: caller stubs in enrolled
  repositories that reference `collod873/claude-workflow/...@main`, secrets, `ENROL_PAT` scope,
  and redirects.
- **`GITHUB_TOKEN` and auto-merge or the queue.** No doc read says whether a PR enqueued or set to
  auto-merge with `GITHUB_TOKEN` gets `merge_group` runs, or whether the eventual merge starts a
  `push` run.
- **Auto-merge on a behind branch under strict checks.** The docs do not say auto-merge updates the
  branch; that it would wait until someone does is an inference.
- **`enablePullRequestAutoMerge` on a PR that could merge now.** The UI hides the option in that
  case; the API behaviour is not documented on the pages read.
- **The REST update-branch conflict response.** Documented only as 422 "Validation failed, or the
  endpoint has been spammed".
- **Bypass for the lanes' token.** Rulesets list repository admins and GitHub Apps as eligible
  bypass actors. Whether the `github-actions` identity behind `GITHUB_TOKEN` can be added in a
  user-owned repository was not checked.
- **Copilot plan on `collod873`.** Not checked, so cloud-agent availability here is unknown.
- **`queue: max` in a called (reusable) workflow.** The lanes set `concurrency` at the top of the
  reusable workflow (`integrate.yml:24-26`). The docs describe `queue` for workflow and job
  concurrency without mentioning `workflow_call` separately.
- **Nothing was run.** No ruleset, auto-merge, queue or schedule was tried; all behaviour is as the
  docs state on 2026-09-17.
