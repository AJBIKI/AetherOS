import { initStorage, hybridSearch, getChunkById } from '../src/storage.js';
import { startWatcher } from '../src/watcher.js';
import { generateAnswer } from '../src/llm.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getHydratedContext } from '../src/services/retrieval.js';

const TEST_FOLDER = path.resolve('./test-notes');

async function main() {
  console.log('🧪 AetherOS v1.2 End-to-End Test (Hydrated Search + Rerank + LLM)\n');

  await initStorage();

  // 1. Create/Ensure test note
  await fs.mkdir(TEST_FOLDER, { recursive: true });
  const testNotePath = path.join(TEST_FOLDER, 'node-streams-test.md');

  const testContent = `# Node.js Streams Backpressure Test

## What is Backpressure?
Backpressure prevents the producer from overwhelming the consumer.

## Real Problem I Faced
While building a file upload API, Readable stream from multer was too fast. Writable stream to S3 couldn't keep up. Memory spiked to 1.8 GB.

## Solution
Used pipeline() + manual pause/resume.`;

  await fs.writeFile(testNotePath, testContent);
  console.log(`📝 Test note updated at: ${testNotePath}`);

  // 2. Start watcher
  console.log('🚀 Starting ingestion watcher...');
  startWatcher(TEST_FOLDER);
  console.log('⏳ Waiting 4 seconds for AST parsing and vector ingestion...');
  await new Promise(r => setTimeout(r, 4000));
  console.log('✅ Ingestion complete.\n');

  // 3. FULL TEST: Search + Hydration + Rerank + LLM
  // const question = "Is antigravity has a Browser Subagent?";
  // const question = "How did you solve the memory spike during file uploads?";
  const question = "How to  put  the The AI Integration Layer: Gemini & Google AI  into the modern web-apps?"
  console.log(`❓ Question: "${question}"\n`);

  // // Step A: Hybrid Search + Reranker
  // const hits = await hybridSearch(question, 12, 5); 
  // console.log(`🔍 Found ${hits.length} high-quality hits from Reranker.`);

  // // Step B: Context Hydration (Small-to-Big Zoom)
  // console.log(`🌊 Starting Context Hydration...`);
  // const hydratedContexts = await Promise.all(
  //   hits.map(async (hit: any, idx) => {
  //     if (hit.chunkLevel === 'paragraph' && hit.parentId) {
  //       console.log(`   [Hit ${idx+1}] 🔍 Zooming: Paragraph -> Section "${hit.headingPath?.join(' → ')}"`);
  //       const parent = await getChunkById(hit.parentId);
  //       if (parent && parent.payload) {
  //         return { text: parent.payload.text, path: hit.filePath, heading: hit.headingPath, zoomed: true };
  //       }
  //     }
  //     console.log(`   [Hit ${idx+1}] 📄 Keeping: Section context "${hit.headingPath?.join(' → ')}"`);
  //     return { text: hit.text, path: hit.filePath, heading: hit.headingPath, zoomed: false };
  //   })
  // );

  // // Step C: Deduplicate & Build Context String
  // const uniqueContexts = Array.from(new Map(hydratedContexts.map(c => [c.text, c])).values());
  // const contextString = uniqueContexts
  //   .map(c => `[Source: ${c.path} → ${c.heading?.join(' → ')}]${c.zoomed ? ' (Expanded Context)' : ''}\n${c.text}`)
  //   .join('\n\n---\n\n');

  // console.log(`\n📋 Final Context prepared (${uniqueContexts.length} unique blocks):`);
  // console.log(contextString.slice(0, 400) + '...\n');

  // // Step D: LLM Generation
  // console.log('🤖 Generating Answer via Ollama...');
  // 
  // 
  // 
  const { contextString } =await getHydratedContext(question, 19, 6);
  console.log('🤖 Generating Answer via Ollama...');
  
  const answer = await generateAnswer(question, contextString);

  console.log(`\n========================================`);
  console.log(`🤖 AetherOS ANSWER:`);
  console.log(answer);
  console.log(`========================================\n`);


  console.log('\n🎉 End-to-End test completed!');
}

main().catch(console.error);