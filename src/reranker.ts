import { pipeline } from "@xenova/transformers";

let reranker: any = null;

const initReranker = async () => {
  if (!reranker) {
    console.log("🔄 Loading reranker model...");
    reranker = await pipeline(
      "text-classification",
      // "Xenova/ms-marco-MiniLM-L-6-v2"  // cross-encoder reranker
      "Xenova/ms-marco-MiniLM-L-12-v2"
    );
    console.log("✅ Reranker model loaded.");
  }
  return reranker;
};

export const rerank = async (
  query: string,
  chunks: { id: string; score: number; text: string; [key: string]: any }[],
  topK: number = 5
) => {
  const model = await initReranker();

  // Score each chunk against the query using the cross-encoder
  const scored = await Promise.all(
    chunks.map(async (chunk) => {
      const result = await model(query, { text_pair: chunk.text });
      // ms-marco returns LABEL_0 (irrelevant) / LABEL_1 (relevant)
      const relevanceScore =
        result[0].label === "LABEL_1"
          ? result[0].score
          : 1 - result[0].score;

      return { ...chunk, rerankScore: relevanceScore };
    })
  );

  // Sort by rerank score descending, return topK
  return scored
    .sort((a, b) => b.rerankScore - a.rerankScore)
    .slice(0, topK)
    .map(({ rerankScore, ...rest }) => rest);  // strip rerankScore, return original shape
  
}