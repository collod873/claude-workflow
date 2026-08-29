# A lane that opens a pull request depends on a repository setting no file records, so the record is here and the installer sets it

Recorded 2026-08-28.

Lane 05 ends in `gh pr create`. On the first live run of the chain
([#188](https://github.com/collod873/claude-workflow/issues/188)) that call failed with
`GraphQL: GitHub Actions is not permitted to create or approve pull requests`, and nothing in the
tree could have said why: the cause is the repository setting *Allow GitHub Actions to create and
approve pull requests*, which lives in the repository's Actions settings and in no file. Every
`permissions:` block in `.github/` was right. The token was right. The gauntlet was green. The
setting was off, as it is on every new repository.

It was turned on by hand — `PUT /repos/{owner}/{repo}/actions/permissions/workflow` with
`can_approve_pull_request_reviews: true` — and this record is the only place that fact lives. The
ruling is about the class, not the one setting: **a lane may depend on repository state outside the
tree only if an ADR names the state, the API call that sets it, and the read that checks it.** The
tree is what the gauntlet sees and what a clone carries; state that is neither has to be written
down or it is rediscovered at the next install, by the next 403.

## Consequences

The read that checks it is
`gh api repos/{owner}/{repo}/actions/permissions/workflow --jq .can_approve_pull_request_reviews`,
and the answer has to be `true` for lane 05 to finish. A lane 05 run that fails with the
`not permitted to create or approve pull requests` message is this setting, not a token or a
`permissions:` block, and the fix is the `PUT` above, not a YAML change.

The installer ([#180](https://github.com/collod873/claude-workflow/issues/180), move 12,
`bin/install`) sets it on every target it stamps, because a target repository starts with the
setting off exactly as this one did. Until the installer exists, installing by hand includes the
`PUT`.

The same rule reaches any other out-of-tree dependency a lane acquires — a branch protection rule,
a required check, a repository secret. Each gets a line in an ADR naming the state, the call that
sets it, and the read that checks it; `CLAUDE_CODE_OAUTH_TOKEN` is the one such dependency the
lanes already had, and it is named in every workflow that spends it.
