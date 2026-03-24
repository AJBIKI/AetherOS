Here’s an updated README that accurately reflects the current state of AetherOS (v1.1) based on the code we reviewed. It includes the implemented features (hierarchical chunking, hybrid search with dense + sparse, cross‑encoder reranking, context hydration) and corrects version numbers and roadmap.

---

```markdown
# 🌌 AetherOS: Local‑First RAG for Your Second Brain

**AetherOS** is a high‑precision, local‑first RAG (Retrieval‑Augmented Generation) backend that turns your Markdown notes into a queryable knowledge base. It uses **hierarchical chunking**, **hybrid search** (dense + sparse vectors), **cross‑encoder reranking**, and **context hydration** to deliver accurate answers with source citations—all running locally on your laptop with zero cloud cost.

---

## 🚀 Architecture Overview

AetherOS implements a **multi‑stage retrieval pipeline** to maximise relevance:

1. **Hierarchical Chunking** – Parses Markdown into a tree of sections (headings) and paragraphs.  
   - Section chunks contain the heading + all direct content.  
   - Paragraph chunks are fine‑grained and store a `parentId` linking to their parent section.  
   - Overlap ensures no information is lost at chunk boundaries.

2. **Hybrid Vector Storage (Qdrant)**  
   - **Dense vectors** (768‑dim) from `nomic-embed-text` for semantic search.  
   - **Sparse vectors** (BM25‑like) for keyword matching.  
   - Both vectors are stored in the same point, enabling **Reciprocal Rank Fusion (RRF)** at query time.

3. **Cross‑Encoder Reranking**  
   - After retrieving top candidates (e.g., 25), a cross‑encoder (`ms-marco-MiniLM-L-12-v2`) re‑evaluates them against the query.  
   - This second pass filters out false positives and returns the most relevant 5–6 chunks.

4. **Context Hydration**  
   - When a paragraph is retrieved, AetherOS fetches its parent section (via `parentId`) to provide richer context to the LLM.  
   - This “small‑to‑big” approach mimics how humans read: find a relevant sentence, then look around for context.

5. **LLM Generation**  
   - The final context is fed to `qwen3:8b` (via Ollama) to generate a natural‑language answer.  
   - The response includes file paths and headings for source attribution.

---

## 🛠️ Tech Stack

| Component           | Technology                                                                 |
|---------------------|----------------------------------------------------------------------------|
| **Runtime**         | Node.js 22+ (ESM), TypeScript, TSX (for direct execution)                  |
| **API**             | Fastify + tRPC (type‑safe endpoints)                                       |
| **Vector DB**       | Qdrant (Docker) – dense + sparse vectors, payload indexing                 |
| **Embeddings**      | `nomic-embed-text` via Ollama (768‑dim)                                   |
| **Sparse Vectors**  | Custom BM25 implementation (word hashing + global IDF)                     |
| **Reranker**        | `Xenova/ms-marco-MiniLM-L-12-v2` (ONNX runtime in Node)                   |
| **Chunking**        | `unified` + `remark‑parse` + `remark‑gfm` (AST traversal)                 |
| **File Watcher**    | `chokidar` (monitors folder for changes)                                  |
| **Generation**      | `qwen3:8b` via Ollama API                                                  |

---

## ⚙️ Installation & Setup

### Prerequisites
- **Docker** (for Qdrant)
- **Ollama** (running locally with at least `nomic-embed-text` and `qwen3:8b` pulled)
- **Node.js** 20+ (npm or yarn)

### 1. Start Qdrant
```bash
docker run -d -p 6333:6333 --name qdrant qdrant/qdrant
```

### 2. Pull Required Models
```bash
ollama pull nomic-embed-text
ollama pull qwen3:8b
```

### 3. Clone & Install
```bash
git clone https://github.com/yourusername/aetheros.git
cd aetheros
npm install
```

### 4. Configure Environment
Copy `.env.example` to `.env` and adjust if needed:
```
PORT=3000
WATCH_FOLDER=./notes            # Folder containing your markdown files
QDRANT_URL=http://localhost:6333
OLLAMA_HOST=http://localhost:11434
```

### 5. Start the Watcher & Server
```bash
npm run dev
```
This will:
- Create the Qdrant collection (with dense/sparse vectors and payload indexes)
- Start watching the configured folder
- Launch the Fastify server at `http://localhost:3000`

---

## 🔍 Usage

### 1. Place a Markdown file in the watched folder
AetherOS will automatically index it. You’ll see logs for each chunk (section/paragraph) being embedded and stored.

### 2. Query via tRPC
```bash
curl -X POST http://localhost:3000/trpc/ask \
  -H "Content-Type: application/json" \
  -d '{"json":{"question":"What is the architecture of AetherOS?"}}'
```

**Response**:
```json
{
  "result": {
    "data": {
      "answer": "AetherOS uses a multi-stage retrieval pipeline...",
      "sources": [
        {
          "filePath": "/path/to/notes/architecture.md",
          "heading": "Architecture Overview",
          "score": 0.89
        }
      ]
    }
  }
}
```

### 3. Health Check
```bash
curl http://localhost:3000/trpc/health
# {"status":"ok","version":"1.1.0"}
```

---

## 🧠 Key Design Decisions

### Hierarchical Chunking
Instead of naive fixed‑length splits, AetherOS respects the document’s outline:
- Sections are kept intact (heading + all content) to preserve high‑level meaning.  
- Paragraphs are stored individually for granular retrieval.  
- The `parentId` link allows dynamic expansion from a paragraph to its full section.

### Hybrid Search with RRF
- Dense search alone misses exact keywords (e.g., function names).  
- Sparse search alone lacks semantic understanding.  
- RRF combines rankings from both, giving a robust retrieval that works for both conceptual and literal queries.

### Cross‑Encoder Reranking
- Bi‑encoders (like the dense vector model) are fast but less precise.  
- A cross‑encoder (slow but accurate) re‑ranks the top candidates, dramatically improving precision without scanning the whole database.

### Context Hydration
- Retrieving a paragraph is precise, but the LLM often needs the surrounding section to answer coherently.  
- Hydration fetches the parent section (the “big” context) while still leveraging the precise match.

---

## 📂 Project Structure

```
aetheros/
├── src/
│   ├── index.ts                # Entry point: initialises storage, watcher, server
│   ├── server.ts               # Fastify app with tRPC plugin
│   ├── trpc.ts                 # tRPC router (health, greet, ask)
│   ├── storage.ts              # Qdrant client, collection init, upsert, hybrid search
│   ├── watcher.ts              # Chokidar file watcher and ingestion logic
│   ├── llm.ts                  # Ollama embedding & generation (not shown but implied)
│   ├── ingest/
│   │   └── getHierarchicalChunks.ts  # AST‑based chunking
│   ├── services/
│   │   ├── sparseVector.ts     # BM25 tokenisation, IDF calculation
│   │   ├── reranker.ts         # Cross‑encoder reranking
│   │   └── retrieval.ts        # Hydrated context orchestration
├── notes/                      # Example folder – place your markdown files here
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

---

## 📌 Roadmap

- [x] **v1.0**: Basic watcher + simple chunking + Qdrant with dense vectors
- [x] **v1.1**: Hierarchical chunking, hybrid search (dense + sparse), cross‑encoder reranking, context hydration
- [ ] **v1.2**: Add metadata filtering (by date, tags, folder) to hybrid search
- [ ] **v1.3**: Implement periodic IDF recomputation for sparse vectors
- [ ] **v1.4**: Simple web dashboard to visualise notes and query history
- [ ] **v1.5**: Authentication and multi‑user workspaces (transition to SaaS)

---

## 🤝 Contributing

This is a personal project, but feel free to fork and adapt it to your own note‑taking workflow. If you find a bug or have an idea, open an issue or submit a pull request.

---

<!--## 📝 License

MIT-->

---

**Built with ❤️ for developers who want to keep their notes private and queryable.**
```