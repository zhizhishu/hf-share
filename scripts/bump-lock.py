"""Update assembly revisions using local tracking refs only; never fetch."""
import argparse
import os
from pathlib import Path
import re
import subprocess

SOURCES = {
    "FUSION_SHA": ("fusionsearch-mcp", "github/main"),
    "CLAWEMAIL_SHA": ("ClawEmail", "origin/main"),
    "CLOUDSPACE_SHA": ("cloudspace", "origin/main"),
    "ICLOUD_HME_SHA": ("icloud-hme", "origin/claw-gate"),
}
HEADER = (
    "# Single source of truth for build revisions.\n"
    "# Bump from sibling local tracking refs: python scripts/bump-lock.py (no network).\n"
)


def git(repo, *args):
    result = subprocess.run(
        ["git", "--no-optional-locks", "-C", str(repo), *args],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        env=dict(os.environ, GIT_OPTIONAL_LOCKS="0", GIT_NO_LAZY_FETCH="1",
                 GIT_TERMINAL_PROMPT="0"), timeout=30,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "git command failed")
    return result.stdout.strip()


def revisions(group):
    values = {}
    for key, (name, ref) in SOURCES.items():
        repo = group / name
        try:
            sha = git(repo, "rev-parse", "--verify", f"refs/remotes/{ref}^{{commit}}")
        except RuntimeError:
            if key != "ICLOUD_HME_SHA":
                raise
            print("origin/claw-gate unavailable; checking whether origin contains HEAD")
            sha = git(repo, "rev-parse", "--verify", "HEAD^{commit}")
            branches = git(repo, "branch", "-r", "--contains", "HEAD",
                           "--format=%(refname:short)").splitlines()
            if not any(branch.startswith("origin/") for branch in branches):
                raise RuntimeError("icloud-hme HEAD is not contained in any origin ref")
        if not re.fullmatch(r"[0-9a-fA-F]{40}", sha):
            raise RuntimeError(f"{name}: invalid SHA")
        values[key] = sha.lower()
    return values


def parse_lock(text):
    values = {}
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = re.fullmatch(r"([A-Z_]+)=([0-9a-fA-F]{40})", line)
        if not match or match[1] not in SOURCES or match[1] in values:
            raise ValueError("Invalid or duplicate repos.lock entry")
        values[match[1]] = match[2].lower()
    if set(values) != set(SOURCES):
        raise ValueError("repos.lock must contain exactly four revision keys")
    return values


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="exit 1 if revisions differ")
    args = parser.parse_args()
    assembly = Path(__file__).resolve().parents[1]
    lock = assembly / "repos.lock"
    try:
        values = revisions(assembly.parent)
        try:
            previous = parse_lock(lock.read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError) as exc:
            print(f"Current lock unavailable or invalid: {exc}")
            previous = {}
        for key, sha in values.items():
            print(f"{key}: {previous.get(key, '(missing)')} → {sha}")
        differs = previous != values
        if args.check:
            print("Lock differs" if differs else "Lock matches local tracking refs")
            return int(differs)
        if differs:
            lock.write_text(HEADER + "".join(f"{key}={sha}\n" for key, sha in values.items()),
                            encoding="utf-8", newline="\n")
        return 0
    except (RuntimeError, OSError, subprocess.TimeoutExpired) as exc:
        print(f"ERROR: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
