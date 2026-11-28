"""Real Chroma and SDK transport, with an offline lexical embedding server.

These tests exercise indexing/ranking plumbing, not the live gateway's semantic quality.
"""

import asyncio
import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from uuid import uuid4

import pytest
from pydantic import SecretStr, ValidationError

from backend.app.config import ROOT, Settings
from backend.app.ingest import COLLECTION_NAME, ingest, load_chunks, open_chroma
from backend.app.llm import LLMClient, LLMUnavailable
from backend.app.schemas import EmbeddingBatch


def lexical_vector(text):
    """Generic deterministic token hashing; no query-specific IDs or canned rankings."""
    vector = [0.0] * 1024
    for word in re.findall(r"[a-z]+", text.lower()):
        index = int.from_bytes(hashlib.sha256(word.encode()).digest()[:4], "big") % len(vector)
        vector[index] += 1.0
    return vector


@pytest.fixture
def embedding_server():
    calls = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            if self.path != "/v1/embeddings":
                self.send_error(404)
                return
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            calls.append({"model": body["model"], "count": len(body["input"])})
            result = {
                "object": "list", "model": body["model"],
                "data": [{"object": "embedding", "index": i, "embedding": lexical_vector(text)}
                         for i, text in enumerate(body["input"])],
                "usage": {"prompt_tokens": len(body["input"]), "total_tokens": len(body["input"])},
            }
            encoded = json.dumps(result).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/v1/", calls
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@pytest.fixture
def ingest_settings(tmp_path, embedding_server):
    return Settings(
        _env_file=None, data_dir=tmp_path / "runtime", mock=False,
        llm_base_url=embedding_server[0], llm_key=SecretStr(uuid4().hex),
        model_embed="offline-test-embedding", embed_batch_size=16,
    )


@pytest.fixture
def knowledge_base(tmp_path):
    directory = tmp_path / "sources"
    for folder in ("playbooks", "cves"):
        shutil.copytree(ROOT / "data" / folder, directory / folder)
    return directory


def test_chunks_match_source_counts_metadata_and_exact_text():
    chunks = load_chunks()
    lines = [line for path in (ROOT / "data/playbooks").glob("*.md")
             for line in path.read_text().splitlines() if line.startswith("PB-")]
    cves = json.loads((ROOT / "data/cves/cves.json").read_text())
    assert len(chunks) == len(lines) + len(cves) == 65
    assert len({chunk.id for chunk in chunks}) == len(chunks)
    assert chunks == load_chunks()
    steps = [chunk for chunk in chunks if chunk.metadata["kind"] == "playbook"]
    assert {chunk.text for chunk in steps} == set(lines)
    ran = next(chunk for chunk in steps if chunk.id == "PB-RAN-02")
    assert ran.metadata == {
        "kind": "playbook", "playbook_id": "PB-RAN", "step_id": "PB-RAN-02",
        "phase": "Contain", "owner_role": "SOC Tier 2", "severity": "critical",
        "attack_type": "ransomware", "source_file": "playbooks/PB-RAN.md",
    }
    indexed_cves = {chunk.id: chunk for chunk in chunks if chunk.metadata["kind"] == "cve"}
    for cve in cves:
        chunk = indexed_cves[cve["id"]]
        assert json.loads(chunk.text) == cve
        assert json.loads(chunk.metadata["related_playbooks"]) == cve["related_playbooks"]


def test_cli_two_rebuilds_persist_same_ids_and_query_ransomware(ingest_settings, embedding_server):
    settings = ingest_settings
    env = dict(os.environ, DATA_DIR=str(settings.data_dir), LLM_BASE_URL=settings.llm_base_url,
               LLM_KEY=settings.llm_key.get_secret_value(), MODEL_EMBED=settings.model_embed,
               EMBED_BATCH_SIZE="16", MOCK="0")
    command = [sys.executable, "-m", "app.ingest", "--rebuild"]
    expected_ids = {chunk.id for chunk in load_chunks()}
    for _ in range(2):
        run = subprocess.run(command, cwd=ROOT / "backend", env=env, capture_output=True, text=True, timeout=60)
        assert run.returncode == 0, run.stderr
        assert "Indexed 65 chunks" in run.stderr
        assert settings.llm_key.get_secret_value() not in run.stderr
        collection = open_chroma(settings).get_collection(COLLECTION_NAME, embedding_function=None)
        assert collection.count() == 65
        assert set(collection.get(include=[])["ids"]) == expected_ids
    assert (settings.data_dir / "chroma/chroma.sqlite3").is_file()
    assert [call["count"] for call in embedding_server[1]] == [16, 16, 16, 16, 1] * 2
    assert all(call["model"] == settings.model_embed for call in embedding_server[1])

    async def embed_query():
        client = LLMClient(settings)
        try:
            return await client.embed(["isolate infected host"])
        finally:
            await client.close()

    query = asyncio.run(embed_query())
    results = collection.query(query_embeddings=query.vectors, n_results=3)
    assert "PB-RAN-02" in results["ids"][0]
    assert any(meta.get("playbook_id") == "PB-RAN" for meta in results["metadatas"][0])
    usage = [json.loads(line) for line in (settings.data_dir / "usage.jsonl").read_text().splitlines()]
    assert len(usage) == 11 and all(row["ok"] for row in usage)


def test_upsert_is_idempotent_updates_documents_and_removes_stale_ids(ingest_settings, knowledge_base, caplog):
    caplog.set_level(logging.INFO, logger="backend.app.ingest")
    assert asyncio.run(ingest(ingest_settings, source_dir=knowledge_base)) == 65
    assert asyncio.run(ingest(ingest_settings, source_dir=knowledge_base)) == 65
    path = knowledge_base / "playbooks/PB-RAN.md"
    path.write_text(path.read_text().replace("via EDR. |", "via EDR and confirm isolation. |"))
    cve_path = knowledge_base / "cves/cves.json"
    cves = json.loads(cve_path.read_text())
    removed = cves.pop()["id"]
    cve_path.write_text(json.dumps(cves))
    assert asyncio.run(ingest(ingest_settings, source_dir=knowledge_base)) == 64
    collection = open_chroma(ingest_settings).get_collection(COLLECTION_NAME, embedding_function=None)
    assert "confirm isolation" in collection.get(ids=["PB-RAN-02"])["documents"][0]
    assert collection.get(ids=[removed])["ids"] == []
    assert "50 playbook steps and 15 CVEs (65 chunks)" in caplog.text
    assert "removed 1 stale chunks" in caplog.text


def test_rebuild_preserves_other_collections_and_failure_preserves_index(ingest_settings):
    asyncio.run(ingest(ingest_settings))
    chroma = open_chroma(ingest_settings)
    other = chroma.create_collection("other_collection", embedding_function=None)
    other.add(ids=["keep"], embeddings=[[1.0, 0.0]], documents=["Unrelated collection"])

    class FailingEmbedder:
        async def embed(self, texts):
            raise LLMUnavailable()

    with pytest.raises(LLMUnavailable):
        asyncio.run(ingest(ingest_settings, rebuild=True, llm=FailingEmbedder()))
    assert chroma.get_collection(COLLECTION_NAME).count() == 65
    assert asyncio.run(ingest(ingest_settings, rebuild=True)) == 65
    assert chroma.get_collection("other_collection").get(include=[])["ids"] == ["keep"]


@pytest.mark.parametrize("failure", ["count", "dimensions", "zero"])
def test_invalid_embedding_batches_do_not_create_an_index(tmp_path, failure):
    settings = Settings(_env_file=None, data_dir=tmp_path, embed_batch_size=16)

    class InvalidEmbedder:
        calls = 0

        async def embed(self, texts):
            self.calls += 1
            count = len(texts) - 1 if failure == "count" else len(texts)
            size = self.calls + 1 if failure == "dimensions" else 2
            return EmbeddingBatch(vectors=[[0.0 if failure == "zero" else 1.0] * size for _ in range(count)])

    with pytest.raises(ValueError):
        asyncio.run(ingest(settings, rebuild=True, llm=InvalidEmbedder()))
    assert not (tmp_path / "chroma").exists()


def test_model_change_requires_rebuild(ingest_settings):
    asyncio.run(ingest(ingest_settings))
    ingest_settings.model_embed = "different-offline-model"
    with pytest.raises(ValueError, match="--rebuild"):
        asyncio.run(ingest(ingest_settings))
    assert open_chroma(ingest_settings).get_collection(COLLECTION_NAME).count() == 65
    assert asyncio.run(ingest(ingest_settings, rebuild=True)) == 65


@pytest.mark.parametrize("case", ["duplicate_step", "bad_phase", "missing_header", "duplicate_cve", "unknown_playbook", "bad_cvss"])
def test_invalid_sources_fail_before_embedding(knowledge_base, tmp_path, case):
    if case in {"duplicate_step", "bad_phase", "missing_header"}:
        path = knowledge_base / "playbooks/PB-RAN.md"
        old, new = {
            "duplicate_step": ("PB-RAN-02 |", "PB-RAN-01 |"),
            "bad_phase": (" | Contain |", " | Invent |"),
            "missing_header": ("severity_default: critical", "severity: critical"),
        }[case]
        path.write_text(path.read_text().replace(old, new))
    else:
        path = knowledge_base / "cves/cves.json"
        entries = json.loads(path.read_text())
        if case == "duplicate_cve":
            entries.append(entries[0])
        elif case == "unknown_playbook":
            entries[0]["related_playbooks"] = ["PB-MISSING"]
        else:
            entries[0]["cvss"] = 11.0
        path.write_text(json.dumps(entries))

    class ForbiddenEmbedder:
        async def embed(self, texts):
            pytest.fail("Invalid sources must fail before any model call")

    with pytest.raises(ValueError):
        asyncio.run(ingest(Settings(_env_file=None, data_dir=tmp_path), source_dir=knowledge_base, llm=ForbiddenEmbedder()))


def test_embed_batch_size_is_environment_configured(monkeypatch):
    monkeypatch.setenv("EMBED_BATCH_SIZE", "7")
    assert Settings(_env_file=None).embed_batch_size == 7
    monkeypatch.setenv("EMBED_BATCH_SIZE", "0")
    with pytest.raises(ValidationError):
        Settings(_env_file=None)
