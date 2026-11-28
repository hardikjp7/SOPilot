"""Deterministic IoCs and private, evidence-based fast-model classification."""

import ipaddress
import json
import re
from typing import Any
from urllib.parse import quote, unquote, urlsplit
from uuid import uuid4

from .config import Settings
from .llm import LLMClient, LLMUnavailable
from .schemas import AlertClassification, IOCs, ParsedAlert, iso_timestamp

IPV4 = re.compile(r"(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])")
IPV6 = re.compile(r"(?<![\w:])(?:[a-fA-F0-9]{0,4}:){2,}[a-fA-F0-9:.]*(?:%[\w.-]+)?(?![\w:])")
DOMAIN = re.compile(
    r"(?<![\w.-])(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+"
    r"[a-zA-Z]{2,63}(?![\w.-])"
)
EMAIL = re.compile(r"(?<![\w.%+-])[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@"
                   r"(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}(?![\w.-])")
URL = re.compile(r"\b(?:https?|ftp)://[^\s<>\"'\x00-\x1f]+", re.IGNORECASE)
HASH = re.compile(r"(?<![a-zA-Z0-9])(?:[a-fA-F0-9]{64}|[a-fA-F0-9]{40}|[a-fA-F0-9]{32})(?![a-zA-Z0-9])")
CVE = re.compile(r"\bCVE-\d{4}-\d{4,}\b", re.IGNORECASE)
CLOUD_URI = re.compile(r"\b(?:s3|gs|az|abfss?)://[^\s<>\"']+", re.IGNORECASE)
ARN = re.compile(r"\barn:[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]*:[0-9]*:[^\s<>\"']+", re.IGNORECASE)
LABELED_USER = re.compile(r"\b(?:user(?:name)?|account|principal)\s*[:=]\s*[\"']?([\w.@\\-]+)", re.IGNORECASE)
LABELED_RESOURCE = re.compile(r"\b(?:bucket(?:_?name)?|resource(?:_?name)?)\s*(?:[:=]|named\s)\s*[\"']?([\w.-]+)", re.IGNORECASE)
USER_KEYS = {"user", "username", "account", "principal", "users", "usernames", "accounts", "principals", "submittedby"}
RESOURCE_KEYS = {"bucket", "bucketname", "container", "containername", "resource", "resourcename", "resourceid", "cloudresource", "storageaccount"}
FILE_SUFFIXES = {"exe", "dll", "sys", "bat", "cmd", "ps1", "sh", "py", "txt", "md", "log", "json", "yaml", "yml", "csv", "zip", "doc", "docx", "xls", "xlsx", "pdf", "eml"}
# A narrow deterministic defense for explicit instruction-override clauses. The
# system prompt remains the boundary for other untrusted text; this is not a
# general proof of resistance to arbitrary prompt injection.
OVERRIDE = re.compile(r"\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions\b[^.!?\n]*(?:[.!?]|$)", re.IGNORECASE)


def key_name(key: str) -> str:
    return re.sub(r"[^a-z0-9]", "", key.lower())


def child_path(path: str, key: str) -> str:
    return f"{path}.{key}" if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key) else f"{path}[{json.dumps(key)}]"


def walk(value: Any, path: str = "$", key: str = "", parent: str = ""):
    """Yield every node, with JSON paths and context for labeled identities."""
    yield path, key, parent, value
    if isinstance(value, dict):
        for name, item in value.items():
            yield from walk(item, child_path(path, name), name, key)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from walk(item, f"{path}[{index}]", key, parent)


def trim_indicator(value: str) -> str:
    value = value.rstrip(".,;!?")
    for opening, closing in (("(", ")"), ("[", "]"), ("{", "}")):
        while value.endswith(closing) and value.count(closing) > value.count(opening):
            value = value[:-1]
    return value


def ip_matches(text: str):
    ipv6_spans = []
    for pattern in (IPV6, IPV4):
        for match in pattern.finditer(text):
            if any(start <= match.start() < end for start, end in ipv6_spans):
                continue
            try:
                raw = match[0].rstrip(".")
                address = ipaddress.ip_address(raw)
            except ValueError:
                continue
            if address.version == 6:
                ipv6_spans.append(match.span())
            yield raw, str(address)


def extract_iocs(alert: dict[str, Any]) -> IOCs:
    found = {field: [] for field in IOCs.model_fields}

    def add(field, value):
        if value and value not in found[field]:
            found[field].append(value)

    def add_user(value):
        value = value.strip()
        if value and value.lower() not in {"*", "anonymous", "unknown", "null", "none"} and not ("://" in value or value.startswith("arn:")):
            add("users", value)

    for _, key, parent, value in walk(alert):
        if not isinstance(value, str):
            continue
        # URL-encoded identities need to be found as well, so they can be redacted.
        text = unquote(value)
        for _, address in ip_matches(text):
            add("ips", address)
        for match in HASH.finditer(text):
            add("hashes", match[0].lower())
        for match in CVE.finditer(text):
            add("cve_ids", match[0].upper())
        for pattern in (CLOUD_URI, ARN):
            for match in pattern.finditer(text):
                add("resources", trim_indicator(match[0]))
        for match in LABELED_RESOURCE.finditer(text):
            add("resources", match[1])
        if key_name(key) in RESOURCE_KEYS and re.fullmatch(r"[\w][\w.:/@=-]*", text):
            add("resources", text)
        is_user = key_name(key) in USER_KEYS or (key_name(parent) in USER_KEYS and key_name(key) in {"name", "id"})
        if is_user:
            add_user(text)
        for match in LABELED_USER.finditer(text):
            add_user(trim_indicator(match[1]))

        # Mask URLs/emails before bare-domain matching: a filename in a URL path
        # and the dotted local part of an email are not additional domains.
        masked = list(text)
        for match in EMAIL.finditer(text):
            add("emails", match[0])
            add("domains", match[0].rsplit("@", 1)[1].lower())
            masked[match.start():match.end()] = " " * len(match[0])
        for match in URL.finditer(text):
            url = trim_indicator(match[0])
            try:
                host = urlsplit(url).hostname
            except ValueError:
                continue
            if not host:
                continue
            add("urls", url)
            if DOMAIN.fullmatch(host):
                add("domains", host.lower())
            masked[match.start():match.end()] = " " * len(match[0])
        for match in LABELED_USER.finditer(text):
            start, end = match.span(1)
            masked[start:end] = " " * (end - start)
        if is_user:
            masked = []
        for match in DOMAIN.finditer("".join(masked)):
            if match[0].rsplit(".", 1)[1].lower() not in FILE_SUFFIXES:
                add("domains", match[0].lower())
    return IOCs(**found)


def classifier_view(value: Any) -> Any:
    """Remove explicit override clauses only from the view sent for classification."""
    if isinstance(value, str):
        return OVERRIDE.sub("", value).strip()
    if isinstance(value, list):
        return [classifier_view(item) for item in value]
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            cleaned = classifier_view(item)
            if isinstance(item, str) and OVERRIDE.search(item) and not cleaned:
                continue
            result[key] = cleaned
        return result
    return value


class Redactor:
    def __init__(self, alert: dict[str, Any], iocs: IOCs, redact_ips: bool):
        self.reverse: dict[str, str] = {}
        replacements, identities_seen = {}, {}
        serialized = json.dumps(alert, ensure_ascii=False)
        key_emails = [match[0] for _, key, _, _ in walk(alert) for match in EMAIL.finditer(unquote(key))]
        groups = [("EMAIL", list(dict.fromkeys(iocs.emails + key_emails))), ("USER", iocs.users)]
        if redact_ips:
            groups.append(("IP", iocs.ips))
        for kind, identities in groups:
            number = 0
            for identity in identities:
                if identity.casefold() in identities_seen:
                    continue
                number += 1
                while f"[{kind}_{number}]" in serialized:
                    number += 1
                token = f"[{kind}_{number}]"
                self.reverse[token] = identity
                identities_seen[identity.casefold()] = token
                for form in (identity, quote(identity, safe="")):
                    replacements[form] = token
        if redact_ips:
            for _, _, _, value in walk(alert):
                if isinstance(value, str):
                    for raw, canonical in ip_matches(unquote(value)):
                        if canonical.casefold() in identities_seen:
                            replacements[raw] = identities_seen[canonical.casefold()]
        forms = sorted(replacements, key=len, reverse=True)
        self.group_tokens = {f"identity{index}": replacements[form] for index, form in enumerate(forms)}
        self.pattern = re.compile(
            r"(?<!\w)(?:" + "|".join(f"(?P<identity{index}>{re.escape(form)})" for index, form in enumerate(forms)) + r")(?!\w)",
            re.IGNORECASE,
        ) if replacements else None

    def text(self, value: str) -> str:
        if self.pattern is None:
            return value
        decoded = unquote(value)
        if self.pattern.search(decoded):
            return self.pattern.sub(lambda match: self.group_tokens[match.lastgroup], decoded)
        return self.pattern.sub(lambda match: self.group_tokens[match.lastgroup], value)

    def json(self, value: Any, *, paths=None, path="$", safe_path="$") -> Any:
        if paths is not None and path != "$":
            paths[safe_path] = path
        if isinstance(value, str):
            return self.text(value)
        if isinstance(value, dict):
            result = {}
            for key, item in value.items():
                safe_key = self.text(key)
                # Case variants of an identity may occur as distinct JSON keys.
                # Preserve both values instead of silently overwriting evidence.
                number = 1
                unique_key = safe_key
                while unique_key in result:
                    number += 1
                    unique_key = f"{safe_key}__FIELD_{number}"
                result[unique_key] = self.json(
                    item, paths=paths, path=child_path(path, key), safe_path=child_path(safe_path, unique_key),
                )
            return result
        if isinstance(value, list):
            return [self.json(item, paths=paths, path=f"{path}[{i}]", safe_path=f"{safe_path}[{i}]")
                    for i, item in enumerate(value)]
        return value

    def restore(self, value: str) -> str:
        if not self.reverse:
            return value
        pattern = "|".join(re.escape(token) for token in self.reverse)
        return re.sub(pattern, lambda match: self.reverse[match[0]], value)


def require_mock_mode(mock: bool) -> None:
    if not mock:
        raise LLMUnavailable("Live pipeline is not wired in this scaffold; set MOCK=1.")


def alert_identifier(alert: dict[str, Any]) -> str:
    value = alert.get("alert_id", alert.get("id"))
    return value if isinstance(value, str) and value else f"ALR-{uuid4().hex[:8]}"


def alert_metadata(alert: dict[str, Any]) -> tuple[str, str | None]:
    source, timestamp = "unknown", None
    # Prefer explicit root metadata before nested fields; never infer missing time.
    nodes = sorted(walk(alert), key=lambda node: node[0].count(".") + node[0].count("["))
    for _, key, _, value in nodes:
        if not isinstance(value, str) or not value.strip():
            continue
        if source == "unknown" and key_name(key) in {"source", "sourcename", "tool", "system"}:
            source = value
        if timestamp is None and key_name(key) in {"timestamp", "timecreated", "eventtime", "observedat", "time"}:
            try:
                timestamp = iso_timestamp(value)
            except ValueError:
                continue
    return source, timestamp


async def parse_alert(
    alert: dict[str, Any], settings: Settings | None = None, *, llm: LLMClient | None = None,
) -> ParsedAlert:
    settings = settings or Settings()
    if settings.mock:
        from .mock import MockCatalog

        return MockCatalog().for_alert(alert).parsed
    iocs = extract_iocs(alert)
    view = classifier_view(alert)
    redactor = Redactor(alert, iocs, settings.redact_ips)
    # Paths are also redacted: JSON object keys can themselves contain identities.
    path_map = {}
    redacted_alert = redactor.json(view, paths=path_map)
    payload = {
        "alert": redacted_alert,
        "regex_iocs": {field: redactor.json(values) for field, values in iocs.model_dump().items()},
        "evidence_paths": list(path_map),
    }
    client = llm if llm is not None else LLMClient(settings)
    try:
        classification = AlertClassification.model_validate(await client.complete(
            stage="parse", output_schema=AlertClassification, payload=payload,
        ))
    finally:
        if llm is None:
            await client.close()
    evidence = list(dict.fromkeys(path_map[path] for path in classification.evidence_fields if path in path_map))
    attack_type = classification.attack_type
    if classification.confidence < settings.parse_min_confidence or not evidence:
        attack_type = "unknown"
    source, timestamp = alert_metadata(alert)
    return ParsedAlert(
        alert_id=alert_identifier(alert), source=source, timestamp=timestamp,
        attack_type=attack_type, severity=classification.severity, confidence=classification.confidence,
        summary=redactor.restore(classification.summary), iocs=iocs,
        evidence_fields=evidence, redacted=bool(redactor.reverse),
    )

