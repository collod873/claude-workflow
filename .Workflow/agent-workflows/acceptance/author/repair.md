The lane judged what you wrote in the checkout, and the judgement is red. Its output is below. Fix
it in place, under the same rules: your diff against `HEAD` only adds, every test you wrote still
fails today, and no assertion is weakened to make a check pass. If you removed a line, put it back
exactly as it was.

Read the name of each check that reddened before assuming which one it was.

- `clones`: a block of five or more lines appears twice. Fix it with one helper the repeated
  tests call, never by dropping a test.
- red under `test.fails`: that test already passes today. Sharpen it to what the criterion claims,
  or remove the test if the criterion is already true.
- failed to collect: an import that does not resolve or a syntax fault.
- `lint` or `typecheck`: the finding names the line.

Answer with the `StructuredOutput` tool again when the checkout holds the fix.

---

{{JUDGEMENT}}

---
