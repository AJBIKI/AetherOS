import { pipeline } from "@xenova/transformers";

let reranker: any = null;

const initReranker = async () => {
  if (!reranker) {
    console.log("🔄 Loading reranker model...");
    // Using MiniLM-L-12 for high precision on your RTX 2050
    reranker = await pipeline(
      "text-classification",
      "Xenova/ms-marco-MiniLM-L-12-v2"
    );
    console.log("✅ Reranker model loaded.");
  }
  return reranker;
};

/**
 * 🎯 God-Tier Reranker (Metadata Preserving)
 */
// export const rerank = async <T extends { text: string }>(
//   query: string,
//   chunks: T[],
//   topK: number = 5
// ): Promise<T[]> => {
//   const model = await initReranker();

//   const scored = await Promise.all(
//     chunks.map(async (chunk) => {
//       const result = await model(query, { text_pair: chunk.text });
      
//       const relevanceScore = result[0].label === "LABEL_1" 
//         ? result[0].score 
//         : 1 - result[0].score;

//       return { ...chunk, rerankScore: relevanceScore };
//     })
//   );

//   return scored
//     .sort((a, b) => b.rerankScore - a.rerankScore)
//     .slice(0, topK)
//     // 🚀 FIXED: The "Double Cast" pattern to satisfy the TS Compiler
//     // We cast to unknown first, then to T.
//     .map(({ rerankScore, ...rest }) => rest as unknown as T); 
// };
// 
// batch input
// 
export const rerank = async <T extends { text: string; headingPath?: string[] }>(
  query: string,
  chunks: T[],
  topK: number = 5
): Promise<T[]> => {
  if (chunks.length === 0) return [];
  const model = await initReranker();

  console.log(`🎯 GPU Batch Reranking: ${chunks.length} candidates...`);

  // Prepare two parallel arrays
  const queries = Array(chunks.length).fill(query);
  // const passages = chunks.map(c => c.text);
  // 
  const passages = chunks.map(c => {
    const heading = c.headingPath?.join(' > ') ?? '';
    const passage = heading ? `${heading}\n\n${c.text}` : c.text;
    console.log(`[DEBUG] Heading: ${heading.substring(0, 80)}...`);
    return passage;
  });

  // Execute batch – this is the correct API for cross-encoders
  // const results = await model(queries, { text_pair: passages, batch_size: 16 });
  const results = await model(queries, { text_pair: passages, batch_size: 16 });
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk.headingPath?.join(' ').includes('Kiro')) {
      console.log(`🔍 Kiro section passage:`, passages[i]);
      console.log(`   Result:`, results[i]);
    }
  }

  const scored = chunks.map((chunk, i) => {
    const result = results[i];
    
    // Detect overconfident irrelevance — model abstaining on unknown terms
    const isModelAbstaining = result.label === 'LABEL_0' && result.score > 0.95;
    
    const relevanceScore = isModelAbstaining
      ? (chunk as any).score * 0.9        // fall back to hybrid search score
      : result.label === 'LABEL_1' 
        ? result.score 
        : 1 - result.score;
  
    return { ...chunk, rerankScore: relevanceScore };
  });
  
  scored.forEach((item, idx) => {
    if (item.headingPath?.join(' ').includes('Antigravity vs. Kiro')) {
      console.log(`🔍 Raw reranker score for Kiro section: ${item.rerankScore}`);
    }
  });

  return scored
    .sort((a, b) => b.rerankScore - a.rerankScore)
    .slice(0, topK)
    .map(({ rerankScore, ...rest }) => rest as unknown as T);
};