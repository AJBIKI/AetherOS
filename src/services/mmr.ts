

import { getEmbedding } from '../llm.js';

/**
 * Manual cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('Vectors must have same length');
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * MMR selection: balance relevance to query and diversity among selected chunks.
 * @param chunks - Array of chunks with id, text, and original score
 * @param queryEmbedding - Pre‑computed embedding of the user query
 * @param lambda - Trade‑off between relevance (1) and diversity (0). Typical 0.6–0.8.
 * @param topK - Number of chunks to select
 * @returns Selected chunks (original objects)
 */
export async function mmrSelection(
  chunks: { id: string; text: string; score: number }[],
  queryEmbedding: number[],
  lambda: number = 0.7,
  topK: number = 5
): Promise<{ id: string; text: string; score: number }[]> {
  if (chunks.length <= topK) return chunks;

  // Compute embeddings for all chunks (can be cached later)
  const chunkEmbeddings = await Promise.all(
    chunks.map(c => getEmbedding(c.text))
  );

  const selectedIndices: number[] = [];
  const remainingIndices = Array.from(chunks.keys());

  while (selectedIndices.length < topK && remainingIndices.length > 0) {
    let bestIdx = -1;
    let bestMMR = -Infinity;

    for (const i of remainingIndices) {
      const simToQuery = cosineSimilarity(queryEmbedding, chunkEmbeddings[i]);
      let maxSimToSelected = 0;
      for (const s of selectedIndices) {
        const sim = cosineSimilarity(chunkEmbeddings[i], chunkEmbeddings[s]);
        if (sim > maxSimToSelected) maxSimToSelected = sim;
      }
      const mmr = lambda * simToQuery - (1 - lambda) * maxSimToSelected;
      if (mmr > bestMMR) {
        bestMMR = mmr;
        bestIdx = i;
      }
    }

    selectedIndices.push(bestIdx);
    remainingIndices.splice(remainingIndices.indexOf(bestIdx), 1);
  }

  return selectedIndices.map(idx => chunks[idx]);
}