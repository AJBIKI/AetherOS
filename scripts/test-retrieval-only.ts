import { getHydratedContext } from '../src/services/retrieval.js';
import { generateAnswer } from '../src/llm.js';
import { verifyAnswer } from '../src/services/cove.js';

const QUESTION = "How to integrate Gemini & Google AI into modern web-apps?";

async function main() {
  console.log('\n🧪 AetherOS – Retrieval‑Only Test\n');
  console.log(`❓ Question: "${QUESTION}"\n`);

  // 1. Run the full retrieval pipeline (expansion + search + rerank + MMR + hydration)
  const { contextString, sources } = await getHydratedContext(QUESTION, 15, 6);

  if (!contextString) {
    console.log('❌ No context retrieved. Make sure your Qdrant collection has relevant notes.');
    return;
  }

  console.log('\n📚 Sources used:');
  sources.forEach((s, i) => {
    console.log(`${i+1}. ${s.filePath} → ${s.heading} (score: ${s.score.toFixed(4)})`);
  });

  console.log('\n📝 Context preview (first 800 chars):');
  console.log(contextString.slice(0, 800) + (contextString.length > 800 ? '…\n' : '\n'));

  // 2. Generate answer (optional)
  console.log('🤖 Generating answer via Ollama...');
  const rawAnswer = await generateAnswer(QUESTION, contextString);
  console.log('\n--- Raw Answer ---\n', rawAnswer);

  // 3. Optional: Chain‑of‑Verification
  const useCoVe = true; // set false to skip
  if (useCoVe) {
    console.log('\n🔍 Running Chain‑of‑Verification...');
    const verifiedAnswer = await verifyAnswer(QUESTION, rawAnswer, contextString);
    console.log('\n--- Verified Answer ---\n', verifiedAnswer);
  }

  console.log('\n✅ Retrieval test completed.');
}

main().catch(console.error);