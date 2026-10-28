import hashlib
import io
import os
import platform
import tarfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Pin:
    version: str
    asset: str
    arch: dict[str, str]
    sha256: dict[str, str]
    tarball_member: str | None


PINS = {
    "gitleaks": Pin("8.30.1", "https://github.com/gitleaks/gitleaks/releases/download/v{version}/gitleaks_{version}_linux_{arch}.tar.gz",
                    {"x86_64": "x64", "aarch64": "arm64"},
                    {"x64": "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
                     "arm64": "e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080"}, "gitleaks"),
    "osv-scanner": Pin("2.7.0", "https://github.com/google/osv-scanner/releases/download/v{version}/osv-scanner_linux_{arch}",
                       {"x86_64": "amd64", "aarch64": "arm64"},
                       {"amd64": "160c6253e2922e9e0a6a9771c5c4c40a4b3c6090b34a3cdd5e80c96cc2e4218b",
                        "arm64": "4061ef4c021ed3c47f203b818f337e351336cc5cd67c0274fc36bd1dfc728dd7"}, None),
}


class ToolUnavailable(Exception):
    pass


def cached_path(name: str) -> Path:
    base = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache")
    return base / "shared-security" / f"{name}-{PINS[name].version}" / name


def tool(name: str) -> Path:
    pin, target = PINS[name], cached_path(name)
    if target.is_file():
        return target
    arch = pin.arch.get(platform.machine()) if platform.system() == "Linux" else None
    if arch is None:
        raise ToolUnavailable(f"no pinned {name} for {platform.system()} {platform.machine()}")
    url = pin.asset.format(version=pin.version, arch=arch)
    with urllib.request.urlopen(url, timeout=120) as response:
        payload = response.read()
    if hashlib.sha256(payload).hexdigest() != pin.sha256[arch]:
        raise ToolUnavailable(f"{url} does not match its pinned sha256")
    if pin.tarball_member:
        with tarfile.open(fileobj=io.BytesIO(payload)) as unpacked:
            member = unpacked.extractfile(pin.tarball_member)
            if member is None:
                raise ToolUnavailable(f"{url} holds no {pin.tarball_member}")
            payload = member.read()
    target.parent.mkdir(parents=True, exist_ok=True)
    staging = target.with_suffix(f".{os.getpid()}")
    staging.write_bytes(payload)
    staging.chmod(0o755)
    staging.replace(target)
    return target
