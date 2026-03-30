
import { QdrantClient } from '@qdrant/js-client-rest';

export interface SparseVector {
  indices: number[];
  values: number[];
}

const BM25_K1 = 1.2;
const BM25_B = 0.75;
let globalIdf: Map<number, number> = new Map();

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/\b[\w']+\b/g) || [];
}

function wordToId(word: string): number {
  let hash = 0;
  for (let i = 0; i < word.length; i++) {
    hash = (hash << 5) - hash + word.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Compute a new IDF map from a list of chunk texts.
 * Returns a Map<termId, idf> without modifying the global map.
 */
export async function computeIdfMap(chunks: string[]): Promise<Map<number, number>> {
  const docCount = chunks.length;
  const termDocFreq = new Map<number, number>();

  for (const text of chunks) {
    const terms = new Set(tokenize(text));
    for (const term of terms) {
      const id = wordToId(term);
      termDocFreq.set(id, (termDocFreq.get(id) || 0) + 1);
    }
  }

  const idfMap = new Map<number, number>();
  for (const [termId, df] of termDocFreq) {
    const idf = Math.log((docCount - df + 0.5) / (df + 0.5) + 1);
    idfMap.set(termId, idf);
  }
  return idfMap;
}

/**
 * Replace the global IDF map with a new one.
 */
export function setGlobalIdf(newMap: Map<number, number>) {
  globalIdf = newMap;
}

/**
 * Legacy: Update the global IDF map by computing from all chunks.
 * (You can keep this for compatibility or remove it later.)
 */
export async function updateIdf(chunks: string[]) {
  const newIdf = await computeIdfMap(chunks);
  setGlobalIdf(newIdf);
}

/**
 * Compute BM25 sparse vector for a given text using the current global IDF.
 */
export function computeSparseVector(text: string): SparseVector {
  const terms = tokenize(text);
  const termCounts = new Map<number, number>();

  for (const term of terms) {
    const id = wordToId(term);
    termCounts.set(id, (termCounts.get(id) || 0) + 1);
  }

  const indices: number[] = [];
  const values: number[] = [];

  for (const [termId, tf] of termCounts) {
    const idf = globalIdf.get(termId) || 1;
    const score = tf * idf; // simplified BM25
    indices.push(termId);
    values.push(score);
  }

  return { indices, values };
}

/**
 * Fetch all chunk texts from Qdrant for IDF calculation.
 */
export async function fetchAllChunkTexts(client: QdrantClient, collectionName: string): Promise<string[]> {
  const texts: string[] = [];
  let offset: string | undefined = undefined;
  let hasMore = true;

  while (hasMore) {
    const response = await client.scroll(collectionName, {
      limit: 100,
      offset,
      with_payload: true,
      with_vector: false,
    });
    for (const point of response.points) {
      const text = (point.payload as any)?.text;
      if (text && typeof text === 'string') {
        texts.push(text);
      }
    }
    offset = response.next_page_offset as string | undefined;
    hasMore = !!offset;
  }
  return texts;
}