#!/usr/bin/env python3
"""
Check Flutter dependencies for security hygiene (OWASP M2).

This script analyzes pubspec.yaml for outdated packages and loose/unconstrained
version constraints. It uses VERSION HEURISTICS only — it does NOT consult a
vulnerability advisory feed, and therefore never asserts a verified CVE. Findings
describe "outdated" or "unconstrained" dependencies; confirm against a real
advisory source (OSV, GitHub Advisories, pub.dev) before claiming a CVE.
"""

import re
import yaml
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))
from redact import safe_findings, RedactionError  # noqa: E402


def load_pubspec(project_root: str) -> Dict:
    """Load and parse pubspec.yaml."""
    pubspec_path = Path(project_root) / 'pubspec.yaml'

    if not pubspec_path.exists():
        print(f"Error: pubspec.yaml not found in {project_root}")
        sys.exit(1)

    with open(pubspec_path, 'r') as f:
        return yaml.safe_load(f)


def check_version_constraints(pubspec: Dict) -> List[Dict]:
    """Check for insecure version constraints."""
    findings = []

    dependencies = pubspec.get('dependencies', {})
    dev_dependencies = pubspec.get('dev_dependencies', {})

    all_deps = {**dependencies, **dev_dependencies}

    for package, version in all_deps.items():
        if package == 'flutter':
            continue

        # Check for 'any' version constraint (highly insecure)
        if version == 'any':
            findings.append({
                'package': package,
                'issue': 'Version constraint set to "any"',
                'severity': 'CRITICAL',
                'recommendation': 'Use specific version constraints (e.g., ^1.0.0)'
            })

        # Check for missing version constraint
        elif version is None:
            findings.append({
                'package': package,
                'issue': 'No version constraint specified',
                'severity': 'HIGH',
                'recommendation': 'Specify a version constraint'
            })

    return findings


def check_outdated_packages(project_root: str) -> Dict:
    """Run 'flutter pub outdated' to check for outdated packages."""
    try:
        # Resolve fvm to its absolute path to avoid PATH-insertion attacks
        fvm_path = shutil.which('fvm')
        if fvm_path is not None:
            flutter_cmd = [fvm_path, 'flutter', 'pub', 'outdated', '--json']
        else:
            flutter_cmd = ['flutter', 'pub', 'outdated', '--json']

        result = subprocess.run(
            flutter_cmd,
            cwd=project_root,
            capture_output=True,
            text=True,
            timeout=60
        )

        if result.returncode == 0:
            return json.loads(result.stdout)
        else:
            print(f"Warning: flutter pub outdated failed: {result.stderr}")
            return {}
    except subprocess.TimeoutExpired:
        print("Warning: flutter pub outdated timed out")
        return {}
    except FileNotFoundError:
        print("Warning: Flutter command not found (tried 'fvm flutter' and 'flutter'). Skipping outdated check.")
        return {}
    except Exception as e:
        print(f"Warning: Error running flutter pub outdated: {e}")
        return {}


def analyze_outdated_results(outdated_data: Dict) -> List[Dict]:
    """Analyze outdated packages data."""
    findings = []

    packages = outdated_data.get('packages', [])

    for package in packages:
        current_info = package.get('current')
        latest_info = package.get('latest')
        resolvable_info = package.get('resolvable')

        current = current_info.get('version') if isinstance(current_info, dict) else None
        latest = latest_info.get('version') if isinstance(latest_info, dict) else None
        resolvable = resolvable_info.get('version') if isinstance(resolvable_info, dict) else None

        package_name = package.get('package')

        if current != latest:
            severity = 'MEDIUM'
            # Determine severity based on version gap
            if current and latest:
                current_major = int(current.split('.')[0]) if current.split('.')[0].isdigit() else 0
                latest_major = int(latest.split('.')[0]) if latest.split('.')[0].isdigit() else 0

                if latest_major > current_major:
                    severity = 'HIGH'

            findings.append({
                'package': package_name,
                'current_version': current,
                'latest_version': latest,
                'resolvable_version': resolvable,
                'severity': severity,
                'issue': 'Package is outdated',
                'recommendation': f'Update to version {latest}'
            })

    return findings


def parse_min_version(constraint) -> Tuple[int, int, int]:
    """Extract the minimum pinned version from a pubspec constraint string."""
    if constraint is None or str(constraint).strip() == 'any':
        return (0, 0, 0)
    match = re.search(r'(\d+)\.(\d+)\.(\d+)', str(constraint))
    if match:
        return (int(match.group(1)), int(match.group(2)), int(match.group(3)))
    return (0, 0, 0)


def version_below_threshold(version: Tuple[int, int, int], threshold_str: str) -> bool:
    """Return True if version is below the threshold expressed as '<X.Y.Z'."""
    match = re.search(r'(\d+)\.(\d+)\.(\d+)', threshold_str)
    if not match:
        return False
    threshold = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
    return version < threshold


def check_outdated_version_heuristics(pubspec: Dict) -> List[Dict]:
    """Heuristic version check for packages whose OLD pins are commonly outdated.

    IMPORTANT — honesty of claims (requirement 12.4):
    This is a VERSION HEURISTIC, not a verified-CVE lookup. It does NOT consult a
    vulnerability advisory feed (OSV, GitHub Advisories, pub.dev advisories).
    It therefore MUST NOT assert that a package has a "known CVE" or a verified
    vulnerability. It only flags constraints that are below a well-known modern
    baseline as "outdated / below recommended minimum", with the heuristic nature
    made explicit so operators verify against a real advisory source.
    """
    findings = []

    # Baselines below which a pin is considered OUTDATED by heuristic (not a CVE).
    outdated_version_baselines = {
        'http': {
            'versions': ['<0.13.0'],
            'issue': 'Outdated version pin (below recommended minimum; heuristic, not a verified CVE)',
            'severity': 'MEDIUM',
        },
        'path_provider': {
            'versions': ['<2.0.0'],
            'issue': 'Outdated version pin (below recommended minimum; heuristic, not a verified CVE)',
            'severity': 'MEDIUM',
        },
    }

    dependencies = pubspec.get('dependencies', {})

    for package, version_info in outdated_version_baselines.items():
        if package not in dependencies:
            continue
        min_version = parse_min_version(dependencies[package])
        for threshold in version_info['versions']:
            if version_below_threshold(min_version, threshold):
                findings.append({
                    'package': package,
                    'current_constraint': str(dependencies[package]),
                    'issue': version_info['issue'],
                    'severity': version_info['severity'],
                    'advisory_source': 'none (version heuristic; verify against OSV / pub.dev advisories)',
                    'recommendation': (
                        f'Consider updating to a version that satisfies '
                        f'{threshold.replace("<", ">=")}, then confirm against a real '
                        f'advisory feed before claiming a CVE.'
                    ),
                })

    return findings


def main():
    """Main execution function."""
    project_root = sys.argv[1] if len(sys.argv) > 1 else '.'

    print(f"OWASP M2: Analyzing dependencies in {project_root}\n")

    # Load pubspec.yaml
    pubspec = load_pubspec(project_root)

    all_findings = []

    # Check version constraints
    print("Checking version constraints...")
    constraint_findings = check_version_constraints(pubspec)
    all_findings.extend(constraint_findings)

    # Check for outdated packages
    print("Checking for outdated packages...")
    outdated_data = check_outdated_packages(project_root)
    if outdated_data:
        outdated_findings = analyze_outdated_results(outdated_data)
        all_findings.extend(outdated_findings)

    # Heuristic version check (NOT a verified-CVE lookup — see requirement 12.4)
    print("Checking version pins against recommended baselines (heuristic, not CVE lookup)...")
    outdated_findings = check_outdated_version_heuristics(pubspec)
    all_findings.extend(outdated_findings)

    # Mandatory redaction (12.3, G.12) before printing/persisting.
    try:
        all_findings = safe_findings(all_findings)
    except RedactionError as e:
        print(f"ERROR: redaction failed, aborting output: {e}", file=sys.stderr)
        sys.exit(3)

    # Group by severity (initialised before the findings check so it's always defined)
    by_severity: Dict[str, List] = {'CRITICAL': [], 'HIGH': [], 'MEDIUM': [], 'LOW': []}
    for finding in all_findings:
        severity = finding.get('severity', 'MEDIUM')
        by_severity.setdefault(severity, []).append(finding)

    # Print results
    print(f"\n{'='*60}")
    print("Dependency Scan Results:")
    print(f"{'='*60}")
    print(f"Total issues found: {len(all_findings)}\n")

    for severity in ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']:
        if by_severity[severity]:
            print(f"\n{severity} Severity ({len(by_severity[severity])}):")
            print('-' * 60)
            for finding in by_severity[severity]:
                print(f"\nPackage: {finding['package']}")
                print(f"Issue: {finding['issue']}")
                if 'current_version' in finding:
                    print(f"Current: {finding['current_version']}, Latest: {finding['latest_version']}")
                print(f"Recommendation: {finding['recommendation']}")

    # Save results
    output_file = Path(project_root) / 'owasp_m2_dependencies_scan.json'
    with open(output_file, 'w') as f:
        json.dump({
            'total_issues': len(all_findings),
            'findings': all_findings
        }, f, indent=2)

    print(f"\n{'='*60}")
    print(f"Results saved to: {output_file}")

    critical_high = len(by_severity['CRITICAL']) + len(by_severity['HIGH'])
    sys.exit(1 if critical_high > 0 else 0)


if __name__ == '__main__':
    main()
