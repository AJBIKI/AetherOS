import server from "./server.js";
import { fetchAllChunkTexts, updateIdf } from "./services/sparseVector.js";
import { initStorage, client } from "./storage.js";
import { startWatcher } from "./watcher.js";


await initStorage();

startWatcher('./notes'); // Point this to your notes folder

// After initial indexing, compute IDF from all chunks
setTimeout(async () => {
  try {
    console.log("🔍 Computing global IDF from existing chunks...");
    const texts = await fetchAllChunkTexts(client, 'aetheros_notes');
    if (texts.length > 0) {
      await updateIdf(texts);
      console.log(`✅ IDF updated for ${texts.length} chunks.`);
    } else {
      console.log("⚠️ No chunks found yet; IDF will be updated later.");
    }
  } catch (err) {
    console.error("Failed to compute IDF:", err);
  }
}, 5000); // Adjust delay as needed

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3000;
    await server.listen({ port, host: '0.0.0.0' });
    console.log(`🚀 AetherOS v1.0 Live at http://localhost:${port}`);
  } catch (err) {
    process.exit(1);
  }
};

start();