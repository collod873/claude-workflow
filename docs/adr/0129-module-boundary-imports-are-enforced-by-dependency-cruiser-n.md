---
status: constraint
date: 2026-09-01
reversal: Undoing it means dropping .dependency-cruiser.cjs, its baselined delta, and the generated doc, then re-deriving the same three rules as ESLint selectors, a differently-shaped baseline (ESLint has no built-in per-edge violation identity the way dependency-cruiser's JSON reporter does), and a new CLI to drive them — not a config swap.
---

# Module-boundary imports are enforced by dependency-cruiser, not an ESLint import-boundary plugin

#305 needed "may this import that?" for three rules — a lane may not deep-import another lane,
`shared/` may never import a lane, no cycles — on a repo that already lints with ESLint, including
one existing import-boundary rule (`acceptance-boundary/no-outside-import`). `eslint-plugin-import`
and `eslint-plugin-boundaries` were the ESLint-native alternative and were rejected: neither reports
an edge's `{rule, from, to}` as data the way dependency-cruiser's `--output-type json` does, so the
`regenerate && diff`-baselined-delta shape `wiring-baseline.ts` (#183) already established for knip
would have to be rebuilt against ESLint's message strings instead of reused against it.

dependency-cruiser is a second lint-shaped tool as a result — `bin/gauntlet push`'s `boundaries`
check runs it, not `lint`. The alternative (parse ESLint messages, or hard-fail on 67 standing
violations with no baseline) was worse on both axes this ticket cared about: reusable baseline
plumbing, and standing violations judged as debt rather than a wall to clear first.
