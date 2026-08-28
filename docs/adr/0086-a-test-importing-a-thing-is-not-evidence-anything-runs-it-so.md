# A test importing a thing is not evidence anything runs it, so the push gate measures reachability from lanes instead

Recorded 2026-08-28.

[#183](https://github.com/collod873/claude-workflow/issues/183) found five components built,
unit-tested, and wired to nothing. A dead-code check run the ordinary way would have cleared all
five, because the ordinary way treats the test suite as an entry point and every one of them had
tests. So `knip.config.ts` reads its entry set out of `.github/workflows`, `bin/`, and
`.claude/hooks` on every run — the three places that can actually invoke this repo's TypeScript —
and asks only whether a lane reaches a thing.

## Consequences

The gate is on the delta against a committed baseline, not on the whole answer. It landed against
31 standing findings, and each is a product decision — wire the fixer, or delete it — rather than a
lint fix, so gating the set would have blocked every push behind a triage nobody had scheduled. New
code that reaches nothing fails the push that introduced it, which is the property #183 says the
process never had. A baseline entry whose finding is gone also fails, on the `regenerate && diff`
reasoning of [ADR-0056](0056-bin-gauntlet-runs-the-check-contract-instead-of-three-hardco.md): a
baseline allowed to keep naming resolved debt stops measuring anything.

Two exemptions exist, and both make the export say in prose why: `@shell` for a real production
caller no static analysis can see (`bin/gauntlet` reaches `resolveSlot` through a dynamic `import()`
inside a heredoc), `@fixture` for a builder the suite alone is meant to reach. A silent entry in an
ignore list is indistinguishable from the dead code this check exists to find.

This check reads the module graph, so it sees a thing nothing imports. It does not see a branch
`main()` never takes, a CLI flag no caller passes, or a defaulted parameter every call site leaves
at its default — three of #183's five are exactly those, and they need instruments this one is not.
