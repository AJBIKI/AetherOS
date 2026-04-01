# AetherOS High-Level Design (HLD)

This diagram visualizes the architecture of AetherOS, split into the **Ingestion Pipeline** (how notes are processed and stored) and the **Retrieval Pipeline** (how quotes are found and answers are generated).

```mermaid
graph TD
    %% Ingestion Phase
    subgraph Ingestion Pipeline
        A[Markdown Notes] --> B[AST Parser remark/unified]
        B --> C[Hierarchical Chunker]
        C --> D{Chunk Types}
        D -->|Section Chunks| E[Local Txt Storage]
        D -->|Paragraph Chunks via ParentId| E
        D --> F[Dense Embedder nomic-embed-text]
        D --> G[Sparse Vectorizer Custom BM25]
        F --> H[(Qdrant Vector DB)]
        G --> H
    end

    %% Retrieval Phase
    subgraph Retrieval & RAG Pipeline
        U[User Query] --> I[Query Expansion qwen3:4b]
        I -->|Original + 3 Variations| J[Hybrid Search]
        J -->|Top 100 Dense| H
        J -->|Top 100 Sparse| H
        H -->|Scores combined| K[Reciprocal Rank Fusion RRF]
        K --> L[Merge & Deduplicate by ID]
        E -->|Fetch Text| L
        L --> M[Cross-Encoder Reranker Xenova/MiniLM]
        M --> N[MMR Selection Lambda=0.7]
        N --> O{Context Hydration Small-to-Big}
        O -->|Paragraph Hit| P[Fetch Parent Section Text]
        O -->|Section Hit| Q[Keep as is]
        P --> R[Final Context Assembly]
        Q --> R
        R --> S[LLM Generation qwen3:4b]
        S --> T[Chain-of-Verification Fact Checker]
        T --> V[Verified Final Answer]
    end
    
    classDef storage fill:#f9f,stroke:#333,stroke-width:2px;
    class H storage;
    class E storage;
```

## Key Workflows:
1. **Ingestion**: Markdown is intelligently parsed to preserve structure. Chunks are embedded both semantically (Dense) and lexically (Sparse), then stored in Qdrant while the raw text is saved to disk for fast, lightweight hydration.
2. **Retrieval**: The system queries 4 variations of the question, fetches vector hits, merges them via RRF, re-scores them accurately with a Cross-Encoder, filters for diversity using MMR, and finally "zooms out" on small paragraphs to give the LLM full necessary context.
