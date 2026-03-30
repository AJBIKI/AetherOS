import { Worker } from 'worker_threads';
import path from 'path';
import { fetchAllChunkTexts, setGlobalIdf } from './sparseVector.js';
import  {client ,  COLLECTION_NAME } from '../storage.js';
import { fr } from 'zod/v4/locales';
let newChunkCount = 0;
let isRebuilding = false;
const THRESHOLD = 100;

export async function maybeRebuildIDF(newChunks: number) {
  newChunkCount += newChunks;
  if (newChunkCount >= THRESHOLD && !isRebuilding) {
    isRebuilding = true;
    console.log('🔄 Rebuilding IDF in background...');
    try {
      const allTexts = await fetchAllChunkTexts(client, COLLECTION_NAME);
      const worker = new Worker(path.resolve('./dist/workers/idfWorker.js'), {
        workerData: { chunkTexts: allTexts }
      });
      worker.on('message', (serialized) => {
        const idfMap = new Map(Object.entries(serialized).map(([k, v]) => [Number(k), v as number]));
        setGlobalIdf(idfMap);
        newChunkCount = 0;
        isRebuilding = false;
        console.log('✅ IDF rebuilt and updated.');
      });
      worker.on('error', (err) => {
        console.error('IDF worker error:', err);
        isRebuilding = false;
      });
    } catch (err) {
      console.error('Failed to fetch texts for IDF:', err);
      isRebuilding = false;
    }
  }
}