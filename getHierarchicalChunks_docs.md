# Developer Documentation: `getHierarchicalChunks.ts`

**Path:** `src/ingest/getHierarchicalChunks.ts`

## Overview
The `getHierarchicalChunks.ts` file acts as the primary data ingestion engine for the AetherOS RAG pipeline. Its responsibility is to take a raw Markdown string, parse it into an Abstract Syntax Tree (AST), and intelligently split it into hierarchical chunks (Sections and Paragraphs) without destroying semantic meaning or structural integrity (e.g., keeping lists and tables together).

---

## 1. Core Interfaces and Data Structures

### `HierarchicalChunk`
The primary output object that represents a chunk of text to be embedded and stored in Qdrant.
```typescript
export interface HierarchicalChunk {
  id: string;              // MD5 hash based on filepath and heading path
  content: string;         // The actual text slice
  headingPath: string[];   // Array representing hierarchy (e.g. ['Chapter 1', 'Section A'])
  level: number;           // The depth of the nearest heading (H1 = 1, etc.)
  parentId: string | null; // For paragraphs: the ID of the parent section chunk
  filePath: string;        // Originating file path
  timestamp: string;       // Processing time
  tags: string[];          // Extracted or passed tags
  chunkLevel: 'section' | 'paragraph'; // Differentiates "Big" vs "Small" chunks
}
```

### Internal AST Typings
- `HeadingInfo`: Represents an extracted heading (`depth`, `text`, `start`, `end`).
- `ContentNodeInfo`: Represents an extracted structural block (`type`, `text`, `start`, `end`).
- `SectionNode`: The recursive tree structure built before generation (`heading`, `headingPath`, `children: SectionNode[]`, `content: ContentNodeInfo[]`, `parent`).

---

## 2. Main Entry Point: `getHierarchicalChunks`
This is the default exported function.

**Parameters:**
- `markdown: string`: Raw file contents.
- `filePath: string`: Absolute or relative path to the markdown file.
- `taggingModel: string`: (Optional) Model used for auto-tagging.

**Execution Flow:**
1.  **Parse**: Runs the string through `unified()`, `remarkParse`, and `remarkGfm` to generate a standard mdast (Markdown AST).
2.  **Collect**: Calls `collectNodes()` to scrape headings and root-level content blocks.
3.  **Build Tree**: Calls `buildSectionTree()` to assemble a mathematical tree based on byte offsets and heading depths.
4.  **Generate**: Calls `generateChunks()` to split the tree into physical strings that respect the `MAX_CHUNK_SIZE` limit.
5.  **Return**: Returns the final flattened `HierarchicalChunk[]` array.

---

## 3. The 3-Step Algorithm

### Step 1: `collectNodes(markdown, tree)`
- **Headings**: Uses `unist-util-visit` to deeply traverse the AST and find every heading. It extracts raw text and positional offsets.
- **Content Nodes**: It specifically iterates **only through the root children** of the AST (skipping deep traversal). 
  - *Why?* To preserve complex structures like lists containing paragraphs, or blockquotes. By capturing the root node, `getNodeText` handles parsing the entire tree of that specific structure manually, treating the whole thing as one "paragraph chunk".

### Step 2: `buildSectionTree(headings, contentNodes, filePath)`
This step marries the flat list of headings and the flat list of content nodes into a parent-child relationship by analyzing their byte offsets (`start`/`end`).

- It uses a custom **Stack-based pointer algorithm**.
- Maintains a `stack` of open headings.
- While looping mathematically by byte offset, if a heading is encountered:
  - If its `depth` (H1 vs H2) is equal to or shallower than the current stack tip, it pops the stack backwards until it finds its logical parent.
  - Generates an `md5` hash representing its unique `headingPath`.
- If a content node is encountered:
  - It assigns it to the `content` array of the section currently sitting at the top of the stack.
- **Orphan Handling**: If text exists *before* the first heading inside a file, it catches it in `orphanContent` and synthesizes an artificial root section node.

### Step 3: `generateChunks(sections, ...)`
Takes the nested tree from Step 2 and recursively walks it to generate flat chunks.

It outputs exactly two variants of chunks for maximum RAG coverage:
1. **Section Chunks** (`chunkLevel: 'section'`):
   - Concatenates *all* direct content nodes beneath a heading.
   - Splits using `splitText()` if it bypasses the `3800` character limit.
2. **Paragraph Chunks** (`chunkLevel: 'paragraph'`):
   - Iterates over each single content node immediately under the heading (e.g., one sentence, or one bullet list).
   - Generates chunks specifically tagged with a `parentId` that links back to the Section Chunk ID created above. *This sets up the "Small-to-Big Context Hydration" trick used in retrieval.*

---

## 4. Helper Utilities

- **`getNodeText(node, markdown)`**: A sophisticated switch statement that handles AST stringification.
  - Uses `sliceMarkdown()` to cut exact byte ranges for standard prose and blockquotes.
  - Manually builds markdown strings for `code` (injecting the `lang` tag back).
  - Uses `renderList()` to recursively rebuild ordered/unordered lists with correct indentation.
  - Uses `renderTable()` to handle GitHub Flavored Markdown (GFM) tables safely, falling back to raw slices on malformed ASTs.
- **`splitText(text: string)`**: Responsible for the actual text slicing if content is over `MAX_CHUNK_SIZE` (3800).
  - Target overlap is 20% (bounded strictly between 80 to 250 characters).
  - Uses basic heuristic boundaries (`.`, `!`, `?`, `\n`, or spaces) to avoid slicing words in half.
