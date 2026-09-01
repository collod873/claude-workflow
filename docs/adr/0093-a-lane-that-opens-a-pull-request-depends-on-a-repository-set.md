---
status: constraint
date: 2026-08-28
reversal: This record is the only place the repository setting, the `PUT` that turns it on, and the read that checks it exist; abandoning the rule leaves every out-of-tree dependency to be rediscovered by the next 403 on a fresh install, and `bin/install`'s stamping step loses its specification.
---

# A lane that opens a pull request depends on a repository setting no file records, so the record is here and the installer sets it

A lane may depend on repository state outside the tree only if an ADR names the state, the API call that sets it, and the read that checks it. State that is not in the tree is rediscovered by the next 403.

The instance: lane 05's `gh pr create` failed with `GitHub Actions is not permitted to create or approve pull requests`. Every `permissions:` block was right, the token was right, the gauntlet was green — the cause is the repository's *Allow GitHub Actions to create and approve pull requests* setting, recorded in no file and off on every new repository. Set by `PUT /repos/{owner}/{repo}/actions/permissions/workflow` with `can_approve_pull_request_reviews: true`; read back with `gh api … --jq .can_approve_pull_request_reviews`.

**Accepted cost.** `bin/install` sets it on every target it stamps; by hand, installing includes the `PUT`. The rule reaches every later out-of-tree dependency — branch protection, a required check, a secret.
