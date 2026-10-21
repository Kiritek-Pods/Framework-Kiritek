#!/usr/bin/env python3
"""
OWASP M1 — Hardcoded secrets (DELEGATION to the Kiritek core).

Historically this script carried its own regex-based secret gate. That created a
SECOND, divergent generic-secrets control living inside the Flutter pack, in
addition to the authoritative Gitleaks-based gate in the Kiritek core. Two gates
means two sources of truth, double execution and drift.

Per the Kiritek security design (requirements 12.1 and G.7) the generic
hardcoded-secrets control must live ONLY in the core. So this script no longer
scans: it DELEGATES to the core secret gate and never re-implements detection.

What it does now:
  * Points you at the single source of truth (the core Gitleaks gate), invoked
    through the Kiritek CLI, so there is NO double execution and NO divergence.
  * If the core CLI is reachable, it forwards the request (best effort) and
    relays the core's exit code.
  * It NEVER prints matched secret values. Any detection output comes from the
    core, which redacts fail-closed before emitting anything.

Specialized MOBILE controls (M2 dependencies, M5 network, M9 storage, and the
manual M3/M4/M6/M7/M8/M10 guidance) stay in this pack — only the generic secret
gate was migrated to the core.

Usage:
    python3 scan_hardcoded_secrets.py [/path/to/project]

Exit codes mirror the core gate when it runs:
    0  core gate ran clean (no secrets) OR delegation notice emitted
    1  core gate reported findings
    2  delegation could not reach the core gate (informational, non-fatal here)
"""

import os
import shutil
import subprocess
import sys


CORE_CLI_CANDIDATES = [
    # The installed Kiritek CLI binary (the single source of truth for secrets).
    ["kiritek-init"],
]


def _print_delegation_notice(project_root: str) -> None:
    print("OWASP M1 — Hardcoded secrets: delegated to the Kiritek core.\n")
    print("The generic hardcoded-secrets control is NOT implemented in the Flutter")
    print("pack. It lives in the Kiritek core (Gitleaks-based gate), which is the")
    print("single source of truth and redacts all output fail-closed.\n")
    print("Run the core secret gate instead of this script:")
    print(f"    kiritek-init scan --scope=repository {project_root}")
    print("    # (pre-commit / pre-push hooks and CI already invoke it automatically)\n")
    print("This avoids double execution and keeps a single, non-divergent gate.")


def _try_core(project_root: str):
    """Best-effort: forward to the core secret gate. Returns exit code or None."""
    for base in CORE_CLI_CANDIDATES:
        exe = shutil.which(base[0])
        if exe is None:
            continue
        cmd = [exe, *base[1:], "scan", "--scope=repository", "--stack=flutter"]
        try:
            completed = subprocess.run(
                cmd,
                cwd=project_root,
                capture_output=True,
                text=True,
                timeout=300,
            )
        except (subprocess.TimeoutExpired, OSError):
            continue
        # Relay the core's own (already-redacted) output verbatim.
        if completed.stdout:
            sys.stdout.write(completed.stdout)
        if completed.stderr:
            sys.stderr.write(completed.stderr)
        return completed.returncode
    return None


def main() -> int:
    project_root = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()

    _print_delegation_notice(project_root)

    core_code = _try_core(project_root)
    if core_code is None:
        # Could not reach the core CLI from here. Do NOT fall back to a divergent
        # local scan — that is exactly what this migration removes. Signal that
        # delegation is pending so the operator wires the core gate.
        print("\nNote: Kiritek core CLI not found on PATH; could not forward the scan.")
        print("The generic secrets gate is enforced by the core via hooks/CI.")
        return 2

    return core_code


if __name__ == "__main__":
    sys.exit(main())
