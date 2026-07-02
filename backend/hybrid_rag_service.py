"""Hybrid RAG — BM25 + vector similarity + CrossEncoder rerank (Tier 2)."""

import time
import re
from typing import Optional
from rank_bm25 import BM25Okapi
from sentence_transformers import SentenceTransformer, CrossEncoder
import numpy as np

# ---------------------------------------------------------------------------
# Module state — initialized once at startup
# ---------------------------------------------------------------------------

_embed_model: Optional[SentenceTransformer] = None
_rerank_model: Optional[CrossEncoder] = None

# BM25 index — rebuilt from scratch on startup and updated on each new incident
_bm25: Optional[BM25Okapi] = None
_bm25_docs: list[str] = []       # raw text for each doc
_bm25_ids: list[str] = []        # incident_id per doc
_bm25_tokenized: list[list[str]] = []

# Vector store — numpy arrays for cosine similarity
_vectors: list[np.ndarray] = []   # one embedding per doc
_doc_ids: list[str] = []          # incident_id per vector
_doc_texts: list[str] = []        # raw text per vector

# Hybrid weights
VECTOR_WEIGHT = 0.6
BM25_WEIGHT   = 0.4
CANDIDATE_K   = 20   # retrieve this many candidates before reranking
FINAL_K       = 5    # return this many after reranking


def _tokenize(text: str) -> list[str]:
    """Simple whitespace + punctuation tokenizer for BM25."""
    return re.findall(r'\w+', text.lower())


def initialize(embed_model: SentenceTransformer):
    global _embed_model
    _embed_model = embed_model
    print("[hybrid-rag] Initialized (CrossEncoder will load on first compare call)")


def _ensure_reranker():
    global _rerank_model
    if _rerank_model is None:
        print("[hybrid-rag] Lazy-loading cross-encoder reranker: cross-encoder/ms-marco-MiniLM-L-6-v2")
        _rerank_model = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2", max_length=512)
        print("[hybrid-rag] Reranker ready")


def _rebuild_bm25():
    global _bm25
    if _bm25_tokenized:
        _bm25 = BM25Okapi(_bm25_tokenized)
    else:
        _bm25 = None


def remember(text: str, incident_id: str):
    global _bm25

    # BM25
    tokens = _tokenize(text)
    _bm25_docs.append(text)
    _bm25_ids.append(incident_id)
    _bm25_tokenized.append(tokens)
    _rebuild_bm25()

    # Vector
    if _embed_model is None:
        raise RuntimeError("hybrid_rag not initialized — call initialize() first")
    vec = _embed_model.encode(text, normalize_embeddings=True)
    _vectors.append(vec)
    _doc_ids.append(incident_id)
    _doc_texts.append(text)


def recall_chunks(query: str, n: int = FINAL_K) -> tuple[list[str], float]:
    if not _doc_texts:
        return [], 0

    start = time.time()

    # --- Vector scores ---
    q_vec = _embed_model.encode(query, normalize_embeddings=True)
    vec_scores = np.array([float(np.dot(q_vec, v)) for v in _vectors])  # cosine sim

    # --- BM25 scores ---
    q_tokens = _tokenize(query)
    if _bm25 is not None:
        bm25_raw = np.array(_bm25.get_scores(q_tokens))
        # Normalise BM25 to [0, 1]
        bm25_max = bm25_raw.max()
        bm25_scores = bm25_raw / bm25_max if bm25_max > 0 else bm25_raw
    else:
        bm25_scores = np.zeros(len(_doc_texts))

    # --- Hybrid score ---
    hybrid_scores = VECTOR_WEIGHT * vec_scores + BM25_WEIGHT * bm25_scores

    # Top CANDIDATE_K candidates
    k = min(CANDIDATE_K, len(_doc_texts))
    top_indices = np.argsort(hybrid_scores)[::-1][:k]
    candidates = [_doc_texts[i] for i in top_indices]

    # --- Cross-encoder rerank (lazy-loaded to save startup RAM) ---
    _ensure_reranker()
    if _rerank_model is not None and len(candidates) > 1:
        pairs = [[query, c] for c in candidates]
        rerank_scores = _rerank_model.predict(pairs)
        ranked = sorted(zip(rerank_scores, candidates), reverse=True)
        final = [c for _, c in ranked[:n]]
    else:
        final = candidates[:n]

    elapsed_ms = int((time.time() - start) * 1000)
    return final, elapsed_ms


def delete(incident_id: str):
    global _bm25

    indices = [i for i, iid in enumerate(_bm25_ids) if iid == incident_id]
    for i in sorted(indices, reverse=True):
        _bm25_docs.pop(i)
        _bm25_ids.pop(i)
        _bm25_tokenized.pop(i)

    v_indices = [i for i, iid in enumerate(_doc_ids) if iid == incident_id]
    for i in sorted(v_indices, reverse=True):
        _vectors.pop(i)
        _doc_ids.pop(i)
        _doc_texts.pop(i)

    _rebuild_bm25()


def count() -> int:
    return len(_doc_texts)
