"""Update external private build revisions using local tracking refs only; never fetch.

Default (no flag)      : rewrite repos.lock from private/icloud-hme local tracking ref.
--check                : compare repos.lock to local tracking ref (0 match, 1 differ, 2 unreadable).
--check --lock-only    : validate repos.lock format/key set only; never touches private/ repos.
"""
import argparse
import os
from pathlib import Path
import re
import subprocess

SOURCES = {
    "ICLOUD_HME_SHA": ("private/icloud-hme", "origin/claw-gate"),
}
SHA = re.compile(r"[0-9a-fA-F]{40}")
HEADER = (
    "# Single source of truth for external private build revisions.\n"
    "# Public components (fusionsearch-mcp / clawemail / cloudspace) live in components/ directly.\n"
    "# Bump from local private/icloud-hme tracking ref: python scripts/bump-lock.py (no network).\n"
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


def revisions(repo_root):
    """Read pins from local private repos' tracking refs; a missing repo is an error."""
    values = {}
    for key, (rel_path, ref) in SOURCES.items():
        repo = repo_root / rel_path
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
        if not SHA.fullmatch(sha):
            raise RuntimeError(f"{rel_path}: invalid SHA")
        values[key] = sha.lower()
    return values


def parse_lock(text):
    """Strictly parse repos.lock: comments/blank lines ok, everything else must be KEY=<40 hex>."""
    allowed = ", ".join(sorted(SOURCES))
    values = {}
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, sep, value = line.partition("=")
        if not sep or key not in SOURCES:
            raise ValueError(f"unknown repos.lock key {key!r} (allowed: {allowed})")
        if key in values:
            raise ValueError(f"duplicate repos.lock key {key}")
        if not SHA.fullmatch(value):
            raise ValueError(f"repos.lock key {key} needs a 40 hex digit SHA, got {value!r}")
        values[key] = value.lower()
    missing = sorted(set(SOURCES) - set(values))
    if missing:
        raise ValueError(f"repos.lock missing revision keys: {', '.join(missing)}")
    return values


def run_lock_only(lock):
    """Validate the lock's format and key set offline. No sibling repos, no network, no writes."""
    try:
        values = parse_lock(lock.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"ERROR: {exc}")
        return 2
    for key, sha in values.items():
        print(f"{key}: {sha}")
    print("Lock format and key set OK (offline check).")
    return 0


def run_compare(repo_root, lock, check):
    """Compare (or, without check, rewrite) the lock from local private repo tracking refs."""
    try:
        values = revisions(repo_root)
    except (RuntimeError, OSError, subprocess.TimeoutExpired) as exc:
        print(f"ERROR: cannot read source revisions: {exc}")
        return 2
    try:
        previous = parse_lock(lock.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        if check:
            print(f"ERROR: cannot compare, current lock unreadable or invalid: {exc}")
            return 2
        print(f"Current lock unavailable or invalid: {exc} (rewriting it)")
        previous = {}
    for key, sha in values.items():
        print(f"{key}: {previous.get(key, '(missing)')} -> {sha}")
    differs = previous != values
    if check:
        print("Lock differs from local tracking refs" if differs
              else "Lock matches local tracking refs")
        return int(differs)
    if differs:
        lock.write_text(HEADER + "".join(f"{key}={sha}\n" for key, sha in values.items()),
                        encoding="utf-8", newline="\n")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true",
                        help="compare lock to local tracking refs; 0 match, 1 differs, 2 unreadable")
    parser.add_argument("--lock-only", action="store_true",
                        help="with --check: validate the lock offline only (no private repo, no writes)")
    args = parser.parse_args(argv)
    if args.lock_only and not args.check:
        parser.error("--lock-only requires --check; it only ever validates, never updates")
    repo_root = Path(__file__).resolve().parents[1]
    lock = repo_root / "repos.lock"
    if args.lock_only:
        return run_lock_only(lock)
    return run_compare(repo_root, lock, args.check)


if __name__ == "__main__":
    raise SystemExit(main())
