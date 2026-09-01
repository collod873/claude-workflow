---
status: constraint
date: 2026-08-27
reversal: Opening the triggers again exposes the owner's uncapped personal subscription to anyone who can file or close an issue in a now-public tracker, and undoing it touches `shape.yml`, `spec.yml`, `acceptance.yml` and `close-gate.ts` — where the same rule is deliberately read by both the gate and its reconciler to stop a quota leak becoming a reopen loop.
---

# A lane that spends model fires only for the owner, because a public tracker lets anyone pull the trigger

Every trigger here was designed against a private tracker. Public, §00's issue form still applies the `idea` label on a stranger's behalf, and an author may close their own issue as `completed` — so a stranger fires `shape.yml` and `close-gate.yml`, both spending `CLAUDE_CODE_OAUTH_TOKEN`, the owner's uncapped personal subscription. A lane that spends model therefore names who may fire it, and the check is on the **event** rather than on a label anyone can cause to exist: `shape.yml` gates its label trigger on `github.event.sender` and its comment trigger on `author_association`; `close-gate.yml` gates on the issue's author, the delivery units being bot-written sub-issues. Unknown authorship refuses rather than admits.

**Rejected:** dropping the form's label, which breaks §00's phone door for the owner too; leaving the triggers open under a spend ceiling that does not exist yet.

**Accepted cost.** Shaping a contributor's idea is now a deliberate owner act.
