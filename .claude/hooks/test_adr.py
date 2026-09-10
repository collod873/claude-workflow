#!/usr/bin/env python3
import importlib.machinery
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _harness
import _hook
from _harness import check, finish

BIN = _hook.BIN
spec = importlib.util.spec_from_file_location("adr_shape", BIN / "adr_shape.py")
adr_shape = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adr_shape)

_loader = importlib.machinery.SourceFileLoader("new_adr", str(BIN / "new-adr"))
new_adr = importlib.util.module_from_spec(importlib.util.spec_from_loader("new_adr", _loader))
_loader.exec_module(new_adr)

_ac = importlib.machinery.SourceFileLoader("adr_check", str(BIN / "adr-check"))
adr_check = importlib.util.module_from_spec(importlib.util.spec_from_loader("adr_check", _ac))
_ac.exec_module(adr_check)

GOOD = (
    '---\n'
    'status: constraint\n'
    'date: 2026-08-31\n'
    'reversal: every issue body in four repos names the marker, and two lint rules are keyed to it\n'
    '---\n'
    '\n'
    '# Triage labels are positions, not verdicts\n'
    '\n'
    'Six labels die and the absence of a label becomes load-bearing.\n'
)


def variant(**edits) -> str:
    fm, body = adr_shape.split_frontmatter(GOOD)
    fm.update(edits)
    lines = [f"{k}: {v}" for k, v in fm.items() if v is not None]
    return "---\n" + "\n".join(lines) + "\n---\n" + body


def refusal(text: str) -> str | None:
    try:
        adr_shape.validate(text)
    except adr_shape.ValidationError as e:
        return str(e)
    return None


def run(args, cwd, **kw) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, *args], cwd=cwd, capture_output=True,
                          text=True, timeout=_harness.HOOK_TIMEOUT, **kw)


def new_repo(stack) -> Path:
    d = Path(stack.enter_context(tempfile.TemporaryDirectory()))
    subprocess.run(["git", "init", "-q", str(d)], capture_output=True)
    return d


def write_adr(repo: Path, number: int, title: str) -> Path:
    p = adr_shape.adr_dir(repo) / f"{number:04d}-{adr_shape.slugify(title)}.md"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(variant().replace("# Triage labels are positions, not verdicts", f"# {title}"))
    return p


def fake_gh(stack, issues: list[dict]) -> dict:
    d = Path(stack.enter_context(tempfile.TemporaryDirectory()))
    gh = d / "gh"
    gh.write_text("#!/bin/sh\ncat <<'JSON'\n" + json.dumps(issues) + "\nJSON\n")
    gh.chmod(0o755)
    return {**os.environ, "PATH": f"{d}{os.pathsep}{os.environ['PATH']}"}


def tree_digest(repo: Path) -> dict[str, tuple[int, bytes]]:
    return {str(p.relative_to(repo)): (p.stat().st_mtime_ns, p.read_bytes())
            for p in sorted(repo.rglob("*")) if p.is_file() and ".git" not in p.parts}


def tiers_reported(stdout: str) -> dict[str, list[int]]:
    listed: dict[str, list[int]] = {}
    current = None
    for line in stdout.split("Retirement tiers", 1)[-1].splitlines()[1:]:
        for name in adr_check.TIERS:
            if line.strip().startswith(name):
                current = name
                listed.setdefault(name, [])
        if current is None:
            continue
        listed[current] += [int(n) for n in re.findall(r"\d{4}", re.sub(r"\(\s*\d+\)", "", line))]
    return listed


def main() -> None:
    print("adr_shape.validate: structural refusals")
    check("no frontmatter refuses",
          "frontmatter" in (refusal("# A title with four words\n\nbody") or ""),
          refusal("# A title with four words\n\nbody"))
    for key in adr_shape.REQUIRED_KEYS:
        msg = refusal(variant(**{key: None})) or ""
        check(f"missing `{key}` refuses", f"`{key}:`" in msg, msg)
    check("unknown status refuses",
          "not one of" in (refusal(variant(status="draft")) or ""),
          refusal(variant(status="draft")))
    check("empty reversal refuses",
          "admission bar" in (refusal(variant(reversal="")) or ""),
          refusal(variant(reversal="")))
    no_title = variant().replace("# Triage labels are positions, not verdicts\n", "")
    check("no title refuses", "`# ` title" in (refusal(no_title) or ""), refusal(no_title))
    short = variant().replace("# Triage labels are positions, not verdicts", "# Triage labels")
    check("topic-shaped title refuses",
          "sentence" in (refusal(short) or ""), refusal(short))
    over = variant() + ("word " * 200)
    check("over the cap refuses", "over the 150-word cap" in (refusal(over) or ""),
          refusal(over))

    print("\nadr_shape.validate: judgement is advisory, never a refusal")
    check("a good ADR raises nothing and warns nothing", adr_shape.validate(GOOD) == [],
          adr_shape.validate(GOOD))
    cheap = variant(reversal="one commit, edit the hook and its test")
    check("cheap reversal does not refuse", refusal(cheap) is None, refusal(cheap))
    warnings = adr_shape.validate(cheap)
    check("cheap reversal warns once", len(warnings) == 1, warnings)
    check("the warning quotes the phrase it caught", "one commit" in warnings[0], warnings[0])
    demoted = variant(status="note", reversal="one commit, edit the hook and its test")
    check("a note's cheap reversal is the verdict, not a finding",
          adr_shape.validate(demoted) == [], adr_shape.validate(demoted))
    for phrase in ("trivial to undo", "costs nothing", "revert the commit", "a single file"):
        check(f"cheap-reversal catches {phrase!r}",
              adr_shape.cheap_reversal(phrase) != "", phrase)
    check("an expensive reversal is not flagged",
          adr_shape.cheap_reversal(
              "every issue body in four repos names the marker") == "", "flagged")
    for opposite in ("pruned rows are gone and nothing can reconstruct them",
                     "the drift is invisible, with nothing failing",
                     "nothing in the tree can retract a published comment"):
        check(f"a catastrophic reversal is not flagged: {opposite[:38]!r}",
              adr_shape.cheap_reversal(opposite) == "",
              adr_shape.cheap_reversal(opposite))

    print("\nadr_shape: the rejected alternative")
    both = ("**Rejected:** a verdict vocabulary, which can disagree with the landmarks.",
            "**Rejected: a verdict vocabulary.** It can disagree with the landmarks.")
    for spelling in both:
        check(f"the corpus spelling {spelling[:24]!r} parses",
              adr_shape.rejected_alternative(f"# A title of four words\n\n{spelling}\n") != "",
              adr_shape.rejected_alternative(spelling))
    check("a mention inside prose is not the section",
          adr_shape.rejected_alternative("name it on a **Rejected:** line\n") == "",
          adr_shape.rejected_alternative("name it on a **Rejected:** line\n"))
    check("the stamped prompt is not the section",
          adr_shape.rejected_alternative(
              "<!--\n**Rejected: <the alternative>.** <cost.> -->\n") == "", "counted")
    for absence in ("**Rejected: doing nothing.** The drift continues.",
                    "**Rejected: the status quo.** It is what produced the gap.",
                    "**Rejected:** leaving it as is, which is how the drift happened."):
        weak = adr_shape.weak_alternative(adr_shape.rejected_alternative(absence))
        check(f"a non-alternative is caught: {absence[13:30]!r}", weak != "", absence)
    real = "**Rejected: a second, slower linter behind the fast one.** Two go unread."
    check("a real alternative is not flagged",
          adr_shape.weak_alternative(adr_shape.rejected_alternative(real)) == "", real)
    weak_adr = variant() + "\n**Rejected: doing nothing.** The drift continues.\n"
    check("the weak alternative warns and never refuses", refusal(weak_adr) is None,
          refusal(weak_adr))
    check("the warning quotes the phrase it caught",
          any("doing nothing" in w for w in adr_shape.validate(weak_adr)),
          adr_shape.validate(weak_adr))

    print("\nadr_shape: parsing")
    fm, body = adr_shape.split_frontmatter(GOOD)
    check("frontmatter parses to its keys", set(fm) == {"status", "date", "reversal"}, fm)
    check("title reads off the body",
          adr_shape.title_of(body) == "Triage labels are positions, not verdicts",
          adr_shape.title_of(body))
    check("the cap does not charge for the title",
          adr_shape.body_words(body) == 11, adr_shape.body_words(body))
    check("slug is derived and bounded",
          adr_shape.slugify("Triage labels are positions, not verdicts")
          == "triage-labels-are-positions-not-verdicts",
          adr_shape.slugify("Triage labels are positions, not verdicts"))

    print("\nadr_shape.citations: local vs foreign")
    check("a bare local citation is found",
          adr_shape.citations("see ADR-0012 and ADR-0012") == [12, 12],
          adr_shape.citations("see ADR-0012 and ADR-0012"))
    check("a repo-qualified citation is another corpus's and is skipped",
          adr_shape.citations("see claude-workflow/ADR-0087") == [],
          adr_shape.citations("see claude-workflow/ADR-0087"))
    mixed = "local ADR-0022 beside claude-workflow/ADR-0087"
    check("a qualified citation does not mask the local one beside it",
          adr_shape.citations(mixed) == [22], adr_shape.citations(mixed))

    import contextlib
    with contextlib.ExitStack() as stack:
        print("\nnew-adr: the draft carries no number")
        repo = new_repo(stack)
        r = run([BIN / "new-adr", "Triage labels are positions, not verdicts"], repo)
        draft = repo / "docs/adr/draft-triage-labels-are-positions-not-verdicts.md"
        check("draft is written", r.returncode == 0 and draft.is_file(), r.stderr)
        check("draft is invisible to the corpus reader",
              adr_shape.load_corpus(repo) == [], adr_shape.load_corpus(repo))
        check("the stamped template leaves reversal empty",
              "reversal:\n" in draft.read_text(), draft.read_text()[:120])
        check("the draft prints the bar", "Would reading the code answer this?" in r.stderr,
              r.stderr)
        check("the printed bar names the one criterion the land checks",
              "**Rejected:" in r.stderr, r.stderr)
        rendered = new_adr.bar()
        check("the bar is rendered, not restated", rendered in r.stderr, r.stderr[:400])
        printed_section = rendered.split("\n\n", 1)[1]
        check("every line of it is ADR-FORMAT.md's own text",
              printed_section in new_adr.FORMAT_DOC.read_text(), printed_section[:400])
        check("stdout carries the draft path alone",
              r.stdout.strip() == str(draft), r.stdout)
        check("the printing leaves the draft's content alone",
              "Would reading the code" not in draft.read_text(), draft.read_text())
        r = run([BIN / "new-adr", "Triage labels are positions, not verdicts"], repo)
        check("a second draft of the same title refuses", r.returncode != 0, r.stderr)

        print("\nnew-adr --land: the admission bar")
        r = run([BIN / "new-adr", "--land", str(draft)], repo)
        check("landing an unfilled reversal refuses", r.returncode == 1, r.returncode)
        check("the refusal names the bar", "admission bar" in r.stderr, r.stderr)
        check("a refused land leaves the draft where it was", draft.is_file(), "renamed")
        check("a refused land claims no number", adr_shape.load_corpus(repo) == [], "numbered")

        text = draft.read_text().replace(
            "reversal:", "reversal: every issue body in four repos names the marker")
        draft.write_text(text + "\nSix labels die and absence becomes load-bearing.\n")
        r = run([BIN / "new-adr", "--land", str(draft)], repo)
        check("landing a body naming no rejected alternative refuses",
              r.returncode == 1, r.returncode)
        check("the refusal names what is missing", "**Rejected:" in r.stderr, r.stderr)
        check("the stamped prompt does not satisfy the rule it explains",
              "**Rejected:" in draft.read_text(), "prompt no longer names the marker")
        check("a body-refused land leaves the draft where it was", draft.is_file(), "renamed")
        check("a body-refused land claims no number",
              adr_shape.load_corpus(repo) == [], "numbered")

        draft.write_text(draft.read_text()
                         + "\n**Rejected:** a verdict vocabulary, which is a second "
                           "language that can disagree with the landmarks.\n")
        r = run([BIN / "new-adr", "--land", str(draft)], repo)
        landed = repo / "docs/adr/0001-triage-labels-are-positions-not-verdicts.md"
        check("landing a filled draft succeeds", r.returncode == 0, r.stderr)
        check("the number is claimed at the land", landed.is_file(), list(
            (repo / "docs/adr").iterdir()))
        check("the draft is gone", not draft.is_file(), "draft survived")
        check("the index is written by the land",
              (repo / "docs/adr/INDEX.md").is_file(), "no index")
        check("the index carries the ruling",
              "Triage labels are positions, not verdicts"
              in (repo / "docs/adr/INDEX.md").read_text(), "ruling missing")

        r2 = run([BIN / "new-adr", "A second ruling that binds later work"], repo)
        d2 = repo / "docs/adr/draft-a-second-ruling-that-binds-later-work.md"
        d2.write_text(d2.read_text().replace(
            "reversal:", "reversal: four repos carry the marker in their issue bodies")
            + "\n**Rejected: a second numbering scheme.** Two schemes collide at the land.\n")
        r2 = run([BIN / "new-adr", "--land", str(d2)], repo)
        check("the corpus's inline-bold spelling of the section lands",
              (repo / "docs/adr/0002-a-second-ruling-that-binds-later-work.md").is_file(),
              r2.stdout + r2.stderr)

        over = repo / "docs/adr/draft-a-third-ruling-that-binds-later-work.md"
        run([BIN / "new-adr", "A third ruling that binds later work"], repo)
        over.write_text(over.read_text().replace(
            "reversal:", "reversal: four repos carry it")
            + "\n**Rejected: a shorter cap.** It routes rulings to nowhere.\n"
            + ("word " * 200))
        r3 = run([BIN / "new-adr", "--land", str(over)], repo)
        check("landing over the cap refuses", r3.returncode == 1, r3.returncode)
        check("the cap refusal names docs/research/", "docs/research/" in r3.stderr, r3.stderr)
        check("an over-cap draft is not renamed", over.is_file(), "renamed")
        over.unlink()

        r4 = run([BIN / "new-adr", "--land", str(landed)], repo)
        check("landing a non-draft refuses", r4.returncode == 1, r4.stderr)

        print("\nnew-adr: the bar degrades to a pointer, never to a refusal")
        install = Path(stack.enter_context(tempfile.TemporaryDirectory())) / "bin"
        install.mkdir()
        for name in ("new-adr", "adr_shape.py"):
            shutil.copy(BIN / name, install / name)
        elsewhere = new_repo(stack)
        r5 = run([install / "new-adr", "A ruling filed where the definition is gone"],
                 elsewhere)
        check("a draft still succeeds with the definition unreachable",
              r5.returncode == 0, r5.stderr)
        check("the draft is written anyway",
              (elsewhere / "docs/adr").is_dir(), list(elsewhere.iterdir()))
        check("the fallback points at the document it could not read",
              "ADR-FORMAT.md" in r5.stderr, r5.stderr)
        check("the fallback carries no remembered copy of the bar",
              "Would reading the code answer this?" not in r5.stderr, r5.stderr)

        print("\nadr-check: three-valued exit")
        r = run([BIN / "adr-check"], repo)
        check("a clean corpus exits 0", r.returncode == 0, r.stdout + r.stderr)
        check("the tally is printed", "2 ADRs" in r.stdout, r.stdout)

        landed.write_text(landed.read_text().replace("status: constraint", "status: note"))
        r = run([BIN / "adr-check"], repo)
        check("a stale index is a finding", r.returncode == 1, r.stdout + r.stderr)
        check("the finding names the repair", "--fix" in r.stderr, r.stderr)
        r = run([BIN / "adr-check", "--fix"], repo)
        check("--fix re-renders and clears the finding", r.returncode == 0, r.stderr)
        index = (repo / "docs/adr/INDEX.md").read_text()
        title = "Triage labels are positions, not verdicts"
        check("a demoted entry leaves the table", title not in index, index)
        check("the demoted entry is still reachable by number",
              f"- [0001]({landed.name}) note" in index, index)
        check("the constraint is still in the table", "| 0002 | [" in index, index)
        for a in adr_shape.load_corpus(repo):
            check(f"{a.ident} appears somewhere in the index", a.path.name in index, index)

        (repo / "notes.md").write_text("this cites ADR-0002 and ADR-0001\n")
        r = run([BIN / "adr-check"], repo)
        check("live citations are not findings", r.returncode == 0, r.stderr)
        landed.unlink()
        run([BIN / "adr-check", "--fix"], repo)
        (repo / "notes.md").write_text("this cites ADR-0001 and ADR-0002\n")
        r = run([BIN / "adr-check"], repo)
        check("a citation to a number the corpus has a gap at is a finding",
              r.returncode == 1 and "ADR-0001" in r.stderr, r.stderr)
        check("the dead-citation finding names where it was cited",
              "notes.md" in r.stderr, r.stderr)
        foreign = f"ADR-{9999:04d}"
        (repo / "notes.md").write_text(f"this cites {foreign}\n")
        r = run([BIN / "adr-check"], repo)
        check("a citation above the highest number warns, never fails",
              r.returncode == 0 and foreign in r.stderr, r.stderr)
        check("the warning names the qualified form as the repair",
              f"<repo>/{foreign}" in r.stderr, r.stderr)
        (repo / "notes.md").write_text(f"this cites claude-workflow/{foreign}\n")
        r = run([BIN / "adr-check"], repo)
        check("qualifying a foreign citation silences it",
              r.returncode == 0 and foreign not in r.stderr, r.stderr)

        print("\nadr-check --blast: the retirement tiers")
        blast = new_repo(stack)
        write_adr(blast, 1, "A ruling the tree still cites today")
        write_adr(blast, 2, "A ruling only an old issue still names")
        write_adr(blast, 3, "A ruling nothing anywhere cites at all")
        (blast / "notes.md").write_text("the hook implements ADR-0001\n")
        run([BIN / "adr-check", "--fix"], blast)
        env = fake_gh(stack, [
            {"number": 7, "title": "ADR-0002 is named in a title", "body": "", "comments": []},
            {"number": 8, "title": "", "body": "closing record: ADR-0001",
             "comments": [{"body": "and ADR-0002 once more, in a comment"}]},
        ])
        before = tree_digest(blast)
        r = run([BIN / "adr-check", "--blast"], blast, env=env)
        check("--blast exits clean on a clean corpus", r.returncode == 0, r.stdout + r.stderr)
        check("--blast changes no file on disk", tree_digest(blast) == before,
              [k for k, v in tree_digest(blast).items() if before.get(k) != v])
        listed = tiers_reported(r.stdout)
        check("all three tiers are named", list(listed) == list(adr_check.TIERS), listed)
        check("the tiers are named by what cites them, not by a verdict",
              adr_check.TIERS
              == ("cited nowhere", "cited only from issues", "cited from code"),
              adr_check.TIERS)
        check("an uncited ADR is in `cited nowhere`", listed["cited nowhere"] == [3], listed)
        check("an issue-only ADR is in `cited only from issues`",
              listed["cited only from issues"] == [2], listed)
        check("an ADR the tree cites is in `cited from code`, issues notwithstanding",
              listed["cited from code"] == [1], listed)
        every = [n for tier in listed.values() for n in tier]
        corpus_numbers = sorted(a.number for a in adr_shape.load_corpus(blast))
        check("the tiers partition the corpus: every ADR appears exactly once",
              sorted(every) == corpus_numbers and len(every) == len(set(every)),
              (every, corpus_numbers))
        check("the per-ADR table is still printed beside the tiers",
              "in-repo  issues" in r.stdout, r.stdout)
        check("in-repo citation wins the tier whatever the issue count",
              adr_check.tier(1, 0) == adr_check.tier(1, 99) == "cited from code",
              (adr_check.tier(1, 0), adr_check.tier(1, 99)))
        gone = {**os.environ, "PATH": str(stack.enter_context(tempfile.TemporaryDirectory()))}
        r = run([BIN / "adr-check", "--blast"], blast, env=gone)
        check("--blast without a reachable `gh` reports it could not run",
              r.returncode == 2, r.returncode)
        check("and reports no tiers rather than tiers built from one count",
              "Retirement tiers" not in r.stdout, r.stdout)

        print("\nadr-check: degradation")
        bare = Path(stack.enter_context(tempfile.TemporaryDirectory()))
        subprocess.run(["git", "init", "-q", str(bare)], capture_output=True)
        r = run([BIN / "adr-check"], bare)
        check("a repo with no docs/adr/ is clean, not a failure", r.returncode == 0,
              r.stdout + r.stderr)

    finish()


if __name__ == "__main__":
    main()
