"""Environment-only application configuration; credentials are always redacted."""

from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ROOT / ".env", env_file_encoding="utf-8", extra="ignore",
        hide_input_in_errors=True,
    )

    llm_key: SecretStr | None = None
    llm_base_url: str = "https://genailab.tcs.in/"
    tls_verify: bool = False
    model_main: str = "genailab-maas-gpt-5.4"
    model_fast: str = "genailab-maas-gpt-5.4-mini"
    model_fallback: str = "azure/genailab-maas-gpt-4.1"
    model_embed: str = "azure/genailab-maas-text-embedding-3-large"
    embed_batch_size: int = Field(default=32, ge=1, le=2048)
    mock: bool = False
    retrieval_top_k: int = Field(default=6, ge=1)
    retrieval_min_score: float = Field(default=0.35, ge=0, le=1)
    retrieval_min_margin: float = Field(default=0.03, ge=0, le=1)
    hybrid_weight_semantic: float = Field(default=0.7, ge=0, le=1)
    bm25_k1: float = Field(default=1.5, gt=0)
    bm25_b: float = Field(default=0.75, ge=0, le=1)
    bm25_score_scale: float = Field(default=8.0, gt=0)
    semantic_similarity_floor: float = Field(default=0.3, ge=0, lt=1)
    parse_min_confidence: float = Field(default=0.5, ge=0, le=1)
    parse_cache_size: int = Field(default=128, ge=0, le=4096)
    min_verified_steps: int = Field(default=3, ge=1)
    redact_ips: bool = False
    max_request_bytes: int = Field(default=204800, ge=1)
    data_dir: Path = ROOT / "data"

