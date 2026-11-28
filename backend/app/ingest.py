"""Parse, embed, and persist the knowledge base. From backend/: python -m app.ingest --rebuild."""

import argparse
import asyncio
import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from pydantic import TypeAdapter

from .config import ROOT, Settings
from .schemas import AttackType, CVERecord, Citation, EmbeddingBatch, Severity

if TYPE_CHECKING:
    from .llm import LLMClient

logger = logging.getLogger(__name__)
COLLECTION_NAME = "soc_chunks"

STEP_LINE = re.compile(
    r"^(PB-[A-Z0-9]+-\d{2}) \| (Detect|Investigate|Contain|Eradicate|Recover|Escalate) \| (.+) \| (.+)$"
)


@dataclass(frozen=True)
class Chunk:
    id: str
    text: str
    metadata: dict[str, str | float]


def _one_header(text: str, pattern: str, label: str, path: Path) -> str:
    values = re.findall(pattern, text, re.MULTILINE)
    if len(values) != 1:
        raise ValueError(f"{path.name}: expected exactly one {label}")
    return values[0]


def load_playbook_chunks(directory: Path) -> list[Chunk]:
    paths = sorted(directory.glob("*.md"))
    if not paths:
        raise ValueError("No playbooks found in the source directory")
    chunks, book_ids, step_ids = [], set(), set()
    for path in paths:
        text = path.read_text(encoding="utf-8")
        header = text.split("## ", 1)[0]
        book_id = _one_header(header, r"^# (PB-[A-Z0-9]+) .+$", "playbook title", path)
        if book_id in book_ids:
            raise ValueError(f"Duplicate playbook ID: {book_id}")
        book_ids.add(book_id)
        attack_type = TypeAdapter(AttackType).validate_python(
            _one_header(header, r"^attack_type: (\S+)$", "attack_type", path)
        )
        severity = TypeAdapter(Severity).validate_python(
            _one_header(header, r"^severity_default: (\S+)$", "severity_default", path)
        )
        in_steps, step_sections, count = False, 0, 0
        for line in text.splitlines():
            if line.startswith("## "):
                in_steps = line == "## Steps"
                step_sections += int(in_steps)
                continue
            if not in_steps or not line.strip():
                continue
            match = STEP_LINE.fullmatch(line)
            if match is None or line.count("|") != 3 or not match[3].strip() or not match[4].strip():
                raise ValueError(f"{path.name}: invalid step line")
            step_id, phase, _, owner_role = match.groups()
            if step_id in step_ids:
                raise ValueError(f"Duplicate playbook step: {step_id}")
            if step_id.rsplit("-", 1)[0] != book_id or step_id.endswith("-00"):
                raise ValueError(f"{path.name}: invalid step ID {step_id}")
            step_ids.add(step_id)
            count += 1
            chunks.append(Chunk(step_id, line, {
                "kind": "playbook", "playbook_id": book_id, "step_id": step_id,
                "phase": phase, "owner_role": owner_role, "severity": severity,
                "attack_type": attack_type, "source_file": f"playbooks/{path.name}",
            }))
        if step_sections != 1 or count == 0:
            raise ValueError(f"{path.name}: expected one nonempty Steps section")
    return chunks


def load_citations(directory: Path) -> dict[str, Citation]:
    return {
        chunk.id: Citation(
            playbook_id=chunk.metadata["playbook_id"], step_id=chunk.id, source_text=chunk.text,
        )
        for chunk in load_playbook_chunks(directory)
    }


def _unique_json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON object property in CVE data")
        result[key] = value
    return result


def load_chunks(data_dir: Path = ROOT / "data") -> list[Chunk]:
    chunks = load_playbook_chunks(data_dir / "playbooks")
    playbooks = {chunk.metadata["playbook_id"] for chunk in chunks}
    entries = json.loads(
        (data_dir / "cves" / "cves.json").read_text(encoding="utf-8"),
        object_pairs_hook=_unique_json_object,
    )
    if not isinstance(entries, list):
        raise ValueError("CVE data must be a JSON array")
    records = [CVERecord.model_validate(entry) for entry in entries]
    for record in sorted(records, key=lambda item: item.id):
        if not set(record.related_playbooks) <= playbooks:
            raise ValueError(f"{record.id}: unknown related playbook")
        chunks.append(Chunk(
            record.id, json.dumps(record.model_dump(), sort_keys=True, ensure_ascii=False),
            {
                "kind": "cve", "cve_id": record.id, "severity": record.severity,
                "cvss": record.cvss, "affected_product": record.affected_product,
                # Scalars work across supported Chroma releases; decode this field as JSON.
                "related_playbooks": json.dumps(record.related_playbooks),
                "source_file": "cves/cves.json",
            },
        ))
    if len({chunk.id for chunk in chunks}) != len(chunks):
        raise ValueError("Duplicate knowledge-base chunk ID")
    return chunks


def open_chroma(settings: Settings):
    # Lazy import keeps the mock API usable without the optional vectors dependency.
    try:
        import chromadb
        from chromadb.config import Settings as ChromaSettings
    except ImportError:
        raise RuntimeError("Install the vectors extra: python -m pip install -e '.[vectors]'") from None
    return chromadb.PersistentClient(
        path=str(settings.data_dir / "chroma"), settings=ChromaSettings(anonymized_telemetry=False),
    )


async def ingest(
    settings: Settings | None = None, *, rebuild: bool = False,
    source_dir: Path = ROOT / "data", llm: "LLMClient | None" = None,
) -> int:
    """Synchronize soc_chunks; --rebuild replaces only that collection.

    Embedding/validation failures precede mutations. Chroma writes are not an atomic
    multi-batch transaction; run one ingestion writer at a time.
    """
    from .llm import LLMClient

    settings = settings or Settings()
    chunks = load_chunks(source_dir)
    steps = sum(chunk.metadata["kind"] == "playbook" for chunk in chunks)
    logger.info("Loaded %d playbook steps and %d CVEs (%d chunks)", steps, len(chunks) - steps, len(chunks))
    client = llm if llm is not None else LLMClient(settings)
    vectors = []
    try:
        for start in range(0, len(chunks), settings.embed_batch_size):
            batch = chunks[start:start + settings.embed_batch_size]
            output = EmbeddingBatch.model_validate(await client.embed([chunk.text for chunk in batch]))
            if len(output.vectors) != len(batch):
                raise ValueError("Embedding batch count does not match the chunk count")
            vectors.extend(output.vectors)
            logger.info("Embedded %d/%d chunks", len(vectors), len(chunks))
        # Also catches dimension changes between otherwise individually valid batches.
        EmbeddingBatch(vectors=vectors)
        if any(not any(vector) for vector in vectors):
            raise ValueError("Zero vectors cannot be indexed with cosine distance")
    finally:
        if llm is None:
            await client.close()

    chroma = open_chroma(settings)
    from chromadb.errors import NotFoundError

    try:
        collection = chroma.get_collection(COLLECTION_NAME, embedding_function=None)
    except NotFoundError:
        collection = None
    expected_metadata = {
        "embedding_model": settings.model_embed, "embedding_dimensions": len(vectors[0]),
    }
    if collection is not None:
        if rebuild:
            chroma.delete_collection(COLLECTION_NAME)
            collection = None
        elif any((collection.metadata or {}).get(key) != value for key, value in expected_metadata.items()):
            raise ValueError("Embedding model or dimensions changed; run ingestion with --rebuild")
    if collection is None:
        collection = chroma.create_collection(
            COLLECTION_NAME, embedding_function=None, metadata=expected_metadata,
            configuration={"hnsw": {"space": "cosine"}},
        )
    # Respect both the configured embedding batch and Chroma's mutation limit.
    write_batch_size = min(settings.embed_batch_size, chroma.get_max_batch_size())
    for start in range(0, len(chunks), write_batch_size):
        batch = chunks[start:start + write_batch_size]
        collection.upsert(
            ids=[chunk.id for chunk in batch], documents=[chunk.text for chunk in batch],
            metadatas=[chunk.metadata for chunk in batch], embeddings=vectors[start:start + len(batch)],
        )
    expected_ids = {chunk.id for chunk in chunks}
    stale_ids = sorted(set(collection.get(include=[])["ids"]) - expected_ids)
    for start in range(0, len(stale_ids), write_batch_size):
        collection.delete(ids=stale_ids[start:start + write_batch_size])
    count = collection.count()
    if count != len(chunks):
        raise RuntimeError("Persisted chunk count does not match the source; check for concurrent ingestion")
    logger.info("Indexed %d chunks in %s (%d steps, %d CVEs; removed %d stale chunks)",
                count, COLLECTION_NAME, steps, count - steps, len(stale_ids))
    return count


def main(argv: list[str] | None = None) -> int:
    from .llm import LLMUnavailable

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rebuild", action="store_true", help="Replace soc_chunks after all embeddings validate")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        asyncio.run(ingest(rebuild=args.rebuild))
    except LLMUnavailable as exc:
        logger.error("Ingestion failed: %s", exc)
        return 1
    except (ValueError, OSError, RuntimeError) as exc:
        # No upstream response bodies, documents, or credentials in CLI diagnostics.
        logger.error("Ingestion failed (%s). Check source data, vectors dependency and index compatibility.", type(exc).__name__)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

