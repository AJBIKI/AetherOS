import { initStorage } from '../src/storage.js';
import { startWatcher } from '../src/watcher.js';
import { hybridSearch } from '../src/storage.js';
import { generateAnswer } from '../src/llm.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const TEST_FOLDER = path.resolve('./test-notes');

async function main() {
  console.log('🧪 AetherOS End-to-End Test (Search + LLM Answer)\n');

  await initStorage();

  // Create test note
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
  console.log(`📝 Test note created at: ${testNotePath}\n`);

  // Start watcher
  console.log('🚀 Starting watcher (ingestion)…');
  startWatcher(TEST_FOLDER);
  console.log('⏳ Waiting 3.5 seconds for ingestion to complete...');
  await new Promise(r => setTimeout(r, 3500));
  console.log('✅ Ingestion period complete\n');

  // === FULL TEST: Search + Rerank + LLM Answer ===
  const question = "Building E-commerce with AI";
  console.log(`❓ Question: ${question}\n`);

  const results = await hybridSearch(question, 12);   // 12 candidates → reranker picks best

  console.log(`\n📋 Final search results (${results.length}):`);
  results.forEach((r: any, i: number) => {
    const heading = r.headingPath?.join(" → ") || "Note";
    console.log(`   ${i+1}. Score: ${r.score?.toFixed?.(4) ?? r.score} | File: ${r.filePath} → ${heading}`);
  });

  // Build context for LLM
  const context = results
    .map((r: any) => {
      const heading = r.headingPath?.join(" → ") || "Note";
      return `[Source: ${r.filePath} → ${heading}]\n${r.text}`;
    })
    .join('\n\n---\n\n');

  console.log('\n📝 Context being sent to LLM:');
  console.log(context.slice(0, 500) + (context.length > 500 ? '…\n' : '\n'));

  // Generate final answer
  console.log('🤖 Generating answer...');
  const answer = await generateAnswer(question, context);
  console.log(`\n🤖 AetherOS Answer:\n`);
  console.log(answer);
  console.log(`\n📚 Sources:`);

  results.forEach((r: any, i: number) => {
    const heading = r.headingPath?.join(" → ") || "Note";
    console.log(`${i+1}. ${r.filePath} → ${heading}`);
  });

  console.log('\n🎉 End-to-End test completed!');
}

main().catch(console.error);