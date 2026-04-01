import ollama from 'ollama';

/**
 * Generate alternative search queries using a lightweight local model.
 * @param query - Original user query
 * @param numVariations - Number of variations to generate (default 3)
 * @returns Array including the original query plus variations
 */
export async function expandQuery(query: string, numVariations: number = 3): Promise<string[]> {
  const prompt = `You are a query rewriter. Generate ${numVariations} alternative search queries that are semantically similar to the original but phrased differently. Only output the queries, one per line, no numbering, no extra text.\n\nOriginal: ${query}\n\nAlternatives:`;
  
  try {
    const response = await ollama.generate({
      model: 'qwen3:4b', // can be changed to any fast local model
      prompt,
      stream: false,
    });
    
    const lines = response.response.split('\n').filter(l => l.trim().length > 0);
    const variations = lines.slice(0, numVariations);
    return [query, ...variations];
  } catch (error) {
    console.warn('Query expansion failed, using original query only:', error);
    return [query];
  }
}