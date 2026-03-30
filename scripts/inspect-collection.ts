import { client, COLLECTION_NAME } from '../src/storage.js';

async function inspect() {
  const scroll = await client.scroll(COLLECTION_NAME, { limit: 100, with_payload: true });
  console.log(`🔍 Collection "${COLLECTION_NAME}" has ${scroll.points.length} points:`);
  scroll.points.forEach(p => {
    console.log(`  - ${p.id} → ${(p.payload as any)?.filePath}`);
  });
}

inspect().catch(console.error);