import server from "./server.js";
import { initStorage } from "./storage.js";
import { startWatcher } from "./watcher.js";

await initStorage();


startWatcher('./notes'); // Point this to your notes folder

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