---
status: constraint
date: 2026-09-06
reversal: Putting `ratify-release.yml` back on a `pull_request: closed` door means every ratifier merge again writes no `ratified` record, so the revert detector has nothing to compare and a reverted standard is re-proposed on the next batch, which is the state the tree sat in from 2026-08-29 to 2026-09-06 across eleven merged ratifier PRs.
---

# The ratifier's merge is announced by a ring from lane 08, because a pull_request door never hears a merge the Actions token made

Lane 08 merges every pull request with the Actions token, and GitHub starts no workflow for an
event that token caused. A lane whose only door is `pull_request: closed` therefore wakes for the
owner's hand merges and never for the machine's own. `ratify-release.yml` sat on that door, gated
on the ratifier's PR title: eleven ratifier PRs merged, the lane fired four times, all on
hand-merged PRs, all skipped. No `ratified` record was written after 2026-08-29, so
[ADR-0123](0123-the-owner-signs-by-not-reverting-and-a-revert-writes-decline.md)'s detector had
nothing to compare against.

Lane 08 now rings `ratifier-merged` when the PR it merged carries the ratifier's title, and the
recording lane wakes on that ring alone. A merge the machine makes is announced by the machine,
never inferred from an event it cannot raise.

**Rejected: merging with `ENROL_PAT` so the close event is real.** Spends the owner's token on
every merge to wake one lane.
