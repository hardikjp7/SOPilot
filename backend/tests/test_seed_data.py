import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from backend.app.config import ROOT
from backend.app.ingest import load_citations
from data.validate import validate


@pytest.fixture
def seed_dir(tmp_path):
    for folder in ("playbooks", "cves", "alerts", "mock", "eval"):
        shutil.copytree(ROOT / "data" / folder, tmp_path / folder)
    return tmp_path


def edit_json(path, mutation):
    value = json.loads(path.read_text())
    mutation(value)
    path.write_text(json.dumps(value, indent=2) + "\n")


def test_seed_corpus_passes_and_existing_citations_remain_stable(catalog):
    assert validate(ROOT / "data") == []
    citations = load_citations(ROOT / "data/playbooks")
    assert len(citations) == 50
    assert all(sum(c.playbook_id == book for c in citations.values()) == 10 for book in {
        "PB-PHI", "PB-RAN", "PB-CRD", "PB-DOS", "PB-S3",
    })
    for hit in catalog.search:
        assert citations[hit.step_id].source_text == hit.text


def test_samples_serve_the_updated_raw_seed_alerts(catalog):
    alerts = [json.loads(path.read_text()) for path in (ROOT / "data/alerts").glob("*.json")]
    by_id = {alert["alert_id"]: alert for alert in alerts}
    assert {sample.id for sample in catalog.samples} == set(by_id)
    assert all(sample.alert == by_id[sample.id] for sample in catalog.samples)
    assert any("timestamp" not in alert for alert in alerts)
    assert all(alert["synthetic"] is True for alert in alerts)


def test_seed_domains_are_examples_and_cves_are_explicitly_fictional():
    for path in (ROOT / "data/alerts").glob("*.json"):
        domains = re.findall(r"\b(?:[a-zA-Z0-9-]+\.)+(?:com|org|net)\b", path.read_text())
        assert all(any(domain == base or domain.endswith("." + base) for base in (
            "example.com", "example.org", "example.net",
        )) for domain in domains)
    cves = json.loads((ROOT / "data/cves/cves.json").read_text())
    assert len(cves) == 15
    assert sum(bool(entry["related_playbooks"]) for entry in cves) == 13
    assert all("not a published CVE" in entry["description"] for entry in cves)


@pytest.mark.parametrize("change,expected", [
    (lambda text: text.replace("PB-PHI-02 |", "PB-PHI-01 |"), "duplicate step ID"),
    (lambda text: text.replace(" | Contain |", " | Delete |", 1), "invalid step format"),
    (lambda text: text.replace("PB-PHI-04 |", "PB-PHI-4 |"), "invalid step format"),
    (lambda text: text.replace("PB-PHI-04 |", "PB-RAN-04 |"), "must belong to PB-PHI"),
    (lambda text: text.replace("PB-PHI-01 |", "PB-PHI-00 |"), "start at 01"),
    (lambda text: text.replace(" | SOC Tier 2", " | SOC | Tier 2", 1), "invalid step format"),
    (lambda text: text.replace("severity_default: high", "severity_default: urgent"), "default severity"),
    (lambda text: text.replace("## Detection signals", "## Other heading"), "Detection signals"),
    (lambda text: text.split("## Escalation")[0], "Escalation"),
    (lambda text: text.replace("# PB-PHI Phishing Response", "# PB-RAN Phishing Response"), "duplicate playbook ID"),
    (lambda text: "\n".join(line for line in text.splitlines() if not re.match(r"PB-PHI-0[4-9] \|", line)), "8 to 12 steps"),
])
def test_rejects_invalid_playbook(seed_dir, change, expected):
    path = seed_dir / "playbooks/PB-PHI.md"
    path.write_text(change(path.read_text()))
    assert any(expected in error for error in validate(seed_dir))


@pytest.mark.parametrize("field,value,expected", [
    ("related_playbooks", ["PB-MISSING"], "unknown related_playbooks"),
    ("related_playbooks", "PB-PHI", "must be a list"),
    ("related_playbooks", [["PB-PHI"]], "must be a list"),
    ("related_playbooks", ["PB-PHI", "PB-PHI"], "duplicate related_playbooks"),
    ("cvss", 10.1, "cvss must"),
    ("cvss", True, "cvss must"),
    ("severity", [], "invalid severity"),
    ("affected_product", "", "nonempty string"),
    ("id", {}, "fictional exercise ID"),
    ("description", "An unlabeled made-up vulnerability.", "label the entry fictional"),
])
def test_rejects_invalid_cve_fields(seed_dir, field, value, expected):
    edit_json(seed_dir / "cves/cves.json", lambda entries: entries[0].update({field: value}))
    assert any(expected in error for error in validate(seed_dir))


def test_rejects_duplicate_cve_ids(seed_dir):
    edit_json(seed_dir / "cves/cves.json", lambda entries: entries[1].update(id=entries[0]["id"]))
    assert any("duplicate CVE ID" in error for error in validate(seed_dir))


def test_rejects_insufficient_linked_cves(seed_dir):
    def unlink(entries):
        for entry in entries[4:]:
            entry["related_playbooks"] = []

    edit_json(seed_dir / "cves/cves.json", unlink)
    assert any("at least 5 entries" in error for error in validate(seed_dir))


@pytest.mark.parametrize("folder,content", [
    ("alerts", '{"alert_id":'),
    ("cves", "["),
    ("mock", '{"same": 1, "same": 2}'),
    ("eval", '{"bad_number": NaN}'),
])
def test_json_validation_covers_all_fixture_directories(seed_dir, folder, content):
    (seed_dir / folder / "broken.json").write_text(content)
    assert any("broken.json: invalid JSON" in error for error in validate(seed_dir))


@pytest.mark.parametrize("field,value,expected", [
    ("alert_id", "ALR-RAN", "duplicate alert ID"),
    ("alert_id", None, "stable alert_id"),
    ("cve_reference", "CVE-2099-900999", "unknown CVE reference"),
    ("loopback_test_address", "127.0.0.1", "documentation range"),
])
def test_rejects_invalid_alert_references(seed_dir, field, value, expected):
    edit_json(seed_dir / "alerts/phishing.json", lambda alert: alert.update({field: value}))
    assert any(expected in error for error in validate(seed_dir))


def test_missing_seed_folders_fail(tmp_path):
    errors = validate(tmp_path)
    assert any("expected 5" in error for error in errors)
    assert any("expected 15" in error for error in errors)
    assert any("expected 6" in error for error in errors)


def test_cli_is_working_directory_independent_and_returns_failure(seed_dir, tmp_path):
    command = [sys.executable, str(ROOT / "data/validate.py")]
    good = subprocess.run(command, cwd=tmp_path, capture_output=True, text=True, timeout=10)
    assert good.returncode == 0 and "Seed data valid" in good.stdout
    edit_json(seed_dir / "cves/cves.json", lambda entries: entries.pop())
    bad = subprocess.run(command + [str(seed_dir)], cwd=tmp_path, capture_output=True, text=True, timeout=10)
    assert bad.returncode == 1 and "expected 15 fictional entries" in bad.stderr
