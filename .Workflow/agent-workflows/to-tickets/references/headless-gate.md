# The headless-checkability gate

Every acceptance criterion must be verifiable by automated means: an exit code, `--json` payload assertion, filesystem check, or executable test run.

Rewrite vague criteria immediately during drafting. Downstream stages run headlessly and cannot resolve ambiguities.
