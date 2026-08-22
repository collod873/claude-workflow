# The headless-checkability gate

Every acceptance criterion must be provable by exit code, `--json` output, a filesystem assertion,
or a real run — never by eyeballing.

A vague criterion is **rewritten**, never deferred. The stage that drafts it is headless: nothing
downstream can ask a clarifying question, so a criterion a machine cannot tick is a criterion that
was never really stated.
