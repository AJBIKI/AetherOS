import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { generateAnswer, getEmbedding } from './llm.js';
import { hybridSearch, searchNotes } from './storage.js';

// 1. Initialize tRPC
const t = initTRPC.create();


//v1.1
// 
export const appRouter = t.router({
  health: t.procedure.query(() => {
    return {
      status: 'ok',
      version: '1.1.0',                    // updated version
      timestamp: new Date().toISOString(),
    };
  }),

  greet: t.procedure
    .input(z.object({ name: z.string().min(2) }))
    .query(({ input }) => {
      return { message: `Welcome to AetherOS, ${input.name}!` };
    }),

 ask: t.procedure
  .input(z.object({ question: z.string().min(5) }))
  .query(async ({ input }) => {
    // 1. Hybrid Search + Reranker
    const results = await hybridSearch(input.question, 12, 6);   // 12 candidates → top 6 after rerank

    // 2. Build clean context
    const context = results
      .map((r: any) => {
        const heading = r.headingPath?.join(" → ") || "Note";
        return `[Source: ${r.filePath} → ${heading}]\n${r.text}`;
      })
      .join('\n\n---\n\n');

    // 3. Generate final answer
    const answer = await generateAnswer(input.question, context);

    return {
      answer,
      sources: results.map((r: any) => ({
        filePath: r.filePath,
        heading: r.headingPath?.join(" → ") || "Note",
        snippet: r.text.slice(0, 150) + "..."
      }))
    };
  }),
});

  
  
// Export the type for the frontend to use later
export type AppRouter = typeof appRouter;