"""Contract v2 HTTP API. MOCK=1 runs the canned workflow without network calls."""

import asyncio
import json
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import APIRouter, Depends, FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from starlette.exceptions import HTTPException

from .audit import AlreadyApproved, NotFound, Store, now
from .config import Settings
from .llm import LLMClient, LLMUnavailable, capture_calls
from .mock import MockCatalog
from .parser import parse_alert, require_mock_mode
from .retrieval import Retriever
from .generate import generate_checklist, no_match
from .schemas import (
    AlertRequest, ApproveRequest, AuditRow, Checklist, ChecklistRequest, ErrorDetail,
    ErrorResponse, Health, IncidentTicket, ParsedAlert, RunResponse, Sample, SearchHit, TicketRequest,
)
from .ticket import draft_from_run, export_markdown, generate_ticket
from .pipeline import run_pipeline
from .verify import apply_fallback_rules, require_valid_citations, verify_checklist


def error(status: int, code: str, message: str, details=None) -> JSONResponse:
    body = ErrorResponse(error=ErrorDetail(code=code, message=message, details=details))
    return JSONResponse(status_code=status, content=body.model_dump())


class BodyLimit:
    def __init__(self, app, limit: int) -> None:
        self.app, self.limit = app, limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        chunks, size = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body = message.get("body", b"")
            size += len(body)
            if size > self.limit:
                return await error(413, "payload_too_large", "Request body exceeds the configured limit.")(scope, receive, send)
            chunks.append(body)
            if not message.get("more_body", False):
                break
        body = b''.join(chunks)
        if scope['path'].startswith('/api/') and scope['method'] in {'POST', 'PUT', 'PATCH'}:
            content_type = dict(scope.get('headers', [])).get(b'content-type', b'').decode('latin-1').split(';', 1)[0].strip().lower()
            if content_type != 'application/json' and not (content_type.startswith('application/') and content_type.endswith('+json')):
                return await error(422, 'validation_error', 'Content-Type must be application/json.')(scope, receive, send)

            def object_pairs(pairs):
                result = {}
                for key, value in pairs:
                    if key in result:
                        raise ValueError('Duplicate JSON property')
                    result[key] = value
                return result

            def invalid_number(value):
                raise ValueError('Non-finite JSON number')

            try:
                json.loads(body.decode('utf-8'), object_pairs_hook=object_pairs, parse_constant=invalid_number)
            except (ValueError, UnicodeError, RecursionError):
                return await error(422, 'invalid_json', 'Request body must be valid UTF-8 JSON.')(scope, receive, send)
        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        started = False

        async def guarded_send(message):
            nonlocal started
            if message['type'] == 'http.response.start':
                started = True
            await send(message)

        try:
            await self.app(scope, replay, guarded_send)
        except Exception:
            if started:
                raise
            # Never expose upstream exception bodies, credentials or alert data.
            await error(500, 'internal_error', 'An internal error occurred.')(scope, receive, send)


async def mock_delay(request: Request) -> None:
    if request.app.state.settings.mock:
        await asyncio.sleep(0.3)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.store = Store(settings.data_dir / "app.db")
        app.state.catalog = MockCatalog() if settings.mock else None
        app.state.llm = LLMClient(settings)
        try:
            yield
        finally:
            await app.state.llm.close()

    app = FastAPI(title="SOPilot", version="2", lifespan=lifespan)
    app.state.settings = settings
    app.add_middleware(BodyLimit, limit=settings.max_request_bytes)
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        invalid_json = any(item["type"] == "json_invalid" for item in exc.errors())
        return error(
            422, "invalid_json" if invalid_json else "validation_error", "Request validation failed.",
            [{"loc": list(item["loc"]), "type": item["type"]} for item in exc.errors()],
        )

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        return error(exc.status_code, "not_found" if exc.status_code == 404 else "validation_error", str(exc.detail))

    @app.exception_handler(LLMUnavailable)
    async def llm_error(request, exc):
        return error(503, "llm_unavailable", str(exc))

    @app.exception_handler(NotFound)
    async def not_found(request, exc):
        return error(404, "not_found", "The requested record was not found.")

    @app.exception_handler(AlreadyApproved)
    async def approved_error(request, exc):
        return error(409, "already_approved", "The ticket has already been approved.")

    router = APIRouter(prefix="/api", dependencies=[Depends(mock_delay)])

    def catalog() -> MockCatalog:
        require_mock_mode(settings.mock)
        return app.state.catalog

    async def checked(checklist: Checklist, parsed: ParsedAlert) -> Checklist:
        report = await verify_checklist(checklist, settings, llm=app.state.llm, citations=catalog().citations)
        return apply_fallback_rules(report.checklist, parsed, settings, margin=1.0)

    @router.get("/health", response_model=Health)
    def health():
        if settings.mock:
            return catalog().health
        index_chunks = 0
        if (settings.data_dir / "chroma").is_dir():
            from chromadb.errors import NotFoundError
            from .ingest import COLLECTION_NAME, open_chroma

            try:
                index_chunks = open_chroma(settings).get_collection(COLLECTION_NAME, embedding_function=None).count()
            except NotFoundError:
                pass
        return Health(status="ok", mock=False, index_chunks=index_chunks)

    @router.get("/samples", response_model=list[Sample])
    def samples():
        # Synthetic samples are available without configuring model credentials.
        return (catalog() if settings.mock else MockCatalog()).samples

    @router.post("/alerts/parse", response_model=ParsedAlert)
    async def parse(body: AlertRequest):
        if settings.mock:
            return catalog().for_alert(body.alert).parsed
        return await parse_alert(body.alert, settings, llm=app.state.llm)

    @router.post("/run", response_model=RunResponse)
    async def run(body: AlertRequest):
        if not settings.mock:
            result, stages = await run_pipeline(body.alert, settings, app.state.llm)
            app.state.store.save_run(result, body.alert, stages=stages)
            return result
        result = catalog().for_alert(body.alert)
        result.run_id = f"RUN-{uuid4().hex[:12]}"
        draft = result.checklist.model_copy(deep=True)
        report = await verify_checklist(draft, settings, llm=app.state.llm, citations=catalog().citations)
        result.checklist = apply_fallback_rules(report.checklist, result.parsed, settings, margin=1.0)
        chunk_ids = [s.citation.step_id for s in draft.steps]
        stages = [
            {'stage': 'parse', 'before': body.alert, 'after': result.parsed.model_dump(), 'details': {}},
            {'stage': 'retrieve', 'before': result.parsed.model_dump(), 'after': chunk_ids, 'details': {'chunk_ids': chunk_ids}},
            {'stage': 'generate', 'before': chunk_ids, 'after': draft.model_dump(), 'details': {}},
            {'stage': 'verify', 'before': draft.model_dump(), 'after': result.checklist.model_dump(),
             'details': {'verdicts': [v.model_dump() for v in report.verdicts], 'dropped_ids': report.dropped_ids}},
        ]
        for stage in stages:
            stage.update(model='mock', ts=now())
            stage['details']['mock'] = True
        app.state.store.save_run(result, body.alert, stages=stages)
        return result

    @router.post("/checklist", response_model=Checklist)
    async def checklist(body: ChecklistRequest):
        if not settings.mock:
            if body.parsed.attack_type == 'unknown':
                return no_match(body.parsed, 0.0)
            retrieval = await Retriever(settings, app.state.llm).retrieve(body.parsed)
            draft = await generate_checklist(body.parsed, retrieval, settings, llm=app.state.llm)
            return (await verify_checklist(draft, settings, llm=app.state.llm)).checklist
        return await checked(catalog().for_parsed(body.parsed), body.parsed)

    @router.post("/ticket", response_model=IncidentTicket)
    async def ticket(body: TicketRequest):
        existing = app.state.store.ticket_for_run(body.run_id)
        if existing is not None:
            return existing
        run = app.state.store.get_run(body.run_id)
        if not settings.mock:
            events = [{'time': row.details_json.get('completed_at', row.ts), 'event': row.stage + ' stage completed'}
                      for row in app.state.store.audit_rows(body.run_id)]
            with capture_calls() as calls:
                draft, payload = await generate_ticket(run, settings, llm=app.state.llm, events=events)
            successful = [c for c in calls if c['ok']]
            return app.state.store.save_ticket(draft, model=successful[-1]['model'] if successful else None, payload=payload)
        fixtures = catalog()
        draft = draft_from_run(fixtures.ticket, run)
        require_valid_citations(draft, fixtures.citations)
        return app.state.store.save_ticket(draft)

    @router.post("/approve", response_model=IncidentTicket)
    def approve(body: ApproveRequest):
        return app.state.store.approve(body.ticket_id, body.analyst_name)

    @router.get("/tickets/{ticket_id}/export.md", response_class=PlainTextResponse)
    def export(ticket_id: str):
        return PlainTextResponse(export_markdown(app.state.store.get_ticket(ticket_id)), media_type="text/markdown")

    @router.get("/search", response_model=list[SearchHit])
    async def search(q: str = "", k: int = Query(default=settings.retrieval_top_k, ge=1)):
        if not settings.mock:
            result = await Retriever(settings, app.state.llm).search(q, k=k)
            return [SearchHit(playbook_id=c.playbook_id, step_id=c.step_id, text=c.text, score=c.score) for c in result.chunks]
        hits = catalog().search
        return [hit for hit in hits if q.casefold() in f"{hit.playbook_id} {hit.text}".casefold()][:k]

    @router.get("/audit", response_model=list[AuditRow])
    def audit(run_id: str):
        return app.state.store.audit_rows(run_id)

    app.include_router(router)
    return app


app = create_app()
