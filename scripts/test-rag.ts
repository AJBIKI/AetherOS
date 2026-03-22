import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../trpc.js';

const client = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: 'http://localhost:3000/trpc',
    }),
  ],
});

async function runTest() {
  console.log("🤔 Asking AetherOS...");
  
  try {
    const response = await client.ask.query({ 
      question: "Deconstruct the MERN Layers" 
    });

    console.log("\n🤖 AI ANSWER:");
    console.log(response.answer);

    console.log("\n📚 SOURCES USED:");
    response.sources.forEach(src => console.log(`- ${src}`));
  } catch (error) {
    console.error("❌ Test Failed:", error);
  }
}

runTest();