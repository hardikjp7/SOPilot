import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from pydantic import SecretStr

from backend.app import llm
from backend.app.config import Settings
from backend.app.schemas import AlertClassification, Checklist, ParsedAlert


class FakeSDK:
    def __init__(self, outcomes):
        self.outcomes = iter(outcomes)
        self.calls = []
        self.responses = SimpleNamespace(create=self.create)
        self.embeddings = SimpleNamespace(create=self.create)
        self.close = AsyncMock()

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        outcome = next(self.outcomes)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def response(model, status="completed"):
    return SimpleNamespace(
        status=status, output_text=model.model_dump_json() if hasattr(model, "model_dump_json") else model,
        usage=SimpleNamespace(input_tokens=12, output_tokens=7),
    )


@pytest.fixture
def live_settings(tmp_path):
    return Settings(_env_file=None, mock=False, data_dir=tmp_path)


@pytest.fixture
def backoff(monkeypatch):
    sleep = AsyncMock()
    monkeypatch.setattr(llm.asyncio, "sleep", sleep)
    return sleep


def complete(client, **kwargs):
    return asyncio.run(client.complete(stage="parse", output_schema=ParsedAlert, payload={"alert": {}}, **kwargs))


def rows(settings):
    return [json.loads(line) for line in (settings.data_dir / "usage.jsonl").read_text().splitlines()]


def test_structured_output_and_safe_logging(live_settings, catalog):
    sdk = FakeSDK([response(catalog.runs["ALR-RAN"].parsed)])
    client = llm.LLMClient(live_settings, client=sdk)
    result = complete(client)
    assert result.attack_type == "ransomware"
    call = sdk.calls[0]
    assert call["model"] == live_settings.model_fast
    assert call["text"]["format"]["strict"] is True
    assert call["text"]["format"]["type"] == "json_schema"
    assert "temperature" not in call and "top_p" not in call
    assert "untrusted data" in call["instructions"]
    assert call["input"][0]["role"] == "user" and call["store"] is False
    log = rows(live_settings)
    assert len(log) == 1 and log[0]["ok"] and not log[0]["used_fallback"]
    assert log[0]["input_tokens"] == 12 and log[0]["output_tokens"] == 7
    assert log[0]["latency_ms"] >= 0
    assert set(log[0]) == {"ts", "stage", "model", "input_tokens", "output_tokens", "latency_ms", "ok", "used_fallback"}


def test_two_transport_retries_then_one_fallback(live_settings, catalog, backoff):
    sdk = FakeSDK([TimeoutError(), TimeoutError(), TimeoutError(), response(catalog.runs["ALR-RAN"].parsed)])
    assert complete(llm.LLMClient(live_settings, client=sdk)).attack_type == "ransomware"
    assert [call["model"] for call in sdk.calls] == [live_settings.model_fast] * 3 + [live_settings.model_fallback]
    assert [call.args[0] for call in backoff.await_args_list] == [1, 2]
    assert [row["ok"] for row in rows(live_settings)] == [False, False, False, True]
    assert rows(live_settings)[-1]["used_fallback"]


def test_exhaustion_is_sanitized_and_logs_each_attempt(live_settings, backoff):
    secret = uuid4().hex
    sdk = FakeSDK([TimeoutError(secret) for _ in range(4)])
    with pytest.raises(llm.LLMUnavailable, match="unavailable") as exc:
        complete(llm.LLMClient(live_settings, client=sdk))
    assert secret not in str(exc.value)
    assert secret not in (live_settings.data_dir / "usage.jsonl").read_text()
    assert len(rows(live_settings)) == 4 and not any(row["ok"] for row in rows(live_settings))


@pytest.mark.parametrize("bad_response", [response("{}"), response("not json"), response("{}", "incomplete"), response("")])
def test_invalid_or_refused_output_retries_once_then_falls_back(live_settings, catalog, backoff, bad_response):
    sdk = FakeSDK([bad_response, bad_response, response(catalog.runs["ALR-RAN"].parsed)])
    complete(llm.LLMClient(live_settings, client=sdk))
    assert [call["model"] for call in sdk.calls] == [live_settings.model_fast] * 2 + [live_settings.model_fallback]
    assert rows(live_settings)[0]["input_tokens"] == 12
    assert [call.args[0] for call in backoff.await_args_list] == [1]


def test_unallowed_citation_never_escapes_gateway(live_settings, catalog, backoff):
    checklist = catalog.runs["ALR-RAN"].checklist
    sdk = FakeSDK([response(checklist)] * 3)
    with pytest.raises(llm.LLMUnavailable):
        asyncio.run(llm.LLMClient(live_settings, client=sdk).complete(
            stage="generate", output_schema=Checklist, payload={}, citations={},
        ))
    assert not any(row["ok"] for row in rows(live_settings))
    sdk = FakeSDK([response(checklist)])
    result = asyncio.run(llm.LLMClient(live_settings, client=sdk).complete(
        stage="generate", output_schema=Checklist, payload={}, citations=catalog.citations,
    ))
    assert result == checklist and sdk.calls[0]["model"] == live_settings.model_main


@pytest.mark.parametrize("tls_verify", [True, False])
def test_sdk_configuration(live_settings, monkeypatch, tls_verify):
    secret = uuid4().hex
    live_settings.llm_key = SecretStr(secret)
    live_settings.tls_verify = tls_verify
    captured = {}

    def transport(**kwargs):
        captured["transport"] = kwargs
        return object()

    def sdk(**kwargs):
        captured["sdk"] = kwargs
        return object()

    monkeypatch.setattr(llm, "DefaultAsyncHttpxClient", transport)
    monkeypatch.setattr(llm, "AsyncOpenAI", sdk)
    llm.LLMClient(live_settings)._sdk()
    assert captured["transport"] == {"verify": tls_verify, "timeout": 30.0}
    assert captured["sdk"]["timeout"] == 30.0 and captured["sdk"]["max_retries"] == 0
    assert captured["sdk"]["api_key"] == secret
    assert captured["sdk"]["base_url"] == live_settings.llm_base_url
    assert secret not in repr(live_settings)


def test_mock_needs_no_sdk_and_no_usage_log(settings, monkeypatch):
    def forbidden(**kwargs):
        raise AssertionError("Mock mode must never construct the SDK")

    monkeypatch.setattr(llm, "AsyncOpenAI", forbidden)
    assert complete(llm.LLMClient(settings)).attack_type == "ransomware"
    assert not (settings.data_dir / "usage.jsonl").exists()


def test_missing_key_fails_without_network(live_settings):
    live_settings.llm_key = None
    with pytest.raises(llm.LLMUnavailable, match="not configured"):
        complete(llm.LLMClient(live_settings))


def test_embeddings_are_validated_and_logged(live_settings):
    sdk = FakeSDK([SimpleNamespace(
        data=[SimpleNamespace(index=1, embedding=[0.3, 0.4]), SimpleNamespace(index=0, embedding=[0.1, 0.2])],
        usage=SimpleNamespace(prompt_tokens=10),
    )])
    result = asyncio.run(llm.LLMClient(live_settings, client=sdk).embed(["one", "two"]))
    assert result.vectors == [[0.1, 0.2], [0.3, 0.4]]
    assert sdk.calls[0]["model"] == live_settings.model_embed
    assert rows(live_settings)[0]["input_tokens"] == 10


def test_invalid_embeddings_do_not_fallback_to_a_text_model(live_settings, backoff):
    sdk = FakeSDK([SimpleNamespace(data=[SimpleNamespace(index=0, embedding=[float("nan")])], usage=None)] * 3)
    with pytest.raises(llm.LLMUnavailable):
        asyncio.run(llm.LLMClient(live_settings, client=sdk).embed(["one"]))
    assert len(sdk.calls) == 3 and all(call["model"] == live_settings.model_embed for call in sdk.calls)


def test_gateway_closes_client(live_settings):
    sdk = FakeSDK([])
    asyncio.run(llm.LLMClient(live_settings, client=sdk).close())
    sdk.close.assert_awaited_once()


def test_classification_cache_is_bounded_and_tracks_model_and_prompt(live_settings, monkeypatch):
    live_settings.parse_cache_size = 1
    output = AlertClassification(attack_type="unknown", severity="low", confidence=0.9,
                                 summary="No matching activity is established. More evidence is needed.", evidence_fields=[])
    sdk = FakeSDK([response(output)] * 5)
    client = llm.LLMClient(live_settings, client=sdk)

    async def run():
        async def classify(payload):
            return await client.complete(stage="parse", output_schema=AlertClassification, payload=payload)
        first = await classify({"alert": {"message": "one"}})
        first.evidence_fields.append("modified-by-caller")
        assert (await classify({"alert": {"message": "one"}})).evidence_fields == []
        await classify({"alert": {"message": "two"}})
        await classify({"alert": {"message": "one"}})  # Evicted by the second alert.
        live_settings.model_fast = "changed-model"
        await classify({"alert": {"message": "one"}})
        monkeypatch.setitem(llm.PROMPTS, "parse", llm.PROMPTS["parse"] + " Updated classification policy.")
        await classify({"alert": {"message": "one"}})

    asyncio.run(run())
    assert len(sdk.calls) == 5 and len(client._classifications) == 1
    assert len(rows(live_settings)) == 5  # Cache hits are not billed model calls.


def test_concurrent_identical_classifications_share_one_call(live_settings):
    output = AlertClassification(attack_type="unknown", severity="low", confidence=0.9,
                                 summary="There is insufficient evidence. Analyst review is needed.", evidence_fields=[])
    sdk = FakeSDK([response(output)])
    client = llm.LLMClient(live_settings, client=sdk)

    async def run():
        return await asyncio.gather(*[
            client.complete(stage="parse", output_schema=AlertClassification, payload={"alert": {}})
            for _ in range(4)
        ])

    results = asyncio.run(run())
    assert results == [output] * 4 and len(sdk.calls) == 1
    assert not client._pending_classifications


def test_failed_classification_is_not_cached(live_settings, backoff):
    output = AlertClassification(attack_type="unknown", severity="low", confidence=0.9,
                                 summary="There is insufficient evidence. Analyst review is needed.", evidence_fields=[])
    sdk = FakeSDK([TimeoutError()] * 4 + [response(output)])
    client = llm.LLMClient(live_settings, client=sdk)

    async def run():
        with pytest.raises(llm.LLMUnavailable):
            await client.complete(stage="parse", output_schema=AlertClassification, payload={})
        return await client.complete(stage="parse", output_schema=AlertClassification, payload={})

    assert asyncio.run(run()) == output and len(sdk.calls) == 5
