# 🌌 AetherOS: Developer's Second Brain
**High-Precision RAG with Hierarchical AST Chunking & Cross-Encoder Reranking**

AetherOS is a local-first knowledge engine designed to turn thousands of messy Markdown notes into a queryable, structured database. Built for developers who need **90%+ retrieval accuracy** without leaving their local environment.



## 🚀 The "God-Tier" Architecture (v1.2)

AetherOS goes beyond simple vector search by implementing a multi-stage retrieval pipeline:

### 1. Hierarchical AST Chunker
Unlike standard "fixed-size" chunkers, AetherOS uses a **Markdown AST (Abstract Syntax Tree)** parser to understand the document structure.
* **Two-Tier Strategy**: Generates 'Section' chunks (high-level context) and 'Paragraph' chunks (surgical details).
* **Parent-Child Linking**: Every paragraph chunk maintains a `parentId` link to its parent section, allowing for "Small-to-Big" context reconstruction.
* **Sliding Window Overlap**: Implements a 20% semantic overlap to ensure context isn't lost at chunk boundaries.

### 2. Hybrid Vector Search (Qdrant)
* **Dense Embeddings**: Powered by `nomic-embed-text` for deep semantic meaning.
* **Named Vectors**: Optimized storage in Qdrant with specific `text-dense` and `text-sparse` indices.
* **Metadata Filtering**: Sub-10ms surgical filtering by `filePath`, `timestamp`, and `chunkLevel`.

### 3. Cross-Encoder Reranking
* **Model**: `Xenova/ms-marco-MiniLM-L-12-v2`
* **The "Truth" Layer**: A second-pass verification where a cross-encoder evaluates the top 25 candidates against the query to find the absolute 5 most relevant results.



---

## 🛠️ Tech Stack

* **Runtime**: Node.js (TSX / TypeScript)
* **Vector Database**: [Qdrant](https://qdrant.tech/) (Docker)
* **Orchestration**: [tRPC](https://trpc.io/) for type-safe API communication.
* **Embeddings & LLM**: [Ollama](https://ollama.com/) (`nomic-embed-text` & `qwen3:8b`).
* **Markdown Engine**: `unified`, `remark-parse`, `unist-util-visit`.
* **Reranker**: `@xenova/transformers` (Local ONNX execution).

---

## ⚙️ Installation & Setup

### 1. Prerequisites
* Docker (for Qdrant)
* Ollama (running locally)
* Node.js 20+

### 2. Launch Infrastructure
```bash
# Start Qdrant
docker run -p 6333:6333 qdrant/qdrant

# Pull Required Models
ollama pull nomic-embed-text
ollama pull qwen3:8b
```

### 3. Environment Setup
Create a `.env` file (if applicable) or ensure your `config.ts` points to:
* Qdrant: `http://localhost:6333`
* Ollama: `http://localhost:11434`

### 4. Install & Run
```bash
npm install
npm run dev
```

---

## 🔍 Core Features

* **Live Watcher**: Uses `chokidar` to monitor your `notes/` folder. Changes are re-indexed instantly using an atomic "Clean Slate" strategy (deletes old chunks before re-indexing).
* **Breadcrumb Citations**: Every answer includes a full path (e.g., `Backend → Streams → Solutions`), so you know exactly which file and section the AI is quoting.
* **Score Thresholding**: A tunable `0.62` relevance bar ensures the AI admits "I don't know" rather than hallucinating from low-quality matches.

---

## 🗺️ Project Roadmap

- [x] v1.1: Hierarchical Chunking & Named Vectors.
- [x] v1.2: Cross-Encoder Reranking & Section-Tree Logic.
- [ ] v1.3: Sparse BM25 Keyword Matching (Hybrid Search).
- [ ] v1.4: "Context Zoom" (Small-to-Big Retrieval logic).
- [ ] v1.5: UI/UX Dashboard for Note Visualization.

---

## 🤝 Contributing
This is a personal "Second Brain" project. Feel free to fork and adapt the chunking logic for your specific note-taking style (Obsidian, Notion-export, etc.).

---
