"""
Lab 4 FastAPI API.

@author: Sebastian Silva & Aarti Dashore
Seattle University, ARIN 5360
@see: https://catalog.seattleu.edu/preview_course_nopop.php?catoid=55&coid=190380
@version: 2.0.0+w26
"""

import logging
import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from starlette.staticfiles import StaticFiles

from retrieval.llm import LLMClient
from retrieval.rag import RAGSystem
from retrieval.retriever import DocumentRetriever

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global instances
retriever = None
rag_system = None


class HealthResponse(BaseModel):
    """Response model for health check."""

    status: str
    documents_indexed: int
    message: str
    rag_available: bool


class SearchRequest(BaseModel):
    """Request model for search."""

    query: str
    n_results: int = 5
    use_hybrid: bool = True
    use_reranking: bool = True


class SearchResponse(BaseModel):
    """Response model for search."""

    query: str
    results: list[dict]
    count: int


class RAGRequest(BaseModel):
    """Request model for RAG query."""

    question: str
    n_context_docs: int = 3
    temperature: float = 0.7
    system_prompt: Optional[str] = None  # Q11: custom system prompt


class RAGResponse(BaseModel):
    """Response model for RAG query."""

    question: str
    answer: str
    context: list[dict]
    context_count: int
    full_prompt: str  # Q12: full prompt preview support


def build_full_prompt(system_prompt: str, question: str, sources: list[dict]) -> str:
    """
    Build the exact prompt string the backend intends to send to the LLM.
    This keeps prompt-preview formatting consistent with server behavior.
    """
    context_blocks = []
    for i, src in enumerate(sources, start=1):
        # Be resilient to different source shapes
        meta = src.get("metadata") or {}
        source_name = meta.get("source") or src.get("id") or f"Doc {i}"
        text = src.get("text") or ""
        context_blocks.append(f"--- [{i}] {source_name} ---\n{text}")

    context_str = "\n\n".join(context_blocks) if context_blocks else "(no context retrieved)"

    return (
        "SYSTEM:\n"
        f"{system_prompt}\n\n"
        "CONTEXT DOCUMENTS:\n"
        f"{context_str}\n\n"
        "USER QUESTION:\n"
        f"{question}"
    )


# Define lifespan function to load models on startup
@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        logger.info("Loading models...")

        global retriever, rag_system
        retriever = DocumentRetriever()
        docs_dir = "tests/data" if "PYTEST_CURRENT_TEST" in os.environ else "documents"
        num_docs = retriever.index_documents(docs_dir)
        logger.info(f"Indexed {num_docs} chunks successfully!")

        llm_client = LLMClient(model="qwen2.5:3b", timeout=120.0)
        rag_system = RAGSystem(retriever=retriever, llm_client=llm_client)
        logger.info("RAG system initialized.")

    except Exception as e:
        logger.error(f"Failed to load model: {str(e)}")

    yield

    logger.info("Application shutting down (lifespan)...")


app = FastAPI(
    title="Lab 5 Document Retrieval API",
    description="Semantic + Hybrid Search with optional reranking; RAG endpoint with system prompt support.",
    version="2.0.0+w26",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/search", response_model=SearchResponse)
async def search(request: SearchRequest):
    """Search for documents relevant to the query."""
    if retriever is None:
        raise HTTPException(status_code=503, detail="Retriever not initialized")

    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    if request.n_results < 1 or request.n_results > 20:
        raise HTTPException(status_code=400, detail="n_results must be between 1 and 20")

    try:
        results = retriever.search(
            request.query,
            request.n_results,
            use_hybrid=request.use_hybrid,
            use_reranking=request.use_reranking,
        )

        return SearchResponse(query=request.query, results=results, count=len(results))
    except Exception as e:
        logger.error(f"Search error: {str(e)}")
        raise HTTPException(status_code=500, detail="Search failed")


@app.post("/rag", response_model=RAGResponse)
async def rag_query(request: RAGRequest):
    """Answer a question using Retrieval-Augmented Generation."""
    if rag_system is None:
        raise HTTPException(status_code=503, detail="RAG system not initialized")

    if not request.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    if request.n_context_docs < 1 or request.n_context_docs > 10:
        raise HTTPException(status_code=400, detail="n_context_docs must be between 1 and 10")

    if not (0.0 <= request.temperature <= 1.0):
        raise HTTPException(status_code=400, detail="temperature must be between 0.0 and 1.0")

    try:
        result = rag_system.query(
            question=request.question,
            n_results=request.n_context_docs,
            temperature=request.temperature,
            system_prompt=request.system_prompt,
        )

        # result["sources"] is what you show/cite in UI, and what we use to build full prompt
        sources = result.get("sources", [])
        system_prompt_used = (
            request.system_prompt or ""
        )  # optional; depends on your rag_system defaulting
        full_prompt = build_full_prompt(system_prompt_used, request.question, sources)

        return RAGResponse(
            question=result["question"],
            answer=result["answer"],
            context=sources,
            context_count=result["n_docs_retrieved"],
            full_prompt=full_prompt,
        )

    except RuntimeError as e:
        logger.error(f"LLM error during RAG query: {str(e)}")
        raise HTTPException(status_code=502, detail=f"LLM error: {str(e)}")
    except Exception as e:
        logger.error(f"RAG query error: {str(e)}")
        raise HTTPException(status_code=500, detail="RAG query failed")


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Check if the API is running."""
    if retriever is None:
        return HealthResponse(
            status="unhealthy",
            message="Retriever not initialized",
            documents_indexed=0,
            rag_available=False,
        )

    # rag_available should reflect the RAG system actually being initialized
    return HealthResponse(
        status="healthy",
        message="API is running and ready",
        documents_indexed=retriever.document_count,
        rag_available=(rag_system is not None and retriever.document_count > 0),
    )


@app.exception_handler(Exception)
async def general_exception_handler(_request, exc):
    """Handle unexpected exceptions."""
    logger.error(f"Unexpected error: {str(exc)}")
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/test/error")
async def test_error():
    raise RuntimeError("Something went wrong")


app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    print("To run this application:")
    print("uv run uvicorn src.retrieval.main:app --reload")
    print("\nThen open: http://localhost:8000")
