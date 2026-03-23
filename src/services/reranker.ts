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
export const rerank = async <T extends { text: string }>(
  query: string,
  chunks: T[],
  topK: number = 5
): Promise<T[]> => {
  const model = await initReranker();

  const scored = await Promise.all(
    chunks.map(async (chunk) => {
      const result = await model(query, { text_pair: chunk.text });
      
      const relevanceScore = result[0].label === "LABEL_1" 
        ? result[0].score 
        : 1 - result[0].score;

      return { ...chunk, rerankScore: relevanceScore };
    })
  );

  return scored
    .sort((a, b) => b.rerankScore - a.rerankScore)
    .slice(0, topK)
    // 🚀 FIXED: The "Double Cast" pattern to satisfy the TS Compiler
    // We cast to unknown first, then to T.
    .map(({ rerankScore, ...rest }) => rest as unknown as T); 
};