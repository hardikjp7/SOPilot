"""The only SDK boundary. No request bodies, exception bodies, or keys are logged."""

import asyncio
import hashlib
import json
import time
from collections import OrderedDict
from collections.abc import Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, TypeVar

from openai import APIError, AsyncOpenAI, DefaultAsyncHttpxClient
from pydantic import ValidationError

from . import schemas
from .config import Settings
from .prompts import PROMPTS
from .schemas import AlertClassification, Checklist, Citation, ContractModel, EmbeddingBatch, IncidentTicket
from .verify import require_valid_citations

Output = TypeVar("Output", bound=ContractModel)
CALL_RECORDS = ContextVar('sopilot_call_records', default=None)


@contextmanager
def capture_calls():
    records = []
    token = CALL_RECORDS.set(records)
    try:
        yield records
    finally:
        CALL_RECORDS.reset(token)


class LLMUnavailable(Exception):
    code = "llm_unavailable"

    def __init__(self, message: str = "The model service is unavailable.") -> None:
        super().__init__(message)


class LLMClient:
    def __init__(self, settings: Settings, *, client: Any = None) -> None:
        self.settings = settings
        self._client = client
        self._classifications: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._pending_classifications: dict[str, asyncio.Task] = {}

    def _sdk(self) -> Any:
        if self.settings.mock:
            raise LLMUnavailable("Network model calls are disabled in mock mode.")
        if self._client is None:
            key = self.settings.llm_key
            if key is None or not key.get_secret_value():
                raise LLMUnavailable("LLM_KEY is not configured.")
            self._client = AsyncOpenAI(
                api_key=key.get_secret_value(), base_url=self.settings.llm_base_url,
                timeout=30.0, max_retries=0,
                http_client=DefaultAsyncHttpxClient(verify=self.settings.tls_verify, timeout=30.0),
            )
        return self._client

    async def close(self) -> None:
        pending = list(self._pending_classifications.values())
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        self._classifications.clear()
        if self._client is not None:
            await self._client.close()

    def _log(
        self, *, stage: str, model: str, response: Any, started: float,
        ok: bool, used_fallback: bool,
    ) -> None:
        usage = getattr(response, "usage", None)
        row = {
            "ts": datetime.now(timezone.utc).isoformat(), "stage": stage, "model": model,
            "input_tokens": getattr(usage, "input_tokens", getattr(usage, "prompt_tokens", 0)) or 0,
            "output_tokens": getattr(usage, "output_tokens", 0) or 0,
            "latency_ms": round((time.perf_counter() - started) * 1000, 3),
            "ok": ok, "used_fallback": used_fallback,
        }
        records = CALL_RECORDS.get()
        if records is not None:
            records.append(row.copy())
        self.settings.data_dir.mkdir(parents=True, exist_ok=True)
        with (self.settings.data_dir / "usage.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(row) + "\n")

    async def complete(
        self, *, stage: str, output_schema: type[Output], payload: dict[str, Any],
        citations: Mapping[str, Citation] | None = None,
    ) -> Output:
        if stage != "parse" or output_schema is not AlertClassification or self.settings.mock or not self.settings.parse_cache_size:
            return await self._complete(stage=stage, output_schema=output_schema, payload=payload, citations=citations)
        # Cache only the internal redacted classification, never a ParsedAlert or
        # restored identities. The full input, model and prompt determine the key.
        key = hashlib.sha256(json.dumps({
            "payload": payload, "prompt": PROMPTS[stage], "model": self.settings.model_fast,
            "fallback": self.settings.model_fallback, "base_url": self.settings.llm_base_url,
        }, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        if key in self._classifications:
            self._classifications.move_to_end(key)
            return output_schema.model_validate(self._classifications[key])
        pending = self._pending_classifications.get(key)
        if pending is None:
            async def classify():
                result = await self._complete(stage=stage, output_schema=output_schema, payload=payload, citations=citations)
                self._classifications[key] = result.model_dump()
                self._classifications.move_to_end(key)
                while len(self._classifications) > self.settings.parse_cache_size:
                    self._classifications.popitem(last=False)
                return result

            pending = asyncio.create_task(classify())
            self._pending_classifications[key] = pending

            def finished(task):
                self._pending_classifications.pop(key, None)
                if not task.cancelled():
                    task.exception()  # Consume failures even if every waiting request disconnected.

            pending.add_done_callback(finished)
        # Identical concurrent requests share one model call; unrelated alerts can
        # still classify concurrently. One caller disconnecting does not cancel peers.
        result = await asyncio.shield(pending)
        return output_schema.model_validate(result.model_dump())

    async def _complete(
        self, *, stage: str, output_schema: type[Output], payload: dict[str, Any],
        citations: Mapping[str, Citation] | None = None,
        cve_ids: list[str] | None = None,
    ) -> Output:
        if stage not in PROMPTS:
            raise ValueError("Unknown model stage")
        if output_schema.__module__ != schemas.__name__:
            raise ValueError("Model outputs must use a schema declared in schemas.py")
        if self.settings.mock:
            from .mock import MockCatalog

            return MockCatalog().model_output(output_schema)

        client = self._sdk()
        primary = self.settings.model_fast if stage in {"parse", "verify"} else self.settings.model_main
        # Disable SDK retries so the entire policy is exactly 3 primary calls + 1 fallback.
        validation_failures = 0
        for index in range(4):
            fallback = index == 3
            if not fallback and validation_failures >= 2:
                continue
            if index in (1, 2):
                await asyncio.sleep(2 ** (index - 1))
            model = self.settings.model_fallback if fallback else primary
            response, ok = None, False
            started = time.perf_counter()
            try:
                response = await self._response_with_tools(client,
                    model=model, instructions=PROMPTS[stage],
                    input=[{"role": "user", "content": json.dumps(payload)}],
                    text={"format": {
                        "type": "json_schema", "name": output_schema.__name__,
                        "strict": True, "schema": schemas.strict_json_schema(output_schema),
                    }},
                    store=False,
                    cve_ids=cve_ids, stage=stage, fallback=fallback,
                )
                if response.status != "completed":
                    raise ValueError("Incomplete model response")
                result = output_schema.model_validate_json(response.output_text)
                if isinstance(result, schemas.SupportVerdicts):
                    expected = {step['order'] for step in payload['steps']}
                    orders = [v.order for v in result.verdicts]
                    if len(orders) != len(expected) or set(orders) != expected:
                        raise ValueError('Verifier must judge exactly the supplied steps')
                if isinstance(result, schemas.TicketContent):
                    from .ticket import validate_content
                    validate_content(result, payload)
                if isinstance(result, (Checklist, IncidentTicket)):
                    require_valid_citations(result, citations or {})
                if isinstance(result, schemas.ChecklistDraft):
                    allowed = {c['step_id']: c for c in payload['chunks']}
                    seen = set()
                    for step in result.steps:
                        chunk = allowed.get(step.step_id)
                        if (chunk is None or step.step_id in seen or step.playbook_id != chunk['playbook_id']
                                or step.action != chunk['allowed_action']):
                            raise ValueError('Generated action or citation is outside the provided chunks')
                        seen.add(step.step_id)
                ok = True
                return result
            except (ValidationError, ValueError):
                validation_failures += 1
            except (APIError, TimeoutError):
                pass
            finally:
                self._log(
                    stage=stage, model=model, response=response, started=started,
                    ok=ok, used_fallback=fallback,
                )
        raise LLMUnavailable() from None

    async def generate_checklist(self, payload: dict[str, Any]) -> schemas.ChecklistDraft:
        return await self._complete(stage='generate', output_schema=schemas.ChecklistDraft,
                                    payload=payload, cve_ids=payload['parsed']['iocs']['cve_ids'])

    async def _response_with_tools(self, client, *, cve_ids, stage, fallback, **request):
        if cve_ids is None:
            return await client.responses.create(**request)
        from .cve import LOOKUP_CVE_TOOL, execute_cve_tool
        remaining = {value.upper() for value in cve_ids}
        conversation = list(request.pop('input'))
        # A bounded loop: every round must resolve at least one remaining alert CVE.
        for _ in range(len(remaining) + 1):
            response = None
            started = time.perf_counter()
            try:
                response = await client.responses.create(
                    **request, input=conversation, tools=[LOOKUP_CVE_TOOL],
                    tool_choice='required' if remaining else 'none',
                )
                calls = [item for item in response.output if item.type == 'function_call']
                if not calls:
                    if remaining:
                        raise ValueError('Model did not look up all alert CVEs')
                    return response  # Final response is logged and validated by _complete.
                conversation.extend(item.model_dump(exclude_none=True) for item in response.output)
                for call in calls:
                    arguments = schemas.LookupCVEArguments.model_validate_json(call.arguments)
                    identifier = arguments.id.strip().upper()
                    if call.name != 'lookup_cve' or identifier not in remaining:
                        raise ValueError('Unexpected or repeated CVE tool call')
                    result = execute_cve_tool(call.name, call.arguments)
                    remaining.remove(identifier)
                    conversation.append({'type': 'function_call_output', 'call_id': call.call_id,
                                         'output': json.dumps(result)})
            finally:
                if response is not None and any(item.type == 'function_call' for item in response.output):
                    self._log(stage=stage, model=request['model'], response=response, started=started,
                              ok=True, used_fallback=fallback)
        raise ValueError('CVE tool round budget exceeded')

    async def embed(self, texts: list[str]) -> EmbeddingBatch:
        """Embedding failures retry twice; a text-model fallback cannot embed vectors."""
        if not texts:
            raise ValueError("At least one embedding input is required")
        client = self._sdk()
        for index in range(3):
            if index:
                await asyncio.sleep(2 ** (index - 1))
            response, ok = None, False
            started = time.perf_counter()
            try:
                response = await client.embeddings.create(model=self.settings.model_embed, input=texts)
                ordered = sorted(response.data, key=lambda item: item.index)
                if [item.index for item in ordered] != list(range(len(texts))):
                    raise ValueError("Embedding response does not match the inputs")
                result = EmbeddingBatch(vectors=[item.embedding for item in ordered])
                ok = True
                return result
            except (APIError, TimeoutError, ValueError, ValidationError):
                pass
            finally:
                self._log(
                    stage="retrieve", model=self.settings.model_embed, response=response,
                    started=started, ok=ok, used_fallback=False,
                )
        raise LLMUnavailable() from None

