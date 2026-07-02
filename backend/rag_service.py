"""Plain RAG baseline — ChromaDB vector similarity (Tier 1)."""

import os
import time
import uuid
from sentence_transformers import SentenceTransformer
import chromadb
from openai import OpenAI

_model: SentenceTransformer | None = None
_client = None   # chromadb.ClientAPI — avoid type hint, chromadb.Client is a factory
_collection = None
_groq: OpenAI | None = None


def _get_groq() -> OpenAI:
    global _groq
    if _groq is None:
        _groq = OpenAI(
            api_key=os.environ["GROQ_API_KEY"],
            base_url="https://api.groq.com/openai/v1",
        )
    return _groq

RAG_MODEL_NAME = os.environ.get("RAG_EMBEDDING_MODEL", "all-MiniLM-L6-v2")
SYNTHESIS_MODEL = os.environ.get("SYNTHESIS_LLM_MODEL", "llama-3.3-70b-versatile")

RAG_SYNTHESIS_PROMPT = """You are a DevOps assistant. Below are text chunks retrieved from past incident reports using semantic similarity search.

Current symptom: {symptom}

Retrieved chunks:
{chunks}

Based on these chunks, suggest steps to resolve the current symptom.
Be concise. Note that these are raw text fragments — they may not be in order and may not be directly relevant."""


def initialize():
    """Load sentence-transformers model and ChromaDB. Called once at startup."""
    global _model, _client, _collection

    print(f"[rag] Loading embedding model: {RAG_MODEL_NAME}")
    _model = SentenceTransformer(RAG_MODEL_NAME)
    print("[rag] Embedding model ready")

    _client = chromadb.Client()  # in-memory, resets on restart
    _collection = _client.get_or_create_collection(
        name="incidents",
        metadata={"hnsw:space": "cosine"},
    )


def remember(text: str, incident_id: str):
    """Embed and store incident text in ChromaDB."""
    if _model is None or _collection is None:
        raise RuntimeError("RAG not initialized — call initialize() first")

    embedding = _model.encode(text, normalize_embeddings=True).tolist()
    _collection.add(
        embeddings=[embedding],
        documents=[text],
        ids=[incident_id],
    )


def recall_chunks(query: str, n: int = 5) -> tuple[list[str], float]:
    """
    Retrieve top-n most similar chunks for a query.
    Returns (chunks, response_time_ms).
    """
    if _model is None or _collection is None:
        raise RuntimeError("RAG not initialized — call initialize() first")

    start = time.time()
    query_embedding = _model.encode(query, normalize_embeddings=True).tolist()

    count = _collection.count()
    if count == 0:
        return [], int((time.time() - start) * 1000)

    results = _collection.query(
        query_embeddings=[query_embedding],
        n_results=min(n, count),
        include=["documents", "distances"],
    )

    chunks = results["documents"][0] if results["documents"] else []
    elapsed_ms = int((time.time() - start) * 1000)
    return chunks, elapsed_ms


def synthesize_from_chunks(symptom: str, chunks: list[str]) -> str:
    """
    Use Groq Llama (same model as Cognee synthesis tier) to generate a response from raw chunks.
    This is the fair comparison — same LLM, different retrieval.
    """
    if not chunks:
        return "No relevant past incidents found in RAG index."

    chunks_text = "\n\n".join(
        f"[Chunk {i+1}]: {c[:300]}" for i, c in enumerate(chunks)
    )

    message = _get_groq().chat.completions.create(
        model=SYNTHESIS_MODEL,
        max_tokens=800,
        messages=[{
            "role": "user",
            "content": RAG_SYNTHESIS_PROMPT.format(symptom=symptom, chunks=chunks_text),
        }],
    )

    return message.choices[0].message.content.strip()


def delete(incident_id: str):
    """Remove an incident from ChromaDB."""
    if _collection is None:
        return
    try:
        _collection.delete(ids=[incident_id])
    except Exception:
        pass


def count() -> int:
    """Return number of incidents in the RAG index."""
    if _collection is None:
        return 0
    return _collection.count()
