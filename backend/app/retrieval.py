"""Hybrid step retrieval with absolute scores and cross-playbook margins."""
import math
import re
from collections import Counter

from .config import Settings
from .ingest import COLLECTION_NAME, open_chroma
from .llm import LLMClient, LLMUnavailable
from .schemas import EmbeddingBatch, ParsedAlert, RetrievedChunk, RetrievalResult

STOPWORDS = set('a an the of to in on for from with and or is are was were this that as by at it'.split())

def tokens(text):
    return [w for w in re.findall(r'[a-z0-9]+', text.lower()) if w not in STOPWORDS]

def bm25_scores(query, documents, settings):
    corpus = [Counter(tokens(d)) for d in documents]
    lengths = [sum(d.values()) for d in corpus]
    average = sum(lengths) / max(1, len(lengths)) or 1
    scores = [0.0] * len(documents)
    for word in set(tokens(query)):
        frequency = sum(word in d for d in corpus)
        idf = math.log(1 + (len(corpus) - frequency + 0.5) / (frequency + 0.5))
        for i, document in enumerate(corpus):
            count = document[word]
            denominator = count + settings.bm25_k1 * (1 - settings.bm25_b + settings.bm25_b * lengths[i] / average)
            if count:
                scores[i] += idf * count * (settings.bm25_k1 + 1) / denominator
    # Absolute saturation does not promote an irrelevant query's best hit to 1.
    return [s / (s + settings.bm25_score_scale) for s in scores]

class Retriever:
    def __init__(self, settings: Settings, llm: LLMClient):
        self.settings, self.llm = settings, llm

    async def search(self, query: str, *, attack_type='unknown', k=None) -> RetrievalResult:
        settings = self.settings
        k = settings.retrieval_top_k if k is None else k
        if k < 1:
            raise ValueError('k must be positive')
        empty = RetrievalResult(chunks=[], retrieval_confidence=0.0, margin=0.0, meets_thresholds=False)
        if not query.strip():
            return empty
        from chromadb.errors import NotFoundError
        try:
            collection = open_chroma(settings).get_collection(COLLECTION_NAME, embedding_function=None)
        except NotFoundError:
            raise LLMUnavailable('Knowledge-base index is missing; run ingestion.') from None
        if (collection.metadata or {}).get('embedding_model') != settings.model_embed:
            raise LLMUnavailable('Index embedding model differs from configuration; rebuild the index.')
        rows = collection.get(where={'kind': 'playbook'}, include=['documents', 'metadatas'])
        if not rows['ids']:
            return empty
        vector = EmbeddingBatch.model_validate(await self.llm.embed([query])).vectors
        if len(vector) != 1 or len(vector[0]) != (collection.metadata or {}).get('embedding_dimensions'):
            raise LLMUnavailable('Query embedding dimensions do not match the index.')
        result = collection.query(query_embeddings=vector, where={'kind': 'playbook'}, n_results=len(rows['ids']), include=['distances'])
        semantic = {identifier: max(0.0, min(1.0, (1 - float(distance) - settings.semantic_similarity_floor) / (1 - settings.semantic_similarity_floor)))
                    for identifier, distance in zip(result['ids'][0], result['distances'][0])}
        keywords = bm25_scores(query, rows['documents'], settings)
        ranked = []
        for identifier, text, metadata, keyword in zip(rows['ids'], rows['documents'], rows['metadatas'], keywords):
            sem = semantic.get(identifier, 0.0)
            ranked.append(RetrievedChunk(
                playbook_id=metadata['playbook_id'], step_id=identifier, text=text, metadata=metadata,
                semantic_score=sem, keyword_score=keyword,
                score=settings.hybrid_weight_semantic * sem + (1 - settings.hybrid_weight_semantic) * keyword))
        ranked.sort(key=lambda c: (-c.score, c.step_id))
        # Score competing playbooks before filtering output so margin stays meaningful.
        eligible = [c for c in ranked if attack_type == 'unknown' or c.metadata['attack_type'] == attack_type]
        if not eligible:
            return empty
        top = eligible[0]
        competitor = max((c.score for c in ranked if c.playbook_id != top.playbook_id), default=0.0)
        margin = max(0.0, top.score - competitor)
        return RetrievalResult(chunks=eligible[:k], retrieval_confidence=top.score, margin=margin,
            meets_thresholds=(attack_type != 'unknown' and top.score >= settings.retrieval_min_score and margin >= settings.retrieval_min_margin))

    async def retrieve(self, parsed: ParsedAlert) -> RetrievalResult:
        kinds = [name for name, values in parsed.iocs.model_dump().items() if values]
        query = ' '.join([parsed.attack_type.replace('_', ' ') if parsed.attack_type != 'unknown' else '', parsed.summary, ' '.join(kinds)])
        return await self.search(query, attack_type=parsed.attack_type)
