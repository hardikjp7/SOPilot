"""Ten live gateway probes. Run with: python scripts/smoke_gateway.py.

Settings are loaded through config.py, including its normal dotenv support.
This diagnostic always uses the real gateway, even when application MOCK=1.
It never retries or substitutes a fallback model for the model under test.
"""

import asyncio
from dataclasses import dataclass
import logging
from pathlib import Path
import sys
import time
from typing import Callable

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pydantic import ValidationError

from backend.app.config import Settings
from backend.app.llm import LLMClient, LLMUnavailable
from backend.app.schemas import EmbeddingBatch, LookupCVEArguments, strict_json_schema

MODEL_ROLES = ("MODEL_MAIN", "MODEL_FAST", "MODEL_FALLBACK")
RESPONSE_CHECKS = ("basic", "structured", "function")
PROBE_ID = "CVE-2099-900001"  # Fictional seed-corpus identifier, never a live lookup.
EXPECTED_DIMENSIONS = 3072


class ProbeFailure(Exception):
    """Contains only a locally generated, safe diagnostic."""


@dataclass
class CheckResult:
    role: str
    check: str
    ok: bool
    latency_ms: float
    detail: str = ""

    def line(self) -> str:
        suffix = f" {self.detail}" if self.detail else ""
        return f"{self.role}/{self.check} {'OK' if self.ok else 'FAIL'} {self.latency_ms:.0f} ms{suffix}"


def short_error(error: Exception) -> str:
    # SDK exception messages/response bodies can contain headers or echoed input.
    # Only our own ProbeFailure messages and allowlisted metadata may be printed.
    if isinstance(error, ProbeFailure):
        return str(error)
    if isinstance(error, ValidationError):
        return "response schema validation failed"
    if isinstance(error, LLMUnavailable):
        return "client unavailable; check LLM_KEY"
    name = type(error).__name__
    if isinstance(error, TimeoutError) or name == "APITimeoutError":
        return "request timed out (30 s limit)"
    status = getattr(error, "status_code", None)
    if isinstance(status, int) and 100 <= status <= 599:
        reason = {400: "request rejected", 401: "authentication rejected", 403: "access denied",
                  404: "model or route unavailable", 429: "rate limited"}.get(status, "gateway request failed")
        return f"HTTP {status}: {reason}"
    if name in {"APIConnectionError", "ConnectError", "ConnectionError", "SSLError"}:
        return "connection or TLS failure"
    return "request failed; no upstream details displayed"


def require_completed(response) -> None:
    if getattr(response, "status", None) != "completed":
        raise ProbeFailure("response did not complete")


async def check_response(gateway: LLMClient, model: str, check: str) -> str:
    # Reuse the production SDK factory: auth, base URL, TLS_VERIFY, timeout and
    # max_retries are defined only in llm.py. Direct probes intentionally bypass
    # production retry/fallback orchestration to identify the failing model.
    sdk = gateway._sdk()
    request = {"model": model, "store": False}
    if check == "basic":
        response = await sdk.responses.create(**request, input="Reply with the single word OK.")
        require_completed(response)
        if not isinstance(response.output_text, str) or not response.output_text.strip():
            raise ProbeFailure("response contained no text")
    elif check == "structured":
        response = await sdk.responses.create(
            **request, input=f'Return a JSON object whose id is exactly "{PROBE_ID}".',
            text={"format": {"type": "json_schema", "name": "GatewaySmokeOutput", "strict": True,
                             "schema": strict_json_schema(LookupCVEArguments)}},
        )
        require_completed(response)
        result = LookupCVEArguments.model_validate_json(response.output_text)
        if result.id != PROBE_ID:
            raise ProbeFailure("structured response did not echo the synthetic identifier")
    else:
        response = await sdk.responses.create(
            **request, input=f'Call smoke_echo with id "{PROBE_ID}".',
            tools=[{"type": "function", "name": "smoke_echo", "strict": True,
                    "description": "Echo a synthetic identifier for a connectivity test; no side effects.",
                    "parameters": strict_json_schema(LookupCVEArguments)}],
            tool_choice="required",
        )
        require_completed(response)
        calls = [item for item in response.output if getattr(item, "type", None) == "function_call"]
        if len(calls) != 1 or calls[0].name != "smoke_echo":
            raise ProbeFailure("expected exactly one smoke_echo function call")
        arguments = LookupCVEArguments.model_validate_json(calls[0].arguments)
        if arguments.id != PROBE_ID:
            raise ProbeFailure("function arguments did not echo the synthetic identifier")
    return ""


async def check_embedding(gateway: LLMClient, model: str) -> str:
    response = await gateway._sdk().embeddings.create(
        model=model, input=["SOPilot synthetic gateway connectivity check."],
    )
    if len(response.data) != 1 or response.data[0].index != 0:
        raise ProbeFailure("expected one embedding at index 0")
    result = EmbeddingBatch(vectors=[response.data[0].embedding])
    dimensions = len(result.vectors[0])
    if dimensions != EXPECTED_DIMENSIONS:
        raise ProbeFailure(f"vector_length={dimensions}; expected {EXPECTED_DIMENSIONS}")
    return f"vector_length={dimensions}"


async def measure(role: str, check: str, operation) -> CheckResult:
    started = time.perf_counter()
    try:
        detail = await operation()
        return CheckResult(role, check, True, (time.perf_counter() - started) * 1000, detail)
    except Exception as error:
        return CheckResult(role, check, False, (time.perf_counter() - started) * 1000, short_error(error))


def configuration_failure(reason: str, emit: Callable[[str], None]) -> int:
    for role in MODEL_ROLES:
        for check in RESPONSE_CHECKS:
            emit(CheckResult(role, check, False, 0, reason).line())
    emit(CheckResult("MODEL_EMBED", "embedding", False, 0, reason).line())
    return 1


async def run_checks(settings: Settings, *, emit: Callable[[str], None] = print) -> int:
    if settings.llm_key is None or not settings.llm_key.get_secret_value():
        return configuration_failure("LLM_KEY is not configured", emit)
    gateway = LLMClient(settings.model_copy(update={"mock": False}))
    results = []
    try:
        for role in MODEL_ROLES:
            model = getattr(settings, role.lower())
            for check in RESPONSE_CHECKS:
                result = await measure(role, check, lambda: check_response(gateway, model, check))
                results.append(result)
                emit(result.line())
        embedding = await measure("MODEL_EMBED", "embedding", lambda: check_embedding(gateway, settings.model_embed))
        results.append(embedding)
    finally:
        try:
            await gateway.close()
        except Exception:
            # Keep exactly ten result lines even if cleanup fails.
            if results and len(results) == 10 and results[-1].ok:
                results[-1].ok = False
                results[-1].detail = "client cleanup failed"
    emit(results[-1].line())
    return int(any(not result.ok for result in results))


def main() -> int:
    previous_logging = logging.root.manager.disable
    logging.disable(logging.CRITICAL)  # SDK debug modes must never dump payloads.
    try:
        try:
            settings = Settings()
        except Exception:
            return configuration_failure("configuration invalid; check settings without displaying secrets", lambda line: print(line, flush=True))
        return asyncio.run(run_checks(settings, emit=lambda line: print(line, flush=True)))
    except KeyboardInterrupt:
        return 130
    finally:
        logging.disable(previous_logging)


if __name__ == "__main__":
    raise SystemExit(main())
