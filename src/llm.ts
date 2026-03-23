import ollama from 'ollama';

// 1. Convert text into a math vector (List of 768 numbers)
export const getEmbedding = async (text: string) => {
  const response = await ollama.embeddings({
    model: 'nomic-embed-text',
    prompt: text,
  });
  return response.embedding; // This is our Vector [cite: 347, 350]
};

// 2. Ask the LLM a question based on your notes
// export const generateAnswer = async (prompt: string, context: string) => {
//   const fullPrompt = `
//     Context from your notes:
//     ${context}

//     Question: ${prompt}
    
//     Answer the question strictly using the context provided above.
//   `;

//   const response = await ollama.chat({
//     model: 'qwen3:8b',
//     messages: [{ role: 'user', content: fullPrompt }],
//     stream: false, // We'll learn streaming in Phase 3 [cite: 348]
//   });

//   return response.message.content;
// };
// 
// 
// 
export const generateAnswer = async (
  question: string,
  context: string
): Promise<string> => {
  const response = await ollama.chat({
    model: 'qwen3:8b',
    messages: [
      {
        role: 'system',
        content: `You are AetherOS, a helpful and precise second brain.
Answer ONLY using the provided context from the user's personal notes.
Be concise, accurate, and natural.
Always include inline citations like [Source: filename → heading] when possible.
If the context doesn't have enough information, say "I don't have enough context in my notes for this."`
      },
      {
        role: 'user',
        content: `Question: ${question}

Context from my notes:
${context}`
      }
    ],
    options: {
      temperature: 0.7,
      // top_p: 0.9,
      // num_predict: 1024,  // Max tokens
    },
    
  });

  return response.message.content.trim();
};