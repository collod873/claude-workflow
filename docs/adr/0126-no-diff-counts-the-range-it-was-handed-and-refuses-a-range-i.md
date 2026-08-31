# No diff. counts the range it was handed, and refuses a range it cannot count

Recorded 2026-08-31.

`## Closing record / No diff.` is a claim about a **range**, not about a body. `bin/close-ticket`
reached it by reading the body instead: no `## Acceptance criteria` heading meant "map or task
ticket", which discarded `args.range` unread and exited 0. #283 closed COMPLETED on `No diff.`
against a range carrying a real commit; eighteen issues had closed that way, twelve of them
referenced by real commits, and the rate was rising as the machine closer took over from people.
So the branch now runs `git rev-list --count` on the range it was given and refuses when the
answer is not zero.

A range git cannot count — a checkout that is not a repository, a revision it does not resolve —
refuses down the same path, because reading nothing is not reading zero. The alternative was to
fall back to `No diff.` when the count fails, which keeps every existing invocation green; it also
leaves the old behaviour one bad `<checkout>` argument away, on precisely the runs where nobody is
watching.

Consequences: a map or task ticket now names the empty range it actually carried
(`<head>..<head>`) rather than any range at all, and a lane 08 close of a criteria-less ticket
refuses instead of writing a false record — which is the correct outcome, since a pull request's
own commits are never zero. The complementary half, `~/bin/file-issue` labelling a `ticket`
`ticket` so the kind survives filing, lands in `collod873/agent-skills`; it is the better fix and
the weaker guarantee, because it cannot reach the 187 issues already filed without a label. #300.
