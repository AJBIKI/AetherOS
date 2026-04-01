# Decoding AetherOS: Advanced RAG Architecture Explained

AetherOS is a local-first Retrieval-Augmented Generation (RAG) system built to function as a "second brain". It implements several advanced concepts beyond standard RAG tutorials to achieve high precision and contextual awareness. This note breaks down the core concepts found in the codebase.

## 1. Hierarchical Context Preservation (AST Chunking)
*File: `src/ingest/getHierarchicalChunks.ts`*

Standard RAG systems often chunk text blindly by character count. This destroys context (e.g., splitting a bulleted list down the middle). AetherOS solves this by parsing Markdown into an Abstract Syntax Tree (AST) using the `remark` ecosystem.

**How it works:**
1. **Heading Traversal**: It walks the AST to find all headings, noting their depth (H1, H2, etc.). It builds a hierarchical tree of "Sections", tracking the exact "Heading Path" (e.g., `["Node.js", "Streams", "Backpressure"]`).
2. **Structural Chunking**: It keeps structural units like Lists, Tables, and Blockquotes intact.
3. **Dual-Tier Chunks**: It creates two types of records:
   - **Section Chunks**: The concatenated content under a heading.
   - **Paragraph Chunks**: Individual blocks of text that carry a `parentId` pointing to the broader section they belong to.

## 2. Hybrid Search & RRF (Reciprocal Rank Fusion)
*File: `src/storage.ts`, `src/services/sparseVector.ts`*

AetherOS does not rely solely on dense embeddings (which capture semantic meaning but often miss exact keyword matches). 

**How it works:**
1. **Dense Search**: Uses `nomic-embed-text` (768 dimensions) to find semantically similar text.
2. **Sparse Search (BM25)**: A custom TF-IDF implementation (`sparseVector.ts`) computes term frequencies and inverse document frequencies globally across your notes. This ensures strict keyword matching (e.g., searching for "RRF" specifically).
3. **RRF Merge**: The results from the top 100 dense and top 100 sparse matches are fused using RRF. Instead of comparing raw scores (which have different scales), RRF assigns a score based on the rank position:
   ```javascript
   // k is typically 60
   rrfScore = 1 / (k + rank_position)
   ```
   If a document ranks high in both Dense and Sparse searches, combining these scores pushes it to the absolute top.

## 3. Query Expansion
*File: `src/services/queryExpansion.ts`*

Users rarely phrase their questions perfectly to match their notes. 
- **Implementation**: Before searching, AetherOS passes the user's input to a fast local LLM (`qwen3:4b`) to generate 3 alternative phrasings.
- All 4 queries (original + 3 expansions) run through the Hybrid Search pipeline concurrently, effectively casting a wider net to prevent "vocabulary mismatch" between the query and the documents.

## 4. Cross-Encoder Reranking
*File: `src/services/reranker.ts`*

Vector search is fast but mathematically simplistic (Cosine Similarity). Cross-Encoders are slower but much more accurate because they feed the query and the document simultaneously through attention layers to understand their true relationship.

- **Implementation**: AetherOS takes the top candidates gathered from Hybrid Search and feeds them into `Xenova/ms-marco-MiniLM-L-12-v2` (`@xenova/transformers`). 
- It uses batch inference (`batch_size: 16`) to efficiently run all candidates on the GPU at once, reassigning absolute relevancy scores.

## 5. Maximal Marginal Relevance (MMR)
*File: `src/services/mmr.ts`*

If an LLM receives 5 identical chunks of text that repeat the exact same information, its output won't be comprehensive. MMR balances **Relevance** (how well the chunk matches the query) with **Diversity** (how different the chunk is from others already selected).

**The Equation used:**
`MMR = λ * sim(query, doc) - (1-λ) * max_sim(doc, already_selected_docs)`
- With `λ = 0.7`, AetherOS prioritizes relevance but aggressively penalizes a document if it is mathematically too similar to one already chosen for the context window.

## 6. "Small-to-Big" Context Hydration
*File: `src/services/retrieval.ts`*

Sometimes a small sentence is enough to match a search, but the LLM needs the full paragraph to understand the implications.
- **Implementation**: Because the ingestion phase created Paragraph chunks that remember their `parentId`, the retrieval engine will look at the top selected paragraphs. If a chunk is a paragraph, AetherOS fetches the full **Section Chunk** (its parent) from Qdrant.
- This ensures the LLM receives the granular hit wrapped in its broader, original context.

## 7. Chain-of-Verification (CoVe)
*File: `src/services/cove.ts`*

Even with perfect RAG, LLMs hallucinate. 
- **Implementation**: After generating a draft answer, AetherOS prompts the LLM again with a strict fact-checking directive. It passes the original context, the draft answer, and the question, instructing the model to strip out any claims that are not explicitly cited in the context.

---
**Summary for your own projects:** If you are building a custom RAG solution, adopting **Small-to-Big Hydration** via intelligent chunking, fusing Dense and Sparse retrieval (**Hybrid Search with RRF**), and reranking candidates via a **Cross-Encoder** are the most impactful upgrades you can make beyond basic LangChain/LlamaIndex tutorials.
