import ollama from 'ollama';

export type QueryMode = 'precise' | 'broad';

/**
 * Classify a user query into 'precise' or 'broad' using a small LLM.
 * Fallback to heuristic (short length = precise) if LLM fails.
 */
export async function classifyQuery(query: string): Promise<QueryMode> {
  try {
    const prompt = `You are a query classifier. Classify the following user query as either "precise" or "broad".
- "precise": the user wants a specific, factual answer (e.g., "What is RRF?", "How do I set up Qdrant?").
- "broad": the user wants an explanation, comparison, or general understanding (e.g., "Explain my retrieval system", "Compare BM25 vs dense").

Output only the word "precise" or "broad", nothing else.

Query: "${query}"
Classification:`;

    const response = await ollama.generate({
      model: 'qwen3:4b',
      prompt,
      stream: false,
    });
    const mode = response.response.trim().toLowerCase();
    if (mode === 'precise' || mode === 'broad') return mode;
    return fallbackClassify(query);
  } catch (error) {
    console.warn('LLM classification failed, using fallback:', error);
    return fallbackClassify(query);
  }
}

function fallbackClassify(query: string): QueryMode {
  // Heuristic: short queries (< 5 words) are likely precise
  if (query.split(/\s+/).length < 5) return 'precise';
  // Contains question words like "how", "why", "explain" often broad
  const broadIndicators = ['how', 'why', 'explain', 'compare', 'difference', 'describe'];
  if (broadIndicators.some(w => query.toLowerCase().includes(w))) return 'broad';
  return 'precise';
}