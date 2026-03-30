import { client, COLLECTION_NAME, initStorage } from '../src/storage.js';

async function clean() {
  // Delete the collection (force)
  try {
    await client.deleteCollection(COLLECTION_NAME);
    console.log(`🗑️ Deleted collection ${COLLECTION_NAME}`);
  } catch (err) {
    console.log('Collection did not exist or could not be deleted', err);
  }
  // Recreate it empty
  await initStorage(true); // force recreate
  console.log('✅ Collection recreated (empty).');
}

clean().catch(console.error);