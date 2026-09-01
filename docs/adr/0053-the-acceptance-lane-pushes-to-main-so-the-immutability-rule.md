---
status: constraint
date: 2026-08-26
amends: ADR-0032, ADR-0033
reversal: Reversing it means re-opening lane 04 on pull requests, restoring an exemption to the immutability refusal and buying an identity to authenticate it — a GitHub App or machine account, a stored credential and its renewal — plus edits to `immutable-set.ts`, `land-gate.ts`, `push-gate.ts`, `verify.yml` and `acceptance.yml`, and every repo the pipeline is installed into acquires that credential too.
---

# The acceptance lane pushes to main, so the immutability rule has no exemption and needs no second identity

Lane 04 commits its tests straight to `main`. It opens no pull request, so nothing legitimately modifies the immutable set and the refusal carries no exemption: no pull request may change `tests/acceptance/`, the runner's config, or `.github/` — nobody is exempt, and nothing reads an identity. Every lane runs as the built-in `GITHUB_TOKEN`: no App, no machine account, no new secret. An exemption is the attack surface; deleting it beats authenticating it. W2 holds because of where the code comes from, not who signed. Standing rule: no credential is referenced by a job a pull request can trigger. A second repo acquires nothing.

**Rejected:** a GitHub App or a machine account — identity options needed only while an exemption exists; keeping the PR and authenticating it.

**Accepted cost.** A bad batch reddens every in-flight PR at once, so the lane verifies before pushing and rebases rather than forces.
