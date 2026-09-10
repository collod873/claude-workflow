#!/usr/bin/env python3
import re
from pathlib import Path

import _hook

SECRET_PATTERNS = [
    ("AWS Access Key", re.compile(r"(?<![A-Z0-9])(AKIA[0-9A-Z]{16})(?![A-Z0-9])")),
    ("AWS Secret Key", re.compile(r"""(?:aws_secret_access_key|secret_key)\s*[=:]\s*['"]?([A-Za-z0-9/+=]{40})['"]?""", re.IGNORECASE)),
    ("Generic API Key", re.compile(r"""(?:api[_-]?key|apikey)\s*[=:]\s*['"]?(?=[A-Za-z_\-]*\d)([A-Za-z0-9_\-]{20,})['"]?""", re.IGNORECASE)),
    ("Generic Secret", re.compile(r"""(?:secret[_-]?key|secret|auth[_-]?token|access[_-]?key|token|password|passwd|pwd)\s*[=:]\s*['"]?(?=[A-Za-z_\-/+=]*\d)([A-Za-z0-9_\-/+=]{16,})['"]?""", re.IGNORECASE)),
    ("Bearer Token", re.compile(r"""(?:authorization|bearer)\s*[=:]\s*['"]?[Bb]earer\s+([A-Za-z0-9_\-\.]{20,})['"]?""", re.IGNORECASE)),
    ("Private Key Block", re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----")),
    ("Private Key Assignment", re.compile(r"""private[_-]?key\s*[=:]\s*['"]?(?=[A-Za-z_\-/+=]*\d)([A-Za-z0-9_\-/+=]{16,})['"]?""", re.IGNORECASE)),
    ("GitHub Token", re.compile(r"\b(ghp_[A-Za-z0-9]{36})\b")),
    ("GitHub PAT", re.compile(r"\b(github_pat_[A-Za-z0-9_]{82})\b")),
    ("Slack Token", re.compile(r"\b(xox[bprs]-[A-Za-z0-9\-]{10,})\b")),
    ("Stripe Key", re.compile(r"\b(sk_live_[A-Za-z0-9]{24,})\b")),
    ("OpenAI Key", re.compile(r"\b(sk-[A-Za-z0-9]{32,})\b")),
    ("Anthropic Key", re.compile(r"\b(sk-ant-[A-Za-z0-9\-]{32,})\b")),
]

PLACEHOLDER_WORDS = re.compile(
    r"(?:example|placeholder|xxx|your_|changeme|replace|TODO|FIXME|dummy|fake|test)",
    re.IGNORECASE,
)

EXEMPT_NAMES = {
    ".gitignore", ".dockerignore", ".env.example", ".env.sample",
    "credential-scan.py", "test_credential_scan.py",
}


def extract_content(data):
    return _hook.new_content(data["tool_input"])


def slug(pattern_name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", pattern_name.lower()).strip("-")


def main():
    data, ok = _hook.read_payload()

    verdict, extra, reason = "allow", {}, ""
    file_path = _hook.edited_path(data["tool_input"]) if ok else ""
    name = Path(file_path).name if file_path else ""

    if not ok:
        pass
    elif name in EXEMPT_NAMES:
        verdict = "exempt"
        extra = {"file": name}
    else:
        findings = []
        matched = []
        content = extract_content(data)
        for pattern_name, regex in SECRET_PATTERNS:
            for match in regex.finditer(content):
                value = match.group(0)
                if PLACEHOLDER_WORDS.search(value):
                    continue
                preview = value[:12] + "..." if len(value) > 15 else value
                findings.append(f"  - {pattern_name}: {preview}")
                matched.append(slug(pattern_name))
        if findings:
            verdict = "deny"
            extra = {"pattern": matched[0], "patterns": sorted(set(matched))}
            reason = "Potential secrets detected in file content:\n" + "\n".join(findings)
            reason += "\n\nIf these are placeholders, add a comment or use env vars instead."

    _hook.append_log(_hook.HOOK_NAME, _hook.run_row(data, verdict, **extra))

    if reason:
        _hook.deny(reason)


if __name__ == "__main__":
    main()
