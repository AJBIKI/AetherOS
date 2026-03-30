import { initStorage, client, COLLECTION_NAME } from '../src/storage.js';
import { startWatcher } from '../src/watcher.js';
import { generateAnswer } from '../src/llm.js';
import { getHydratedContext } from '../src/services/retrieval.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const TEST_FOLDER = path.resolve('./test-notes');

async function waitForPoints(expectedMin = 1, timeoutMs = 15000) {
  const start = Date.now();
  let points = 0;
  while (points < expectedMin && (Date.now() - start) < timeoutMs) {
    await new Promise(r => setTimeout(r, 500));
    const scroll = await client.scroll(COLLECTION_NAME, { limit: 1, with_payload: false });
    points = scroll.points.length;
  }
  return points;
}

async function main() {
  console.log('🧪 AetherOS – Clean Test with Polling\n');

  // 1. Ensure collection exists (do NOT delete)
  await initStorage();
  console.log('✅ Storage ready\n');

  // 2. Create test note
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

  // 3. Start watcher
  console.log('🚀 Starting watcher...');
  startWatcher(TEST_FOLDER);

  // 4. Wait until points appear
  console.log('⏳ Waiting for ingestion (polling Qdrant)…');
  const pointCount = await waitForPoints(1, 15000);
  if (pointCount === 0) {
    console.error('❌ No points found after 15 seconds. Aborting.');
    process.exit(1);
  }
  console.log(`✅ Ingestion complete: ${pointCount} points in collection.\n`);

  // 5. Query
  const question = "How to put the AI Integration Layer: Gemini & Google AI into modern web-apps?";
  console.log(`❓ Question: "${question}"\n`);

  const { contextString, sources } = await getHydratedContext(question, 19, 6);

  console.log('🤖 Generating Answer via Ollama...');
  const answer = await generateAnswer(question, contextString);

  console.log(`\n========================================`);
  console.log(`🤖 AetherOS ANSWER:`);
  console.log(answer);
  console.log(`========================================\n`);

  console.log('📚 Sources:');
  sources.forEach(s => console.log(`- ${s.heading}`));

  console.log('\n🎉 End-to-End test completed!');
}

main().catch(console.error);