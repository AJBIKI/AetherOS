
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import crypto from 'crypto';
// import ollama from 'ollama';
import { visit } from 'unist-util-visit';

const MAX_CHUNK_SIZE = 3800;
const OVERLAP_PERCENT = 0.20;
const MIN_OVERLAP = 80;
const MAX_OVERLAP = 250;

export interface HierarchicalChunk {
  id: string;
  content: string;
  headingPath: string[];
  level: number;
  parentId: string | null;
  filePath: string;
  timestamp: string;
  tags: string[];
  chunkLevel: 'section' | 'paragraph';
}

// ── AST collection types ──────────────────────────────────────────────────────

interface HeadingInfo {
  depth: number;
  text: string;
  start: number;
  end: number;
}

interface ContentNodeInfo {
  type: string;
  text: string;
  start: number;
  end: number;
}

// ── Section tree types ────────────────────────────────────────────────────────

interface SectionNode {
  heading: HeadingInfo;
  headingPath: string[];
  children: SectionNode[];
  content: ContentNodeInfo[];
  parent: SectionNode | null;
  id: string;
}

// ── Main export ───────────────────────────────────────────────────────────────

export const getHierarchicalChunks = async (
  markdown: string,
  filePath: string,
  taggingModel: string = 'qwen3:4b'
): Promise<HierarchicalChunk[]> => {
  console.log(`\n📄 Processing file: ${filePath}`);
  console.log(`   Markdown length: ${markdown.length} chars`);

  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(markdown);

  const { headings, contentNodes } = collectNodes(markdown, tree);
  console.log(`   Headings found: ${headings.length}`);
  console.log(`   Content nodes found: ${contentNodes.length}`);

  const sections = buildSectionTree(headings, contentNodes, filePath);
  console.log(`   Top-level sections: ${sections.length}`);

  const timestamp = new Date().toISOString();
  const allChunks = await generateChunks(sections, filePath, timestamp, taggingModel);

  const sectionChunks = allChunks.filter(c => c.chunkLevel === 'section');
  const paragraphChunks = allChunks.filter(c => c.chunkLevel === 'paragraph');
  console.log(`   ✅ Generated ${allChunks.length} chunks (${sectionChunks.length} sections, ${paragraphChunks.length} paragraphs)\n`);

  return allChunks;
};

// ── Step 1: collect headings + content nodes ──────────────────────────────────

function collectNodes(
  markdown: string,
  tree: any
): { headings: HeadingInfo[]; contentNodes: ContentNodeInfo[] } {
  const headings: HeadingInfo[] = [];
  const contentNodes: ContentNodeInfo[] = [];

  // 1. Collect all headings (deep) using visit
  visit(tree, (node) => {
    if (!node.position) return;
    if (node.type === 'heading') {
      const text = extractPlainText(node).trim();
      if (!text) return;
      headings.push({
        depth: node.depth,
        text,
        start: node.position.start.offset,
        end: node.position.end.offset,
      });
    }
  });

  // 2. Collect content nodes only from root children
  //    This preserves list/blockquote structure via renderList() etc.
  for (const node of (tree as any).children) {
    if (!node.position) continue;

    // Skip headings (already handled)
    if (node.type === 'heading') continue;

    // For content types that we want to keep as whole units
    const text = getNodeText(node, markdown);
    if (text.trim()) {
      contentNodes.push({
        type: node.type,
        text,
        start: node.position.start.offset,
        end: node.position.end.offset,
      });
    }
  }

  return { headings, contentNodes };
}

// ── Step 2: build section tree using offset ordering ─────────────────────────

function buildSectionTree(
  headings: HeadingInfo[],
  contentNodes: ContentNodeInfo[],
  filePath: string
): SectionNode[] {
  const topLevel: SectionNode[] = [];

  // Stack entries: { node, level }
  // Stack[0] = shallowest open section
  const stack: { node: SectionNode; level: number }[] = [];

  let hIdx = 0;
  let cIdx = 0;

  // Orphan content (before first heading)
  const orphanContent: ContentNodeInfo[] = [];

  while (hIdx < headings.length || cIdx < contentNodes.length) {
    const nextH = headings[hIdx];
    const nextC = contentNodes[cIdx];

    const headingIsNext = nextH && (!nextC || nextH.start < nextC.start);

    if (headingIsNext) {
      hIdx++;

      // Pop stack until we find a shallower heading
      while (stack.length > 0 && stack[stack.length - 1].level >= nextH.depth) {
        stack.pop();
      }

      const parent = stack.length > 0 ? stack[stack.length - 1].node : null;

      // Bake in the full path at construction time
      const headingPath = parent
        ? [...parent.headingPath, nextH.text]
        : [nextH.text];

      const id = crypto
        .createHash('md5')
        .update(`${filePath}|${headingPath.join('>')}|${nextH.text}`)
        .digest('hex');

      const section: SectionNode = {
        heading: nextH,
        headingPath,
        children: [],
        content: [],
        parent,
        id,
      };

      if (parent) {
        parent.children.push(section);
      } else {
        topLevel.push(section);
      }

      stack.push({ node: section, level: nextH.depth });

      // Log the section creation (optional, can be noisy)
      // console.log(`   ➕ Section: ${headingPath.join(' → ')} (depth ${nextH.depth})`);

    } else if (nextC) {
      cIdx++;

      if (stack.length > 0) {
        stack[stack.length - 1].node.content.push(nextC);
      } else {
        // Content before any heading → collect as orphan
        orphanContent.push(nextC);
      }
    }
  }

  // Wrap orphan content in a synthetic root section
  if (orphanContent.length > 0) {
    console.log(`   ⚠️ Found ${orphanContent.length} content nodes before first heading – wrapping in root section.`);
    const rootId = crypto
      .createHash('md5')
      .update(`${filePath}|__root__`)
      .digest('hex');

    const rootSection: SectionNode = {
      heading: { depth: 0, text: '', start: 0, end: 0 },
      headingPath: [],
      children: topLevel.splice(0),   // adopt existing top-level sections as children
      content: orphanContent,
      parent: null,
      id: rootId,
    };

    return [rootSection];
  }

  return topLevel;
}

// ── Step 3: generate two-tier chunks ─────────────────────────────────────────

async function generateChunks(
  sections: SectionNode[],
  filePath: string,
  timestamp: string,
  taggingModel: string
): Promise<HierarchicalChunk[]> {
  const all: HierarchicalChunk[] = [];

  async function processSection(section: SectionNode): Promise<void> {
    const { headingPath, heading, id: sectionId } = section;
    const level = heading.depth;

    // Log the section we're processing
    console.log(`   📂 Processing section: ${headingPath.join(' → ') || '(root)'} (depth ${level}, content nodes: ${section.content.length})`);

    let sectionChunkCount = 0;
    let paragraphChunkCount = 0;

    // ── Section chunk: heading + all direct content concatenated ─────────
    if (section.content.length > 0) {
      let sectionText = heading.text ? `# ${heading.text}\n\n` : '';
      for (const c of section.content) sectionText += c.text + '\n\n';
      sectionText = sectionText.trim();

      const sectionSplits = splitText(sectionText);
      sectionChunkCount = sectionSplits.length;
      for (let i = 0; i < sectionSplits.length; i++) {
        const content = sectionSplits[i];
        all.push({
          id: makeId(`${filePath}|${headingPath.join('>')}|section|${content.substring(0, 120)}|${i}`),
          content,
          headingPath,
          level,
          parentId: section.parent ? section.parent.id : null,
          filePath,
          timestamp,
          tags: [],
          chunkLevel: 'section',
        });
      }
    }

    // ── Paragraph chunks: one per content node ────────────────────────────
    for (const contentNode of section.content) {
      const splits = splitText(contentNode.text);
      paragraphChunkCount += splits.length;
      for (let i = 0; i < splits.length; i++) {
        const content = splits[i];
        all.push({
          id: makeId(`${filePath}|${headingPath.join('>')}|${contentNode.type}|${content.substring(0, 120)}|${i}`),
          content,
          headingPath,
          level,
          parentId: sectionId,    // parent = the section chunk
          filePath,
          timestamp,
          tags: [],
          chunkLevel: 'paragraph',
        });
      }
    }

    if (sectionChunkCount + paragraphChunkCount > 0) {
      console.log(`      → Generated ${sectionChunkCount} section chunk(s) and ${paragraphChunkCount} paragraph chunk(s)`);
    }

    // Recurse
    for (const child of section.children) {
      await processSection(child);
    }
  }

  for (const section of sections) {
    await processSection(section);
  }

  return all;
}

// ── Node text extraction (unchanged) ─────────────────────────────────────────
function getNodeText(node: any, markdown: string): string {
  switch (node.type) {
    case 'paragraph':
      return sliceMarkdown(node, markdown);
    case 'code': {
      const lang = node.lang ?? '';
      return `\`\`\`${lang}\n${node.value ?? ''}\n\`\`\``;
    }
    case 'list':
      return renderList(node, markdown, node.ordered ?? false, 0);
    case 'blockquote':
      return sliceMarkdown(node, markdown);
    case 'table':
      return renderTable(node, markdown);
    case 'html':
      return (node.value ?? '').trim();
    default:
      return sliceMarkdown(node, markdown);
  }
}

function renderList(listNode: any, markdown: string, ordered: boolean, depth: number): string {
  const indent = '  '.repeat(depth);
  const lines: string[] = [];
  let idx = 1;

  for (const item of listNode.children ?? []) {
    const prefix = ordered ? `${idx++}.` : '-';
    const parts: string[] = [];

    for (const child of item.children ?? []) {
      if (child.type === 'paragraph') {
        const t = sliceMarkdown(child, markdown).trim();
        if (t) parts.push(t);
      } else if (child.type === 'list') {
        const nested = renderList(child, markdown, child.ordered ?? false, depth + 1);
        if (nested) parts.push(nested);
      }
    }

    if (parts.length) {
      lines.push(`${indent}${prefix} ${parts.join('\n' + indent + '  ')}`);
    }
  }

  return lines.join('\n');
}

function renderTable(tableNode: any, markdown: string): string {
  try {
    const rows: string[] = [];
    for (const row of tableNode.children ?? []) {
      const cells = (row.children ?? []).map((cell: any) => extractPlainText(cell).trim());
      rows.push('| ' + cells.join(' | ') + ' |');
    }
    if (!rows.length) return sliceMarkdown(tableNode, markdown);
    const colCount = tableNode.children?.[0]?.children?.length ?? 1;
    rows.splice(1, 0, '| ' + Array(colCount).fill('---').join(' | ') + ' |');
    return rows.join('\n');
  } catch {
    return sliceMarkdown(tableNode, markdown);
  }
}

// ── Helpers (unchanged) ──────────────────────────────────────────────────────
function sliceMarkdown(node: any, markdown: string): string {
  if (node.position?.start?.offset != null && node.position?.end?.offset != null) {
    return markdown.slice(node.position.start.offset, node.position.end.offset).trim();
  }
  return extractPlainText(node);
}

function extractPlainText(node: any): string {
  if (!node) return '';
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? '';
  if (node.type === 'code') return node.value ?? '';
  if (node.children) return (node.children as any[]).map(extractPlainText).join('');
  return '';
}

function splitText(text: string): string[] {
  if (text.length <= MAX_CHUNK_SIZE) return [text];

  const overlapTarget = Math.floor(MAX_CHUNK_SIZE * OVERLAP_PERCENT);
  const overlapSize = Math.min(Math.max(overlapTarget, MIN_OVERLAP), MAX_OVERLAP);
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + MAX_CHUNK_SIZE;
    if (end >= text.length) {
      chunks.push(text.slice(start).trim());
      break;
    }

    let split = -1;
    for (let i = end; i > start; i--) {
      const ch = text[i];
      if (ch === '.' || ch === '!' || ch === '?' || ch === '\n') { split = i + 1; break; }
    }
    if (split === -1) {
      for (let i = end; i > start; i--) {
        if (text[i] === ' ') { split = i; break; }
      }
    }
    if (split === -1 || split <= start) split = end;

    chunks.push(text.slice(start, split).trim());
    start = Math.max(0, split - overlapSize);
  }

  return chunks;
}

function makeId(seed: string): string {
  return crypto.createHash('md5').update(seed).digest('hex');
}