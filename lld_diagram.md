# AetherOS Low-Level Design (LLD)

This document visualizes the exact sequence of function calls, data structures, and service interactions in the AetherOS codebase. It is split into two sequence diagrams representing the two primary lifecycle events: **Document Ingestion** and **RAG Retrieval**.

## 1. Document Ingestion Flow

This sequence details how `getHierarchicalChunks.ts` processes raw markdown and persists it through `storage.ts`.

```mermaid
sequenceDiagram
    participant W as Server/Watcher
    participant GC as getHierarchicalChunks.ts
    participant AST as unified / remark
    participant ST as storage.ts
    participant CS as chunkStorage.ts (FS)
    participant LLM as Ollama Embeddings
    participant SV as sparseVector.ts
    participant QD as Qdrant DB

    W->>GC: getHierarchicalChunks(markdown, filePath)
    GC->>AST: parse(markdown)
    AST-->>GC: syntaxTree
    
    GC->>GC: collectNodes(syntaxTree)
    Note over GC: Deep visit for Headings<br/>Root children for Content
    
    GC->>GC: buildSectionTree(headings, contentNodes)
    Note over GC: Returns SectionNode[]<br/>Assigns id based on md5(headingPath)
    
    GC->>GC: generateChunks(SectionNode[])
    Note over GC: Splits text > 3800 chars.<br/>Creates chunkLevel: 'section' or 'paragraph'
    
    GC-->>W: Promise<HierarchicalChunk[]>
    
    loop For each HierarchicalChunk
        W->>LLM: getEmbedding(chunk.text)
        LLM-->>W: denseVector (768-dim)
        
        W->>ST: upsertChunk(id, denseVector, text, payload)
        
        ST->>CS: saveChunkText(id, text)
        Note over CS: writes to data/chunks/<clean-id>.txt
        CS-->>ST: success
        
        ST->>SV: computeSparseVector(text)
        Note over SV: Calculates tf * globalIdf for tokens
        SV-->>ST: { indices, values }
        
        ST->>QD: client.upsert(COLLECTION_NAME)
        Note over QD: Vectors: text-dense & text-sparse<br/>Payload: filePath, headingPath, tags, etc.
        QD-->>ST: wait: true
        ST-->>W: success
    end
```

## 2. RAG Retrieval Engine Flow

This sequence details the execution of `getHydratedContext` within `retrieval.ts`.

```mermaid
sequenceDiagram
    participant User
    participant R as retrieval.ts
    participant QE as queryExpansion.ts
    participant ST as storage.ts
    participant CS as chunkStorage.ts (FS)
    participant RR as reranker.ts
    participant MMR as mmr.ts
    participant QD as Qdrant DB

    User->>R: getHydratedContext(question, limit=15, topK=6)
    
    %% 1. Query Expansion
    R->>QE: expandQuery(question, num=3)
    Note over QE: LLM generates 3 variations
    QE-->>R: expandedQueries (Array of 4 strings)
    
    %% 2. Hybrid Search + RRF
    loop For each expanded query
        R->>ST: hybridSearch(query, limit=15)
        
        ST->>QD: search(text-dense, limits=100)
        QD-->>ST: denseHits
        
        ST->>QD: search(text-sparse, limits=100)
        QD-->>ST: sparseHits
        
        ST->>ST: Reciprocal Rank Fusion (k=60)
        Note right of ST: rrfScore = 1/(60+rank) * weight
        
        loop For Top merged candidates
            ST->>CS: getChunkText(cleanId)
            CS-->>ST: File contents (text)
            Note right of ST: Fallback to payload.text if file missing
        end
        ST-->>R: Promise<{id, score, text, payload}[]>
    end
    
    %% 3. Deduplication
    R->>R: New Map() Deduplicate all hits by ID
    
    %% 4. Reranking
    R->>RR: rerank(question, mergedHits, topK * 2)
    Note over RR: load pipeline "ms-marco-MiniLM-L-12-v2"
    RR->>RR: model(queries, passages, batch_size=16)
    RR-->>R: rerankedHits (Sorted by Probability)
    
    %% 5. Diverse Selection (MMR)
    R->>MMR: mmrSelection(rerankedHits, emb, 0.7, topK)
    Note over MMR: MMR = λ*sim(q,d) - (1-λ)*max_sim(d,selected)
    MMR-->>R: diverseHits (top 6 varied chunks)
    
    %% 6. Context Hydration (Small-to-Big)
    loop For each diverseHit
        alt chunkLevel === 'paragraph' && parentId !== null
            R->>ST: getChunkById(hit.parentId)
            ST->>QD: client.retrieve(parentId)
            QD-->>ST: parentPoint
            ST->>CS: getChunkText(parentId)
            CS-->>ST: parentText
            ST-->>R: { text: parentText, ...hit } (Zoomed to Section)
        else chunkLevel === 'section'
            R-->>R: Keep original hit.text
        end
    end
    
    %% 7. Formatting
    R->>R: Deduplicate by exact text (removes overlap)
    R->>R: Join with "[Source: filePath -> headingPath]\n\n"
    
    R-->>User: RetrievalResult { contextString, sources }
```

### Advanced Algorithmic Notes Included:
* **Reciprocal Rank Fusion**: By performing calculations purely in memory in `storage.ts`, it negates complex DB-side scoring calculations. It scales both query hits inversely to their rank index.
* **Small-to-Big Retrieval Optimization**: Hydrating using `chunkLevel` prevents the final payload from overflowing token limits with duplicate content while still feeding the LLM maximum viable context.
* **Batch Inference**: The cross-encoder limits processing bottlenecks by batching its inputs explicitly for vector execution `batch_size: 16`.
