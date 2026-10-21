---
name: owasp-mobile-security-checker
description: Use when performing security audits, vulnerability assessments, or compliance checks on Flutter or mobile applications. Covers OWASP Mobile Top 10 (2024) — insecure storage (M9), weak cryptography (M10), network issues (M5), outdated dependencies (M2), and more. Hardcoded secrets (M1) are enforced by the Kiritek core gate (Gitleaks), not duplicated here.
metadata:
  author: harish
  version: 1.2.0
  notes: >-
    M1 (generic hardcoded secrets) migrated to the Kiritek core single source of
    truth; the Flutter pack delegates. All mobile scanner outputs are redacted
    fail-closed. M2 uses version heuristics, not a verified-CVE advisory feed.
---

# OWASP Mobile Security Checker

## Requirements

- Python 3.7+
- Flutter/Dart project with `pubspec.yaml`
- Android and/or iOS targets
- Run scripts from the project root directory

Comprehensive security analysis for Flutter and mobile applications based on OWASP Mobile Top 10 (2024).

## Automated Scanners

The generic secrets control (M1) is handled by the Kiritek core gate. Three
Flutter-specialized Python scanners (M2, M5, M9) cover the mobile-specific
automatable categories. Replace `<skill-dir>` with the skill's install path (e.g. `~/.claude/skills/owasp-mobile-security-checker`):

### M1 — Hardcoded Secrets (delegated to the Kiritek core)

The generic hardcoded-secrets control is **not** implemented in this Flutter
pack. It lives in the Kiritek core as a Gitleaks-based gate — the single source
of truth — which runs automatically in the pre-commit / pre-push hooks and in CI,
and redacts all output fail-closed. Run the core gate instead of a Flutter-local
scanner:

```bash
kiritek-init scan --scope=repository /path/to/project
```

`scripts/scan_hardcoded_secrets.py` is kept as a thin **delegator**: it points at
(and, when the core CLI is on PATH, forwards to) the core gate. It never carries
its own divergent regex gate, so there is no double execution and no drift.

### M2 — Dependency Hygiene

```bash
python3 <skill-dir>/scripts/check_dependencies.py /path/to/project
```

Analyzes `pubspec.yaml` for outdated packages and `any`/unconstrained version
constraints. This is a **version heuristic**, not a verified-CVE lookup: it does
not consult an advisory feed and never asserts a known CVE. Confirm any finding
against a real advisory source (OSV, GitHub Advisories, pub.dev) before treating
it as a vulnerability.

### M5 — Network Security

```bash
python3 <skill-dir>/scripts/check_network_security.py /path/to/project
```

Checks HTTP vs HTTPS usage, certificate pinning, Android Network Security Config, and iOS ATS settings.

### M9 — Insecure Storage

```bash
python3 <skill-dir>/scripts/analyze_storage_security.py /path/to/project
```

Identifies unencrypted SharedPreferences, plaintext file storage, unencrypted databases, and insecure backup configurations.

## Manual Analysis

M3, M4, M6, M7, M8, and M10 require code review. See `references/owasp_mobile_top_10_2024.md` for Flutter-specific vulnerability patterns, attack flows, and remediation for each category.

## Workflow

```text
Is this a comprehensive audit?
├─ YES → Core secrets gate (M1) + 3 mobile scanners (M2/M5/M9) → Review JSON outputs → Manual analysis (M3/M4/M6/M7/M8/M10) → Generate report
└─ NO → Continue...

Specific risk category?
├─ M1 → core gate: kiritek-init scan (secrets live in the core, not here)
├─ M2 → check_dependencies.py
├─ M5 → check_network_security.py
├─ M9 → analyze_storage_security.py
└─ M3/M4/M6/M7/M8/M10 → references/owasp_mobile_top_10_2024.md → manual analysis

Quick pre-release check?
└─ YES → Core secrets gate (M1) + 3 mobile scanners (M2/M5/M9) → Fix CRITICAL and HIGH findings only
```

## Quick Start: Full Audit

```bash
# M1 (generic secrets) is enforced by the Kiritek core gate, not here:
kiritek-init scan --scope=repository .

# Flutter-specialized mobile scanners (run from the project root):
python3 <skill-dir>/scripts/check_dependencies.py .
python3 <skill-dir>/scripts/check_network_security.py .
python3 <skill-dir>/scripts/analyze_storage_security.py .

# Outputs produced by the mobile scanners (all fields redacted fail-closed):
#   owasp_m2_dependencies_scan.json
#   owasp_m5_network_scan.json
#   owasp_m9_storage_scan.json
# (M1 secrets findings come from the core gate's redacted report.)
```

1. **Prioritise by severity** — fix CRITICAL and HIGH before release
2. **For M3, M4, M6, M7, M8, M10** — see `references/owasp_mobile_top_10_2024.md`
3. **Generate remediation plan** with code examples and timeline

## OWASP Mobile Top 10 (2024) — Quick Reference

| Risk | Issue | Automated? | Key Check |
| --- | --- | --- | --- |
| **M1** | Hardcoded credentials | ✅ core gate | Enforced by the Kiritek core (Gitleaks), not Flutter |
| **M2** | Outdated dependencies | ✅ scanner | Outdated or unconstrained packages (heuristic, not CVE lookup) |
| **M3** | Weak authentication | Manual | Token storage, MFA, session expiry |
| **M4** | Input validation | Manual | SQL injection, XSS in WebViews, IDOR |
| **M5** | Insecure communication | ✅ scanner | HTTP usage, missing cert pinning |
| **M6** | Privacy violations | Manual | PII in logs/analytics, excess permissions |
| **M7** | No binary protections | Manual | Missing `--obfuscate`, no root detection |
| **M8** | Misconfiguration | Manual | Debug flags in production, verbose logging |
| **M9** | Insecure storage | ✅ scanner | Sensitive data in SharedPreferences |
| **M10** | Weak cryptography | Manual | MD5/SHA1/ECB usage, hardcoded keys |

## Understanding Scan Results

| Severity | Meaning | Action |
| --- | --- | --- |
| **CRITICAL** | Exploitable immediately | Fix now — do not release |
| **HIGH** | Significant vulnerability | Fix before release |
| **MEDIUM** | Should be addressed | Plan for next sprint |
| **LOW** | Best practice improvement | Address as time permits |

### Common False Positives

- **M1**: Test/example keys, placeholders like `YOUR_API_KEY`
- **M2**: Dev-only dependencies (linters, test tools)
- **M5**: HTTP for `localhost`/`127.0.0.1` in development
- **M9**: Non-sensitive data in SharedPreferences (theme preference, language)

Always verify findings in context before flagging as vulnerabilities.

## When NOT to Use

- Web application security audits — this skill is mobile/Flutter-specific
- Backend API or server security reviews
- As a substitute for professional penetration testing or a formal security audit
- Projects that do not use Flutter/Dart or `pubspec.yaml`

## Reference Documentation

`references/owasp_mobile_top_10_2024.md` provides per-risk detail:

- Real-world attack scenarios and examples
- Flutter-specific vulnerability patterns (Dart code)
- Insecure vs secure code examples
- Platform-specific guidance (Android Keystore/NSC, iOS Keychain/ATS)
- Full mitigation strategies

## Integration Points

| Stage | Action |
| --- | --- |
| Pre-commit | Secrets gate runs via the Kiritek core hook (Gitleaks) — not a Flutter scanner |
| Pull requests | Run the 3 mobile scanners (M2/M5/M9); M1 secrets come from the core gate |
| Release builds | Full audit: core secrets gate + mobile scanners + manual analysis for all 10 categories |

---
_Kiritek Framework — stack pack `flutter`. Adaptado de [Harishwarrior/flutter-claude-skills](https://github.com/Harishwarrior/flutter-claude-skills) (MIT). Relevante para apps que manejan datos sensibles (ej. Skolable)._
| Incident response | Run targeted scanner for the reported vulnerability category |
