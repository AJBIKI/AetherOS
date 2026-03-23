import { hybridSearch, getChunkById } from '../storage.js';
import { rerank } from './reranker.js';

export interface RetrievalResult {
  contextString: string;
  sources: {
    filePath: string;
    heading: string;
    score: number;
  }[];
}

/**
 * 🌊 The Global Retrieval Engine
 * Coordinates: Vector Search -> Rerank -> Hydration -> Deduplication
 */
export const getHydratedContext = async (
  question: string, 
  limit: number = 15, 
  topK: number = 6
): Promise<RetrievalResult> => {
  const startTime = Date.now();
  console.log(`\n--- 📥 Retrieval Starting: "${question}" ---`);

  // 1. Surgical Hit Discovery (Vector Search)
  // We fetch a larger pool (limit) so the Reranker has variety
  const initialHits = await hybridSearch(question, limit);
  console.log(`🔍 Step 1: Found ${initialHits.length} vector candidates.`);

  if (initialHits.length === 0) {
    return { contextString: "", sources: [] };
  }

  // 2. The Truth Layer (Rerank)
  const rerankedHits = await rerank(question, initialHits, topK);
  console.log(`🎯 Step 2: Reranker picked top ${rerankedHits.length} from candidates.`);
  
  rerankedHits.forEach((hit, idx) => {
    console.log(`   Hit ${idx+1}: level=${hit.chunkLevel}, parentId=${hit.parentId}`);
  });

  // 3. Context Hydration (Small-to-Big Zoom)
  const hydrated = await Promise.all(
    rerankedHits.map(async (hit: any, idx) => {
      if (hit.chunkLevel === 'paragraph' && hit.parentId) {
        console.log(`   🔍 Attempting to hydrate with parentId=${hit.parentId}`);
        const parent = await getChunkById(hit.parentId);
         console.log(`   Parent found: ${parent ? 'yes' : 'no'}`);
        if (parent?.payload) {
          console.log(`   [Hit ${idx+1}] 🔍 Zoom: Paragraph -> Section "${hit.headingPath?.join(' → ')}"`);
          return {
            text: parent.payload.text,
            filePath: hit.filePath,
            heading: hit.headingPath?.join(" → ") || "Note",
            score: hit.score,
            isZoomed: true
          };
        }
      }
      return {
        text: hit.text,
        filePath: hit.filePath,
        heading: hit.headingPath?.join(" → ") || "Note",
        score: hit.score,
        isZoomed: false
      };
    })
  );

  // 4. Deduplicate (If multiple paragraphs point to the same section)
  const uniqueContexts = Array.from(
    new Map(hydrated.map(item => [item.text, item])).values()
  );

  // 5. Build Final Context String
  const contextString = uniqueContexts
    .map(c => `[Source: ${c.filePath} → ${c.heading}]${c.isZoomed ? ' (Full Section)' : ''}\n${c.text}`)
    .join('\n\n---\n\n');

  console.log(`🛡️ Step 3: Deduplicated ${hydrated.length} -> ${uniqueContexts.length} unique blocks.`);
  console.log(`✨ Retrieval took ${((Date.now() - startTime) / 1000).toFixed(2)}s\n`);

  return {
    contextString,
    sources: rerankedHits.map(h => ({
      filePath: h.filePath,
      heading: h.headingPath?.join(" → ") || "Note",
      score: h.score
    }))
  };
};