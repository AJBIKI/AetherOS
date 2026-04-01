# AetherOS Retrieval Pipeline – Full Technical Document

## Overview

AetherOS is a local‑first, second‑brain RAG system that retrieves and synthesizes information from markdown notes. The pipeline is built for **high relevance, low latency, and hardware efficiency** (RTX 2050). This document describes every component of the retrieval flow, from file ingestion to final answer verification.

---

## 1. Ingestion Phase

### 1.1 Hierarchical Chunking (`getHierarchicalChunks`)

- **Input**: Raw markdown file content + file path.
- **Output**: Array of `HierarchicalChunk` objects with `chunkLevel: 'section' | 'paragraph'`.

**Process**:
- Parse markdown with `unified` + `remark-parse` + `remark-gfm`.
- Use `visit` to collect **all headings** (deep traversal).
- Collect **content nodes** (paragraphs, code, lists, blockquotes, tables) **only from root children** to preserve structure.
- Build a **section tree** based on heading depths and offsets.
- For each section:
  - Create a **section chunk** containing the heading and all direct content (concatenated). Split if exceeds `MAX_CHUNK_SIZE` (3800 chars) with overlap (20%).
  - Create **paragraph chunks** for each content node inside the section. Paragraphs are also split with overlap.
- Each chunk has:
  - `id`: MD5 hash (no hyphens) of `filePath|headingPath|contentPrefix|index`.
  - `headingPath`: array of heading texts (e.g., `["Node.js Streams", "Backpressure"]`).
  - `level`: depth of the nearest heading.
  - `parentId`: for paragraph chunks → ID of the parent section chunk; for section chunks → ID of parent section (or `null`).
  - `chunkLevel`: `'section'` or `'paragraph'`.
  - `content`: text (saved to external file, not stored in Qdrant payload).

### 1.2 External Text Storage (`chunkStorage.ts`)

- All chunk texts are saved as plain files: `data/chunks/<clean-id>.txt`.
- **ID normalization**: Qdrant may return IDs with hyphens (UUID format), but file names use raw MD5 without hyphens. All file operations call `id.replace(/-/g, '')` to ensure consistency.

### 1.3 Qdrant Upsert (`upsertChunk`)

- **Vector storage**:
  - `text-dense`: 768‑dim embedding from `nomic-embed-text` (via Ollama).
  - `text-sparse`: BM25 sparse vector computed by `computeSparseVector`.
- **Payload** (no `text` field):
  - `filePath`, `headingPath`, `chunkLevel`, `level`, `parentId`, `timestamp`, `tags`.
- **External file**: saved before upsert.

### 1.4 Background IDF Maintenance

- Global IDF map (used for sparse vectors) is updated only when new chunk count exceeds threshold (e.g., 100).
- A worker thread (`idfWorker.ts`) fetches all chunk texts from Qdrant, computes new IDF map, and sends it back to main thread.
- Main thread updates global map via `setGlobalIdf`. No blocking during normal operation.

---

## 2. Retrieval Pipeline

The retrieval pipeline is orchestrated by `getHydratedContext` in `retrieval.ts`. It performs the following steps in order.

### 2.1 Query Expansion (`expandQuery`)

- Uses a local LLM (`qwen3:4b`) to generate 3‑5 alternative phrasings of the user’s query.
- Expands recall: user says “MERN”, notes may say “full‑stack JavaScript”.

**Output**: Array of strings, first element is original query.

### 2.2 Hybrid Search (`hybridSearch`)

For **each expanded query**:
- **Dense search**: embed query → search `text-dense` vector (top 100, threshold 0.4).
- **Sparse search**: compute BM25 sparse vector → search `text-sparse` (top 100, threshold 0.1).
- **Reciprocal Rank Fusion (RRF)**: combine dense and sparse results with rank‑based scores (`k=60`).
- Return top `limit` (e.g., 15) candidates with full payload (except `text` – that comes from file).

### 2.3 Deduplication & Merging

- All results from all expanded queries are merged into a `Map` keyed by `id`. Duplicates removed.
- For each unique point, the text is loaded from the external file (with fallback to payload `text` if missing). This lazy‑loads only the candidates that survived.

### 2.4 Reranking (`rerank`)

- Cross‑encoder: `Xenova/ms-marco-MiniLM-L-12-v2`.
- **Batch inference**: Pass all candidates in one GPU call with `batch_size=16`.
- Output: each candidate gets a `rerankScore` (probability of relevance).
- Sorted descending, take top `topK * 2` (e.g., 12) to feed into MMR.

### 2.5 Maximal Marginal Relevance (MMR)

- Goal: balance relevance (to query) and diversity (among selected chunks).
- **Input**: reranked candidates, query embedding (from dense step).
- **Algorithm**:
  - Compute embeddings for all candidates (cached in future).
  - For each iteration, select chunk that maximizes:
    \[
    MMR = \lambda \cdot \text{sim}(chunk, query) - (1-\lambda) \cdot \max_{selected} \text{sim}(chunk, selected)
    \]
  - `λ = 0.7` (more weight on relevance).
- Returns `topK` (e.g., 6) diverse chunks.

### 2.6 Context Hydration (Small‑to‑Big)

- For each selected chunk:
  - If it’s a **paragraph** (`chunkLevel === 'paragraph'`) and has a `parentId`, fetch the parent section chunk from Qdrant (`getChunkById`) and load its full text.
  - This “zooms out” from a specific sentence to the whole section, providing broader context.
  - If the chunk is already a section, keep as is.
- Result: an array of hydrated chunks (may include duplicates if two paragraphs point to same parent).

### 2.7 Deduplication (Final)

- Hydrated chunks are deduplicated by their `text` content (or ID).
- The final context string is built:
  ```
  [Source: filePath → headingPath] (Full Section)
  Content...
  
  ---
  
  [Source: ...]
  ```
- Sources list (for citation) is also returned.

### 2.8 Chain‑of‑Verification (CoVe) – Optional

- After the LLM generates an answer, we run a verification step:
  - Send the original question, the draft answer, and the retrieved context to an LLM with a strict fact‑checking prompt.
  - The model removes or corrects unsupported claims.
- Reduces hallucinations at the cost of extra latency.

---

## 3. Data Flow Diagram (Text)

```
[User Query]
     │
     ▼
Query Expansion (3–5 variants)
     │
     ▼
For each variant → Hybrid Search (Dense + Sparse + RRF)
     │
     ▼
Merge & Deduplicate by ID
     │
     ▼
Load text from external files (fallback to payload)
     │
     ▼
Batch Rerank (Cross‑encoder)
     │
     ▼
MMR Selection (λ=0.7, topK=6)
     │
     ▼
Hydration (fetch parent sections for paragraph chunks)
     │
     ▼
Final Context String + Sources
     │
     ▼
LLM Generation (Ollama)
     │
     ▼
(Optional) CoVe Verification
     │
     ▼
Answer + Citations
```

---

## 4. Key Configuration Parameters

| Parameter | Value | Location |
|-----------|-------|----------|
| `MAX_CHUNK_SIZE` | 3800 chars | `chunker.ts` |
| Overlap | 20% (min 80, max 250) | `chunker.ts` |
| Dense search limit | 100 | `storage.ts` |
| Dense threshold | 0.4 | `storage.ts` |
| Sparse search limit | 100 | `storage.ts` |
| Sparse threshold | 0.1 | `storage.ts` |
| RRF k | 60 | `storage.ts` |
| Rerank batch size | 16 | `reranker.ts` |
| Query expansion variations | 3 | `queryExpansion.ts` |
| MMR λ | 0.7 | `retrieval.ts` |
| MMR topK | 6 | `retrieval.ts` |
| CoVe model | `qwen3:4b` | `cove.ts` |

---

## 5. Performance Notes

- **Latency breakdown** (typical on RTX 2050):
  - Hybrid search (4 variants): ~2–3s
  - Reranking (24 candidates): ~0.5s
  - MMR + hydration: ~1s (dominated by embedding recomputation)
  - Total retrieval: 3–5s (without CoVe)
- **Optimizations**:
  - Cache chunk embeddings (planned).
  - Reduce candidate pool for MMR.
  - Use faster embedding model for MMR (e.g., `all-MiniLM-L6-v2`).

---

## 6. Error Handling & Fallbacks

- **Missing text file**: fallback to payload `text` (if exists) and save to file.
- **Query expansion fails**: use only original query.
- **Reranker fails**: return raw vector search results.
- **CoVe fails**: return original answer.
- **Empty retrieval**: return empty context and answer “no relevant notes found”.

---

## 7. Future Extensions

- **Caching** of embeddings for MMR.
- **Multi‑modal support** (images, diagrams).
- **Adaptive MMR** (adjust λ based on query type).
- **Streaming responses** for long generations.

---

This document provides a complete, LLM‑friendly overview of the AetherOS retrieval pipeline. For implementation details, refer to the actual source files: `chunker.ts`, `storage.ts`, `retrieval.ts`, `reranker.ts`, `queryExpansion.ts`, `mmr.ts`, `cove.ts`, and `sparseVector.ts`.