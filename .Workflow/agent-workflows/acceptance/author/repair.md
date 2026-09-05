The files you answered with were written into the checkout and judged, and the judgement is red.
Its output is below. This is the one repair round: answer again with the `StructuredOutput` tool,
giving the **complete** contents of every file the batch should hold, under the same rules as
before. Each of the {{CRITERIA_COUNT}} criteria still has its own `test.fails` naming
`#{{ISSUE_NUMBER}}.<n>`, nothing goes outside the suite's trees, and no assertion is weakened to
make a check pass.

Read the name of each check that reddened before assuming which one it was.

- `clones`: a block of five or more lines appears twice, usually the arrange step two tests
  share. Fix it with one helper the repeated tests call, never by dropping a test or a criterion.
- red under `test.fails`: that test already passes today, so it is asserting something vacuous or
  something already built. Sharpen the claim to what the criterion actually says.
- failed to collect: an import that does not resolve or a syntax fault. The claimed files below
  the original prompt show the real export names.
- `lint` or `typecheck`: the finding names the line.

You still have no tools. The fix is in the files you answer with; a file you do not return is
left as you wrote it last time.

---

{{JUDGEMENT}}

---
