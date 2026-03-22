import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "./trpc.js"; // Import the TYPE only

const client = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "http://localhost:3000/trpc",
    }),
  ],
});

async function main() {
  // If you type "client.gr", VS Code will autocomplete "greet"
  // If you try to pass { name: 123 }, TypeScript will show an error!
  const response = await client.greet.query({ name: "ab"});
  console.log("✅ Response:", response.message);
}

main();
