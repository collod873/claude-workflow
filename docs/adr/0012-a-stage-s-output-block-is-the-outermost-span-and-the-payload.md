# A stage's output block is the outermost span, and the payload may mention the tag

Recorded 2026-08-23.

A stage's `<output>` block runs from the first `<output>` to the last `</output>`, and everything
between is payload — tags included. `JSON.parse` and the stage's zod schema are what prove the span
was the right one, so nothing in `extractOutput` has to guess. A response that mentions the tag is
accepted and the extra tags are reported; a response with two genuine blocks does not parse and is
still refused, with the interior tag count named in the message.

## Considered options

The old contract counted `<output>` occurrences across the whole response and refused anything but
one. That is not a stricter version of this rule — it is a different rule, enforcing a property of
the *whole response* where the prompt asks only that the response *end* in a block. It made the
parse depend on prose the stages are invited to write and on payload content they are asked for,
so seam sweep failed for doing its job well: this repo's own `<output>` contract is a shared shape,
and a manifest entry naming it puts the literal tag inside the JSON (#42, run 32677530530).

**Taking the last block was rejected as wrong, not as a compromise.** It was the obvious patch and
it looked like the cheap one. In all five responses captured against #36 the closing tag count was
1 — there was never a second block to choose between — and the trailing `<output>` sat mid-string
inside the payload. Slicing from it produces garbage. The fear it was weighed against, that a
stage might silently pick the wrong one of two candidate outputs, was a fear about a response shape
that did not exist.

**Keeping the refusal and fixing the prompts was rejected as a guess.** The prompts do end with a
literal `<output>` example, which is why they were the first suspect. The captured responses say
otherwise: every extra tag was inside the payload, none was an echo of the example. The prompts are
untouched.

## Consequences

The seam sweep can now name the output contract as a seam, which it should — it is one of the most
consumed shapes in this repo. Before this, the better the sweep, the more certain the refusal.
