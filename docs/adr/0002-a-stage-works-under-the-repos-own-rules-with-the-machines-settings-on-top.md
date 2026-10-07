---
status: constraint
date: 2026-10-07
reversal: Each repo's rules would have to be copied into stage prompts or go unread, and the copies would drift from what interactive sessions follow.
---

# A stage works under the repo's own rules, with the machine's settings on top

Every stage loads the target repo's project settings: its CLAUDE.md files and its
`.claude/settings.json` hooks, the rules an interactive session there follows. The
machine's own settings outrank them: its env, its deny list and `disableAllHooks:
false`, so no repo can switch off the owner's hooks or the fence.

Each rule has one home. A repo's rules live in that repo, the machine's rules for a
target repo live in the stage prompts, and the owner's rules for every repo live in
agent-hooks. A new stage or a newly enrolled repo copies none of them. When a repo
setting could loosen a machine rail, the machine pins that setting.

**Rejected: stages that load no setting sources.** Lumaria's builders ran without its
CLAUDE.md, its ui-guard and its design hooks, and read CLAUDE.md only when they
thought to.
