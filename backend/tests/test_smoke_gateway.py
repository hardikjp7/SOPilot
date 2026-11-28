import asyncio
import json
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import SecretStr

from backend.app import llm
from backend.app.config import Settings
from scripts import smoke_gateway as smoke


class FakeSDK:
    def __init__(self, broken=None, dimensions=3072):
        self.calls = []
        self.broken = broken
        self.dimensions = dimensions
        self.responses = SimpleNamespace(create=self.respond)
        self.embeddings = SimpleNamespace(create=self.embed)
        self.close = AsyncMock()

    async def respond(self, **request):
        self.calls.append(request)
        if self.broken is not None:
            outcome = self.broken(request)
            if isinstance(outcome, Exception):
                raise outcome
            if outcome is not None:
                return outcome
        if "tools" in request:
            return SimpleNamespace(status="completed", output=[SimpleNamespace(
                type="function_call", name="smoke_echo", arguments=json.dumps({"id": smoke.PROBE_ID}),
            )])
        return SimpleNamespace(status="completed", output_text=json.dumps({"id": smoke.PROBE_ID}) if "text" in request else "OK")

    async def embed(self, **request):
        self.calls.append(request)
        return SimpleNamespace(data=[SimpleNamespace(index=0, embedding=[0.1] * self.dimensions)])


def run(monkeypatch, sdk, **overrides):
    settings = Settings(_env_file=None, llm_key=SecretStr("synthetic-canary-not-a-real-key"),
                        model_main="test-main", model_fast="test-fast", model_fallback="test-fallback",
                        model_embed="test-embedding", **overrides)
    configurations = []

    def factory(config):
        configurations.append(config)
        return llm.LLMClient(config, client=sdk)

    monkeypatch.setattr(smoke, "LLMClient", factory)
    lines = []
    status = asyncio.run(smoke.run_checks(settings, emit=lines.append))
    return status, lines, configurations


def test_ten_checks_use_each_exact_model_without_fallback_and_close(monkeypatch):
    sdk = FakeSDK()
    status, lines, configs = run(monkeypatch, sdk, mock=True)
    assert status == 0 and len(lines) == 10
    assert all(" OK " in line and " ms" in line for line in lines)
    assert lines[-1].endswith("vector_length=3072")
    assert [call["model"] for call in sdk.calls] == ["test-main"] * 3 + ["test-fast"] * 3 + ["test-fallback"] * 3 + ["test-embedding"]
    assert configs[0].mock is False
    assert len(sdk.calls) == 10
    assert all(call.get("store") is False for call in sdk.calls[:9])
    assert all("temperature" not in call and "top_p" not in call for call in sdk.calls)
    sdk.close.assert_awaited_once()
    for call in sdk.calls[:9]:
        schema = call.get("text", {}).get("format")
        if schema:
            assert schema["strict"] and schema["schema"]["additionalProperties"] is False
            assert schema["schema"]["required"] == ["id"]
        if "tools" in call:
            assert call["tool_choice"] == "required"
            assert call["tools"][0]["strict"]


def test_one_failure_is_not_hidden_by_a_working_fallback_or_printed(monkeypatch):
    def fail(request):
        if request["model"] == "test-main" and "text" in request:
            return RuntimeError("synthetic-canary-not-a-real-key PRIVATE REQUEST BODY")
    sdk = FakeSDK(fail)
    status, lines, _ = run(monkeypatch, sdk)
    assert status == 1 and len(lines) == 10
    assert sum(" FAIL " in line for line in lines) == 1
    assert "MODEL_MAIN/structured FAIL" in lines[1]
    assert sum(" OK " in line for line in lines) == 9
    assert "PRIVATE REQUEST BODY" not in "\n".join(lines)
    assert "synthetic-canary" not in "\n".join(lines)
    assert len(sdk.calls) == 10


@pytest.mark.parametrize("kind", ["empty_text", "incomplete", "invalid_json", "wrong_id", "extra_field", "missing_tool", "wrong_tool", "bad_arguments"])
def test_success_requires_actual_supported_outputs(monkeypatch, kind):
    def broken(request):
        if "tools" in request:
            if kind == "missing_tool": return SimpleNamespace(status="completed", output=[])
            if kind in {"wrong_tool", "bad_arguments"}:
                return SimpleNamespace(status="completed", output=[SimpleNamespace(type="function_call", name="other" if kind == "wrong_tool" else "smoke_echo", arguments="{}")])
        elif "text" in request:
            if kind == "invalid_json": return SimpleNamespace(status="completed", output_text="private invalid body")
            if kind == "wrong_id": return SimpleNamespace(status="completed", output_text='{"id":"wrong"}')
            if kind == "extra_field": return SimpleNamespace(status="completed", output_text='{"id":"x","extra":true}')
        elif kind in {"empty_text", "incomplete"}:
            return SimpleNamespace(status="incomplete" if kind == "incomplete" else "completed", output_text="")
    status, lines, _ = run(monkeypatch, FakeSDK(broken))
    assert status == 1 and len(lines) == 10
    assert sum(" FAIL " in line for line in lines) == 3
    assert "private invalid body" not in "\n".join(lines)


@pytest.mark.parametrize("dimensions", [0, 1536, 3073])
def test_embedding_dimension_mismatch_fails(monkeypatch, dimensions):
    status, lines, _ = run(monkeypatch, FakeSDK(dimensions=dimensions))
    assert status == 1 and len(lines) == 10
    assert "MODEL_EMBED/embedding FAIL" in lines[-1]


def test_missing_key_still_prints_exactly_ten_failures_without_network(monkeypatch):
    monkeypatch.setattr(smoke, "LLMClient", lambda config: pytest.fail("must not construct client"))
    lines = []
    assert asyncio.run(smoke.run_checks(Settings(_env_file=None, llm_key=None), emit=lines.append)) == 1
    assert len(lines) == 10 and all(" FAIL " in line for line in lines)


@pytest.mark.parametrize("verify", [True, False])
def test_production_factory_applies_configured_tls_timeout_and_auth(monkeypatch, verify):
    sdk = FakeSDK()
    transport = object()
    build_transport = []
    build_sdk = []
    monkeypatch.setattr(llm, "DefaultAsyncHttpxClient", lambda **args: build_transport.append(args) or transport)
    monkeypatch.setattr(llm, "AsyncOpenAI", lambda **args: build_sdk.append(args) or sdk)
    settings = Settings(_env_file=None, llm_key=SecretStr("synthetic-canary"), tls_verify=verify)
    assert asyncio.run(smoke.run_checks(settings, emit=lambda line: None)) == 0
    assert build_transport == [{"verify": verify, "timeout": 30.0}]
    assert build_sdk[0]["base_url"] == settings.llm_base_url
    assert build_sdk[0]["timeout"] == 30.0 and build_sdk[0]["max_retries"] == 0
    sdk.close.assert_awaited_once()


def test_status_and_timeout_errors_do_not_display_upstream_bodies():
    class HttpFailure(Exception):
        status_code = 401
    assert smoke.short_error(HttpFailure("private request/key")) == "HTTP 401: authentication rejected"
    assert "timed out" in smoke.short_error(TimeoutError("private request/key"))


def test_cleanup_failure_changes_the_final_result_without_an_extra_line(monkeypatch):
    sdk = FakeSDK()
    sdk.close.side_effect = RuntimeError("private cleanup error")
    status, lines, _ = run(monkeypatch, sdk)
    assert status == 1 and len(lines) == 10
    assert lines[-1].endswith("client cleanup failed")


def test_invalid_configuration_is_sanitized_and_does_not_start_a_client(monkeypatch, capsys):
    def fail(): raise ValueError("synthetic private configuration")
    monkeypatch.setattr(smoke, "Settings", fail)
    assert smoke.main() == 1
    output = capsys.readouterr()
    assert len(output.out.splitlines()) == 10
    assert "synthetic private configuration" not in output.out + output.err


@pytest.mark.skipif(os.environ.get("SOPILOT_LIVE_GATEWAY") != "1", reason="Set SOPILOT_LIVE_GATEWAY=1 for the configured live gateway")
def test_configured_live_gateway_all_models_and_embedding():
    lines = []
    status = asyncio.run(smoke.run_checks(Settings(), emit=lines.append))
    assert status == 0, "\n".join(lines)
    assert len(lines) == 10 and all(" OK " in line for line in lines)
    assert lines[-1].endswith("vector_length=3072")
    for line in lines:
        print(line)
