# The headless-checkability gate

Every acceptance criterion must be verifiable by automated means: an exit code, `--json` payload assertion, filesystem check, or executable test run.

Rewrite vague criteria immediately during drafting. Downstream stages run headlessly and cannot resolve ambiguities.

Every criterion also follows `docs/agents/ticket-format.md`'s `## Acceptance criteria` rules: red today, checked by one narrow command, read from the checkout rather than GitHub or the network, and parsed by `/bin/sh`.
