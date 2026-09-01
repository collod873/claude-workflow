---
status: constraint
date: 2026-09-01
amends: ADR-0055
reversal: Reversing it means minting a fine-grained PAT again, storing it as a secret in every enrolled repository, and building the rotation and revocation path that credential needs — plus rewriting the enrol lane (this ADR's sibling) to provision that secret alongside the stubs it already writes.
---

# A caller checks out the machine with no credential at all, because the repository is public

ADR-0055 gave a caller stub a read-only fine-grained PAT to check out this repository. That PAT is
now unnecessary: ADR-0075 made this repository public, and `actions/checkout` reads a public
repository with no credential — anonymous, or the ambient `GITHUB_TOKEN`. The PAT bought read
access to a private repository that no longer exists; keeping it means rotating a credential in
every enrolled repository for nothing.

A caller stub is now exactly what ADR-0055 already called it — a trigger and a `uses:`, six lines,
naming `@main`, no secret. The enrol lane (ADR-0133) writes it in without provisioning credentials.

**Rejected:** keeping the PAT "just in case" the repository goes private — cheap to reverse since
nothing depends on it today, and an unused credential is the attack surface ADR-0053 named.

**Accepted cost.** If made private again, every enrolled caller silently fails checkout instead of
failing on an expired token.
