"""Validate the checked-in seed corpus using only the Python standard library."""

import argparse
import ipaddress
import json
import math
import re
import sys
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent
PLAYBOOKS = {
    "PB-PHI": "phishing", "PB-RAN": "ransomware", "PB-CRD": "credential_stuffing",
    "PB-DOS": "ddos", "PB-S3": "public_s3_bucket",
}
SEVERITIES = {"low", "medium", "high", "critical"}
STEP_LINE = re.compile(
    r"^(PB-[A-Z0-9]+-\d{2}) \| (Detect|Investigate|Contain|Eradicate|Recover|Escalate) \| (.+) \| (.+)$"
)
CVE_FIELDS = {"id", "cvss", "severity", "affected_product", "description", "remediation", "related_playbooks"}
# Fictional exercise identifiers, not a claim that this is an officially reserved CVE range.
FICTIONAL_CVE_ID = re.compile(r"CVE-2099-900\d{3}")
DOCUMENTATION_NETWORKS = tuple(map(ipaddress.ip_network, (
    "192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24", "2001:db8::/32",
)))


def reject_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON object key: {key}")
        result[key] = value
    return result


def reject_nonfinite(value):
    raise ValueError(f"Non-finite JSON number: {value}")


def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)


def validate_ips(value, label, errors):
    for text in strings(value):
        candidates = re.findall(r"(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])", text)
        candidates += re.findall(r"(?<![\w:])[0-9a-fA-F]*:[0-9a-fA-F:]+(?![\w:])", text)
        for candidate in candidates:
            try:
                address = ipaddress.ip_address(candidate)
            except ValueError:
                continue  # Timestamps and version strings can resemble addresses.
            if not any(address.version == net.version and address in net for net in DOCUMENTATION_NETWORKS):
                errors.append(f"{label}: IP address must use a documentation range")


def validate(data_dir: Path = DATA_DIR) -> list[str]:
    """Return actionable errors; an empty list means the seed corpus is valid."""
    errors, playbook_ids, step_ids = [], set(), set()
    paths = sorted((data_dir / "playbooks").glob("*.md"))
    if len(paths) != 5:
        errors.append(f"playbooks: expected 5 Markdown files, found {len(paths)}")
    for path in paths:
        text = path.read_text(encoding="utf-8")
        title = re.search(r"^# (PB-[A-Z0-9]+) (\S.*)$", text, re.MULTILINE)
        if title is None:
            errors.append(f"{path.name}: missing playbook ID and title")
            continue
        book_id = title[1]
        if book_id in playbook_ids:
            errors.append(f"{path.name}: duplicate playbook ID {book_id}")
        playbook_ids.add(book_id)
        if path.stem != book_id:
            errors.append(f"{path.name}: filename must match playbook ID {book_id}")
        if not re.search(rf"^attack_type: {PLAYBOOKS.get(book_id, '__unknown__')}$", text, re.MULTILINE):
            errors.append(f"{path.name}: incorrect or missing attack_type")
        severity = re.search(r"^severity_default: (\w+)$", text, re.MULTILINE)
        if severity is None or severity[1] not in SEVERITIES:
            errors.append(f"{path.name}: invalid or missing default severity")
        sections, current = {}, None
        for line in text.splitlines():
            if line.startswith("## "):
                current = line[3:]
                if current in sections:
                    errors.append(f"{path.name}: duplicate section {current}")
                sections.setdefault(current, [])
            elif current is not None and line.strip():
                sections[current].append(line)
        for name in ("Detection signals", "Steps", "Escalation"):
            if not sections.get(name):
                errors.append(f"{path.name}: missing or empty {name} section")
        lines = sections.get("Steps", [])
        if not 8 <= len(lines) <= 12:
            errors.append(f"{path.name}: expected 8 to 12 steps, found {len(lines)}")
        for line in lines:
            match = STEP_LINE.fullmatch(line)
            if match is None or line.count("|") != 3 or not match[3].strip() or not match[4].strip():
                errors.append(f"{path.name}: invalid step format: {line}")
                continue
            step_id = match[1]
            if step_id in step_ids:
                errors.append(f"{path.name}: duplicate step ID {step_id}")
            step_ids.add(step_id)
            if not step_id.startswith(book_id + "-") or step_id.endswith("-00"):
                errors.append(f"{path.name}: step ID {step_id} must belong to {book_id} and start at 01")
        validate_ips(text, path.name, errors)
    if playbook_ids != set(PLAYBOOKS):
        errors.append("playbooks: expected exactly PB-PHI, PB-RAN, PB-CRD, PB-DOS, PB-S3")

    # Runtime vector-store files are outside the seed corpus. Validate every JSON
    # file in the four checked-in fixture directories, including mock/eval files.
    documents = {}
    for folder in ("alerts", "cves", "mock", "eval"):
        for path in sorted((data_dir / folder).rglob("*.json")):
            label = str(path.relative_to(data_dir))
            try:
                documents[path] = json.loads(
                    path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicate_keys,
                    parse_constant=reject_nonfinite,
                )
            except (ValueError, UnicodeError) as exc:
                errors.append(f"{label}: invalid JSON: {exc}")
                continue
            validate_ips(documents[path], label, errors)

    cves = documents.get(data_dir / "cves" / "cves.json")
    if not isinstance(cves, list):
        errors.append("cves/cves.json: expected a JSON array")
        cves = []
    if len(cves) != 15:
        errors.append(f"cves/cves.json: expected 15 fictional entries, found {len(cves)}")
    cve_ids, linked = set(), 0
    for number, entry in enumerate(cves, 1):
        label = f"cves/cves.json entry {number}"
        if not isinstance(entry, dict) or set(entry) != CVE_FIELDS:
            errors.append(f"{label}: expected exactly the documented CVE fields")
            continue
        identifier = entry["id"]
        if not isinstance(identifier, str) or FICTIONAL_CVE_ID.fullmatch(identifier) is None:
            errors.append(f"{label}: expected a fictional exercise ID CVE-2099-900NNN")
        elif identifier in cve_ids:
            errors.append(f"{label}: duplicate CVE ID {identifier}")
        else:
            cve_ids.add(identifier)
        score = entry["cvss"]
        if type(score) not in (int, float) or not math.isfinite(score) or not 0 <= score <= 10:
            errors.append(f"{label}: cvss must be a finite number between 0 and 10")
        if not isinstance(entry["severity"], str) or entry["severity"] not in SEVERITIES:
            errors.append(f"{label}: invalid severity")
        for field in ("affected_product", "description", "remediation"):
            if not isinstance(entry[field], str) or not entry[field].strip():
                errors.append(f"{label}: {field} must be a nonempty string")
        if isinstance(entry["description"], str) and "fictional" not in entry["description"].lower():
            errors.append(f"{label}: description must label the entry fictional")
        related = entry["related_playbooks"]
        if not isinstance(related, list) or any(not isinstance(item, str) for item in related):
            errors.append(f"{label}: related_playbooks must be a list of playbook IDs")
            continue
        if len(related) != len(set(related)):
            errors.append(f"{label}: duplicate related_playbooks reference")
        for book_id in related:
            if book_id not in playbook_ids:
                errors.append(f"{label}: unknown related_playbooks value {book_id}")
        if related and all(book_id in playbook_ids for book_id in related):
            linked += 1
    if linked < 5:
        errors.append(f"cves/cves.json: at least 5 entries must link to existing playbooks, found {linked}")

    alert_paths = sorted((data_dir / "alerts").glob("*.json"))
    if len(alert_paths) != 6:
        errors.append(f"alerts: expected 6 raw alert files, found {len(alert_paths)}")
    alert_ids = set()
    for path in alert_paths:
        alert = documents.get(path)
        if not isinstance(alert, dict):
            errors.append(f"{path.name}: raw alert must be a JSON object")
            continue
        identifier = alert.get("alert_id")
        if not isinstance(identifier, str) or not identifier.strip():
            errors.append(f"{path.name}: seed alert needs a stable alert_id")
        elif identifier in alert_ids:
            errors.append(f"{path.name}: duplicate alert ID {identifier}")
        else:
            alert_ids.add(identifier)
        for text in strings(alert):
            for reference in re.findall(r"CVE-\d{4}-\d{4,}", text):
                if reference not in cve_ids:
                    errors.append(f"{path.name}: unknown CVE reference {reference}")
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data_dir", nargs="?", type=Path, default=DATA_DIR)
    args = parser.parse_args(argv)
    errors = validate(args.data_dir)
    if errors:
        print("Seed data validation failed:", file=sys.stderr)
        for issue in errors:
            print(f"- {issue}", file=sys.stderr)
        return 1
    print("Seed data valid: 5 playbooks, 15 fictional CVEs, 6 alerts; IDs, steps, JSON and references checked.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
