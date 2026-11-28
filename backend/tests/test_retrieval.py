import asyncio
import hashlib
import json
import re
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.config import ROOT, Settings
from backend.app.cve import LOOKUP_CVE_TOOL, execute_cve_tool, lookup_cve
from backend.app.ingest import ingest
from backend.app.main import create_app
from backend.app.retrieval import Retriever, bm25_scores
from backend.app.schemas import EmbeddingBatch

class OfflineEmbedder:
    async def embed(self, texts):
        vectors = []
        for text in texts:
            vector = [0.0] * 2048
            for token in re.findall('[a-z]+', text.lower()):
                i = int.from_bytes(hashlib.sha256(token.encode()).digest()[:4], 'big') % len(vector)
                vector[i] += 1
            vectors.append(vector)
        return EmbeddingBatch(vectors=vectors)

@pytest.fixture
def retriever(tmp_path):
    settings = Settings(_env_file=None, mock=False, data_dir=tmp_path, model_embed='offline')
    llm = OfflineEmbedder()
    asyncio.run(ingest(settings, llm=llm))
    return Retriever(settings, llm)

@pytest.mark.parametrize('name,book', [('phishing','PB-PHI'), ('ransomware','PB-RAN'), ('credential_stuffing','PB-CRD'), ('public_s3_bucket','PB-S3')])
def test_clean_samples(retriever, catalog, name, book):
    raw = json.loads((ROOT / 'data/alerts' / f'{name}.json').read_text())
    parsed = catalog.runs[raw['alert_id']].parsed.model_copy(deep=True)
    parsed.summary = json.dumps(raw)
    result = asyncio.run(retriever.retrieve(parsed))
    assert len(result.chunks) == retriever.settings.retrieval_top_k
    assert all(c.playbook_id == book for c in result.chunks)
    assert result.retrieval_confidence == result.chunks[0].score
    assert all(0 <= c.score <= 1 for c in result.chunks)

def test_no_match_unknown_and_empty(retriever, catalog):
    parsed = catalog.runs['ALR-NOMATCH'].parsed
    result = asyncio.run(retriever.retrieve(parsed))
    assert result.retrieval_confidence < retriever.settings.retrieval_min_score
    assert not result.meets_thresholds
    assert asyncio.run(retriever.search('')).chunks == []
    result = asyncio.run(retriever.search('isolate infected host', k=3))
    assert 'PB-RAN-02' in [c.step_id for c in result.chunks]
    with pytest.raises(ValueError):
        asyncio.run(retriever.search('host', k=0))

def test_weights_thresholds_and_margin_use_other_playbooks(retriever):
    retriever.settings.hybrid_weight_semantic = 0
    result = asyncio.run(retriever.search('isolate affected host network EDR', attack_type='ransomware'))
    assert all(c.score == c.keyword_score for c in result.chunks)
    all_results = asyncio.run(retriever.search('isolate affected host network EDR', k=50))
    other = max(c.score for c in all_results.chunks if c.playbook_id != 'PB-RAN')
    assert result.margin == pytest.approx(max(0, result.retrieval_confidence - other))
    retriever.settings.retrieval_min_score = 1
    assert not asyncio.run(retriever.search('isolate host', attack_type='ransomware')).meets_thresholds
    retriever.settings.hybrid_weight_semantic = 1
    assert all(c.score == c.semantic_score for c in asyncio.run(retriever.search('host')).chunks)

def test_bm25_does_not_normalize_best_to_one():
    settings = Settings(_env_file=None)
    assert bm25_scores('unrelated', ['isolate host', 'review message'], settings) == [0, 0]
    scores = bm25_scores('host', ['isolate host', 'review message'], settings)
    assert 0 < scores[0] < 1 and scores[1] == 0

def test_cve_tool():
    result = lookup_cve('CVE-2099-900004')
    assert result['remediation'] and result['related_playbooks'] == ['PB-RAN']
    assert lookup_cve('CVE-2099-999999') == {'found': False}
    assert execute_cve_tool('lookup_cve', '{"id":"CVE-2099-900004"}') == result
    assert LOOKUP_CVE_TOOL['strict'] and LOOKUP_CVE_TOOL['parameters']['additionalProperties'] is False
    with pytest.raises(ValidationError):
        execute_cve_tool('lookup_cve', '{"id":"x","path":"/tmp"}')
    with pytest.raises(ValueError):
        execute_cve_tool('other', '{}')

def test_live_manual_search(retriever):
    app = create_app(retriever.settings)
    with TestClient(app) as client:
        app.state.llm.embed = retriever.llm.embed
        response = client.get('/api/search', params={'q':'isolate infected host','k':3})
        assert response.status_code == 200
        assert len(response.json()) == 3
        assert 'PB-RAN-02' in [c['step_id'] for c in response.json()]
        assert set(response.json()[0]) == {'playbook_id','step_id','text','score'}
