import { parentPort, workerData } from 'worker_threads';
import { computeIdfMap } from '../services/sparseVector.js';


(async () => {
  const { chunkTexts } = workerData;
  const idfMap = await computeIdfMap(chunkTexts);
  // Convert Map to a serializable object
  const serialized = Object.fromEntries(idfMap);
  parentPort?.postMessage(serialized);
})();