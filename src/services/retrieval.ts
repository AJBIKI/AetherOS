import { hybridSearch, getChunkById } from '../storage.js';
import { rerank } from './reranker.js';
import { expandQuery } from './queryExpansion.js';
import { getEmbedding } from '../llm.js';
import { classifyQuery } from './queryClassifier.js';

export interface RetrievalResult {
  contextString: string;
  sources: {
    filePath: string;
    heading: string;
    score: number;
  }[];
}


const REFERENCE_HEADINGS = [
  'works cited', 'references', 'bibliography',
  'sources', 'further reading', 'footnotes', 'appendix'
];

function isReferenceSection(headingPath: string[]): boolean {
  const last = headingPath.at(-1)?.toLowerCase() ?? '';
  return REFERENCE_HEADINGS.some(h => last.includes(h));
}


/**
 * Detect if query is a comparison (vs./versus) and extract the two entities.
 * Returns [entityA, entityB] or null.
 */
function parseComparisonQuery(query: string): [string, string] | null {
  const lower = query.toLowerCase();
  // Match patterns like "X vs Y", "X vs. Y", "X versus Y"
  const match = lower.match(/(\w+(?:\s+\w+)?)\s+vs\.?\s+(\w+(?:\s+\w+)?)/) ||
                lower.match(/(\w+(?:\s+\w+)?)\s+versus\s+(\w+(?:\s+\w+)?)/);
  if (match) {
    return [match[1].trim(), match[2].trim()];
  }
  return null;
}

/**
 * Check if a heading path contains both entities (partial, case‑insensitive).
 */
function headingContainsBoth(headingPath: string[], a: string, b: string): boolean {
  const lowerHeading = headingPath.join(' ').toLowerCase();
  return lowerHeading.includes(a.toLowerCase()) && lowerHeading.includes(b.toLowerCase());
}

// Common stopwords (simple list, can be expanded)
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'he',
  'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the', 'to', 'was', 'were',
  'will', 'with', 'what', 'which', 'why', 'how', 'vs', 'versus'
]);

/**
 * Extract important keywords from query (lowercase, unique, stopwords removed).
 */
function extractKeywords(query: string): string[] {
  const words = query.toLowerCase().split(/\s+/);
  const unique = new Set<string>();
  for (const w of words) {
    if (!STOPWORDS.has(w) && w.length > 2) {
      unique.add(w);
    }
  }
  return Array.from(unique);
}

/**
 * Check if a heading path contains a keyword (case‑insensitive, partial match).
 */
function headingContainsKeyword(headingPath: string[], keyword: string): boolean {
  const lowerHeading = headingPath.join(' ').toLowerCase();
  return lowerHeading.includes(keyword);
}

/**
 * Compute generic heading boost factor based on keyword matches.
 * Each matching keyword adds 0.2 (capped at 2.0).
 */
function computeHeadingBoost(headingPath: string[], keywords: string[]): number {
  let matches = 0;
  for (const kw of keywords) {
    if (headingContainsKeyword(headingPath, kw)) matches++;
  }
  if (matches === 0) return 1.0;
  // boost = 1 + 0.2 * matches, max 2.0
  return Math.min(1.0 + 0.1 * matches, 1.5);
}




// Simple token estimation (1 token ≈ 4 chars)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Build context string with token budget.
 * @param sections - Array of sections, each with selected text, filePath, heading, score
 * @param tokenBudget - Maximum tokens allowed
 * @returns { contextString: string, sources: array }
 */
function buildContextWithBudget(
  sections: { filePath: string; heading: string; text: string; score: number }[],
  tokenBudget: number = 3000
): { contextString: string; sources: { filePath: string; heading: string; score: number }[] } {
  const blocks: string[] = [];
  const usedSources: { filePath: string; heading: string; score: number }[] = [];
  let usedTokens = 0;

  for (const section of sections) {
    const tokens = estimateTokens(section.text);
    if (usedTokens + tokens > tokenBudget) {
      // Try to truncate this section to fit the remaining budget
      const remaining = tokenBudget - usedTokens;
      if (remaining > 100) { // only add if we can get at least 100 chars
        const truncated = section.text.slice(0, remaining * 4);
        blocks.push(`[Source: ${section.filePath} → ${section.heading}]\n${truncated}…`);
        usedSources.push({ filePath: section.filePath, heading: section.heading, score: section.score });
        usedTokens += estimateTokens(truncated);
      }
      break;
    }
    blocks.push(`[Source: ${section.filePath} → ${section.heading}]\n${section.text}`);
    usedSources.push({ filePath: section.filePath, heading: section.heading, score: section.score });
    usedTokens += tokens;
  }

  return {
    contextString: blocks.join('\n\n---\n\n'),
    sources: usedSources,
  };
}

/**
 * The enhanced retrieval engine with section grouping and token budget.
 */
 export const getHydratedContext = async (
   question: string,
   limit: number = 15,
   topK: number = 6
 ): Promise<RetrievalResult> => {
   const startTime = Date.now();
   console.log(`\n--- 📥 Retrieval Starting: "${question}" ---`);
 
   // 1. Classify query
   const mode = await classifyQuery(question);
   console.log(`🔍 Query mode: ${mode}`);
 
   let mergedHits: any[] = [];
 
   if (mode === 'precise') {
     // PRECISE MODE: no expansion, dense only, smaller candidate pool
     console.log(`⚡ Precise mode: skipping expansion, using dense only.`);
     const denseResults = await hybridSearch(question, 10); // smaller limit
     mergedHits = denseResults;
   } else {
     // BROAD MODE: full pipeline
     const expandedQueries = await expandQuery(question, 3);
     console.log(`🔍 Expanded queries:`, expandedQueries);
 
     const allHits = await Promise.all(
       expandedQueries.map(q => hybridSearch(q, limit))
     );
 
     // Merge and deduplicate by id, keep best score
     const mergedMap = new Map<string, any>();
     for (const hits of allHits) {
       for (const hit of hits) {
         const existing = mergedMap.get(hit.id);
         if (!existing || hit.score > existing.score) {
           mergedMap.set(hit.id, hit);
         }
       }
     }
     mergedHits = Array.from(mergedMap.values());
     console.log(`📦 Unique candidates after expansion: ${mergedHits.length}`);
   }
 
   if (mergedHits.length === 0) {
     return { contextString: "", sources: [] };
   }
 
   // 2. Rerank (use larger pool for broad, smaller for precise)
   const rerankTopK = mode === 'precise' ? 6 : topK * 2;
   const rerankedHits = await rerank(question, mergedHits, rerankTopK);
   console.log(`🎯 Reranker returned ${rerankedHits.length} candidates.`);
 
   // 3. Group by sectionId (same for both modes)
   const sectionMap = new Map<string, { bestHit: any; bestScore: number }>();
   for (const hit of rerankedHits) {
     const sectionId = hit.sectionId;
     if (!sectionId) continue;
     const existing = sectionMap.get(sectionId);
     if (!existing || hit.score > existing.bestScore) {
       sectionMap.set(sectionId, { bestHit: hit, bestScore: hit.score });
     }
   };
   
   
   
   // After building sectionMap
   const keywords = extractKeywords(question);
   console.log(`🔍 Extracted keywords: ${keywords.join(', ')}`);
   
   for (const [sectionId, data] of sectionMap.entries()) {
     const headingPath = data.bestHit.headingPath;
     if (!headingPath) continue;
     
     // 1. Generic heading boost
     const genericBoost = computeHeadingBoost(headingPath, keywords);
     if (genericBoost > 1.0) {
       console.log(`   📈 Generic boost for "${headingPath.join(' → ')}": ${genericBoost.toFixed(2)}`);
     }
     data.bestScore *= genericBoost;
   
     // 2. Comparison boost (if applicable)
     const comparison = parseComparisonQuery(question);
     if (comparison) {
       const [entityA, entityB] = comparison;
       if (headingContainsBoth(headingPath, entityA, entityB)) {
         const oldScore = data.bestScore;
         data.bestScore *= 1.5;
         console.log(`   ⬆️ Comparison boost for "${headingPath.join(' → ')}": ${oldScore.toFixed(4)} → ${data.bestScore.toFixed(4)}`);
       }
     }
     
     // 3. Reference section penalty (0.3×)
     if (isReferenceSection(headingPath)) {
       const oldScore = data.bestScore;
       data.bestScore *= 0.3;
       console.log(`   📉 Reference penalty for "${headingPath.join(' → ')}": ${oldScore.toFixed(4)} → ${data.bestScore.toFixed(4)}`);
     }
   
   }
 
   // Take top N sections (3 for broad, 2 for precise)
   const maxSections = mode === 'precise' ? 2 : 3;
   const topSections = Array.from(sectionMap.values())
     .sort((a, b) => b.bestScore - a.bestScore)
     .slice(0, maxSections);
 
   console.log(`🌿 Selected ${topSections.length} top sections (${mode} mode).`);
 
   // 4. Build context with token budget (same as before)
   const sectionsForContext = topSections.map(s => ({
     filePath: s.bestHit.filePath,
     heading: s.bestHit.headingPath?.join(" → ") || "Note",
     text: s.bestHit.text,
     score: s.bestHit.score,
   }));
 
   const tokenBudget = mode === 'precise' ? 2000 : 8000;
   const { contextString, sources } = buildContextWithBudget(sectionsForContext, tokenBudget);
 
   console.log(`✨ Retrieval took ${((Date.now() - startTime) / 1000).toFixed(2)}s\n`);
 
   return { contextString, sources: sources.map(s => ({ filePath: s.filePath, heading: s.heading, score: s.score })) };
 };