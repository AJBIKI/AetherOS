import ollama from 'ollama';

/**
 * Verify an LLM‑generated answer against the original context to reduce hallucinations.
 * @param question - Original user question
 * @param answer - Draft answer from the LLM
 * @param context - The retrieved context used to generate the answer
 * @returns Verified answer with unsupported claims removed or corrected
 */
export async function verifyAnswer(question: string, answer: string, context: string): Promise<string> {
  const prompt = `You are a strict fact‑checker. Below is a QUESTION, a CONTEXT, and a DRAFT ANSWER generated from that context.  

Your task: verify each claim in the draft answer against the context.  
- If a claim is fully supported by the context, keep it.  
- If a claim is partially supported, adjust it to match the context.  
- If a claim is not supported or contradicts the context, remove or correct it.  
- If the answer contains hallucinations, rewrite it to include only information present in the context.  
- If the answer is already fully correct, output it unchanged.  

Output only the verified answer, no extra commentary.

QUESTION: ${question}

CONTEXT:
${context}

DRAFT ANSWER:
${answer}

VERIFIED ANSWER:`;

  try {
    const response = await ollama.generate({
      model: 'qwen3:4b',
      prompt,
      stream: false,
    });
    return response.response.trim();
  } catch (error) {
    console.error('CoVe verification failed, returning original answer:', error);
    return answer;
  }
}