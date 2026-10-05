#!/usr/bin/env python3
"""
Mandatory redaction for OWASP Mobile scanner outputs (requirement 12.3, G.12).

Mobile scanners (M2 dependencies, M5 network, M9 storage) emit findings that may
carry source lines, URLs with embedded credentials, authorization headers or
payloads in fields like `code` / `pattern` / `current_constraint`. Those values
MUST be redacted before anything is printed to stdout/stderr or persisted to a
JSON report, so a mobile scan can never leak a secret.

This mirrors the fail-closed philosophy of the Kiritek core redactor:
  1. Replace the value of known-sensitive fields with a marker.
  2. Sanitize free text: strip credentials embedded in URLs and auth headers.
  3. Run a final canary sweep; if a recognizable credential survives redaction,
     RAISE instead of returning text — the caller must not publish it.

Keep this intentionally dependency-free (stdlib only, Python 3.7+).
"""

import re

REDACTED = "[REDACTED]"

# Field names whose VALUE must never be emitted verbatim.
SENSITIVE_FIELDS = (
    "secret",
    "match",
    "code",          # mobile scanners put the source line here
    "pattern",       # M1 legacy field (also a raw source line)
    "snippet",
    "rawContent",
    "token",
    "password",
    "authorization",
    "apiKey",
    "secretAccessKey",
)

# Canary patterns: recognizable real-credential shapes. If one survives, fail.
CANARY_PATTERNS = (
    ("aws-access-key", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("private-key-block", re.compile(r"-----BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("slack-token", re.compile(r"xox[baprs]-[0-9A-Za-z-]{10,}")),
    ("github-pat", re.compile(r"ghp_[0-9A-Za-z]{36}")),
    ("github-fine-grained", re.compile(r"github_pat_[0-9A-Za-z_]{22,}")),
    ("google-api-key", re.compile(r"AIza[0-9A-Za-z\-_]{35}")),
    ("jwt", re.compile(r"eyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}")),
)

_URL_CREDS = re.compile(r"(\b[a-z][a-z0-9+.-]*://)[^/@\s]+@", re.IGNORECASE)
_URL_QUERY_SECRET = re.compile(
    r"([?&](?:access_?token|token|api[_-]?key|key|secret|password|pwd|sig|signature)=)[^&#\s]+",
    re.IGNORECASE,
)
_AUTH_HEADER = re.compile(r"(authorization\s*:\s*)(bearer|basic|token)\s+\S+", re.IGNORECASE)
_URL = re.compile(r"\b[a-z][a-z0-9+.-]*://\S+", re.IGNORECASE)


class RedactionError(Exception):
    """Raised when a canary survives redaction (fail-closed)."""

    def __init__(self, canaries):
        self.canaries = canaries
        super().__init__(
            "redaction insufficient: canary pattern(s) survived: " + ", ".join(canaries)
        )


def _sanitize_url(value: str) -> str:
    out = _URL_CREDS.sub(lambda m: m.group(1) + REDACTED + "@", value)
    out = _URL_QUERY_SECRET.sub(lambda m: m.group(1) + REDACTED, out)
    return out


def sanitize_text(value):
    if not isinstance(value, str):
        return value
    out = _AUTH_HEADER.sub(lambda m: m.group(1) + m.group(2) + " " + REDACTED, value)
    out = _URL.sub(lambda m: _sanitize_url(m.group(0)), out)
    return out


def redact(value):
    """Return a redacted copy of value (dict/list/str/scalar)."""
    if value is None or isinstance(value, (int, float, bool)):
        return value
    if isinstance(value, str):
        return sanitize_text(value)
    if isinstance(value, list):
        return [redact(v) for v in value]
    if isinstance(value, dict):
        out = {}
        for key, v in value.items():
            if key in SENSITIVE_FIELDS:
                out[key] = REDACTED
            else:
                out[key] = redact(v)
        return out
    return value


def find_canaries(text: str):
    if not isinstance(text, str):
        return []
    return [cid for cid, rx in CANARY_PATTERNS if rx.search(text)]


def safe_findings(findings):
    """Redact a list of finding dicts and fail-closed if a canary survives.

    Returns the redacted list. Raises RedactionError if any canary remains, so
    the caller never persists/prints a leaking payload.
    """
    import json

    redacted = redact(findings)
    canaries = find_canaries(json.dumps(redacted))
    if canaries:
        raise RedactionError(canaries)
    return redacted
