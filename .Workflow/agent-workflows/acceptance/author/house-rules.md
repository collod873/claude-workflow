## Fixtures

Use the shared ones rather than writing your own: `shared/gh.fake.ts` (`createFakeGh`,
`createRecordingGh`) for a `GhExec`, `shared/git.fake.ts` for a `GitExec`, `shared/stage.fake.ts`
for a model stage, `shared/temp-repo.fixture.ts` for a real throwaway git repo,
`shared/scratch.fixture.ts` for a temp directory. Never define a function or const named `fakeGh`,
`createFakeGh`, `stubGh` or `makeGh` in a test.

## Two things the linter does

No hand-written `repos/{owner}/{repo}/...` REST paths, as a template literal or as a regex: build
them through `shared/gh-paths.ts`. No inline `err instanceof Error ? err.message : String(err)`:
use `reason(err)` from `shared/reason.ts`.
